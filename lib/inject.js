/**
 * The three injection seams.
 *
 * Each channel is wired to the harness extension point that matches its
 * lifetime, and each one reads the same live store snapshot, so an edit in the
 * panel takes effect on the very next request with no reload:
 *
 *   system   `ctx.systemPrompt.section({ interpolate: false })` — standing text,
 *            re-evaluated at every assembly with that assembly's agent.
 *   context  `ctx.systemPrompt.context(...)` — a per-turn runtime-context
 *            snapshot, materialized as a user-role message by the loop.
 *   message  `agent/pre-step` — a user message added to the entering batch.
 *
 * The one rule all three share: **injecting nothing must be indistinguishable
 * from not being installed.** A disabled channel, an empty selection, or a
 * store that cannot be read contributes an empty string or no message at all —
 * never an error and never an empty frame.
 *
 * @module @dsh-external/dsh-prompt/inject
 */

import { randomUUID } from 'node:crypto'
import { CONTEXT_ORDER, IDENTITY_PREFIX, MESSAGE_KIND, SYSTEM_SECTION_ORDER } from './constants.js'
import { composeInjection, injectionIdentity } from './render.js'
import { effectiveState, selectSnippets } from './snippets.js'

/** The section name the system channel registers under. */
export const SYSTEM_SECTION_NAME = 'prompt:user-snippets'

/** The context name the runtime-context channel registers under. */
export const CONTEXT_NAME = 'prompt:user-snippets'

/**
 * Build the user-role message the message channel injects.
 *
 * Constructed here rather than through the harness's `createUserMessage`, for
 * the same reason `dsh-memory` does the same: a plugin bundle that imports a
 * harness package ties itself to one installation's module graph, while the
 * message contract is a plain value the loop accepts from any producer. The
 * shape below is the one the harness's own `createUserMessage` produces.
 *
 * @param text - the framed message body.
 * @param identity - the stable identity of this injection.
 * @param count - how many snippets contributed, for the durable one-line account.
 * @returns a user message ready for a pre-step batch.
 */
function promptMessage(text, identity, count) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: MESSAGE_KIND,
      form: 'notice',
      summary: `Prompt snippets: ${count} injected.`,
      identity,
    },
  }
}

/**
 * The variables one assembly can resolve.
 *
 * Taken from the assembly's own agent rather than from `process.cwd()`, because
 * a plugin that reports the host's directory while the session works somewhere
 * else is the failure mode `dsh-memory` already documents for the panel.
 *
 * @param agent - the live agent, when the caller has one.
 * @returns `{ cwd, model, provider }`, each possibly undefined.
 */
export function variablesFor(agent) {
  return {
    cwd: agent?.session?.header?.cwd,
    model: agent?.options?.model,
    provider: agent?.options?.provider,
  }
}

/**
 * The live store snapshot shared by the seams, the routes and the panel.
 *
 * `systemPrompt.section`'s `text` callback is synchronous — the harness
 * evaluates it inline during assembly — while reading the store is async. The
 * snapshot is therefore held here and refreshed by {@link refreshStore} on
 * startup, after every write, and on a slow timer. It starts undefined, so a
 * request that arrives before the first read contributes nothing rather than
 * blocking assembly on a disk read.
 */
export class StoreCache {
  /** The last successfully read store, or undefined while cold. */
  store = undefined

  /** The last read error, for the panel to report. */
  error = null

  /** How many reads have completed, so the panel can show freshness. */
  reads = 0

  /** @param readStore - an async `(signal) => readResult`, injected so this stays testable. */
  constructor(readStore) {
    this.readStore = readStore
    this.inflight = undefined
    this.stopped = false
  }

  /**
   * Re-read the store into the snapshot.
   *
   * Concurrent callers share one in-flight read, so a burst of writes does not
   * start a burst of disk reads.
   *
   * @param signal - cancellation.
   * @returns the read result, or undefined when the read could not run.
   */
  refresh(signal) {
    if (this.stopped) return Promise.resolve(undefined)
    if (this.inflight !== undefined) return this.inflight
    this.inflight = this.readStore(signal)
      .then((read) => {
        if (read.store !== undefined) this.store = read.store
        this.error = read.error ?? null
        this.reads += 1
        return read
      })
      .catch((error) => {
        this.error = error instanceof Error ? error.message : String(error)
        return undefined
      })
      .finally(() => {
        this.inflight = undefined
      })
    return this.inflight
  }

  /** Stop refreshing; the plugin is being disposed. */
  stop() {
    this.stopped = true
  }

  /**
   * The effective state for one session out of the snapshot.
   *
   * @param sessionId - the session in scope, when there is one.
   * @returns the state, or undefined while the snapshot is cold.
   */
  stateFor(sessionId) {
    if (this.store === undefined) return undefined
    return effectiveState(this.store, sessionId)
  }

  /**
   * Compose one session's injection out of the snapshot.
   *
   * @param sessionId - the session in scope.
   * @param variables - substitution values.
   * @param maxChars - the shared character budget.
   * @returns the composition, or undefined while the snapshot is cold.
   */
  compose(sessionId, variables, maxChars) {
    if (this.store === undefined) return undefined
    return composeInjection(selectSnippets(this.store, sessionId), { variables, maxChars })
  }
}

/**
 * Whether one channel may contribute for this session.
 *
 * @param state - a {@link StoreCache.stateFor} result, possibly undefined.
 * @param channel - the channel name.
 * @returns `true` when the session is on and the channel is enabled.
 */
export function channelOpen(state, channel) {
  return state !== undefined && state.effective === true && state.inject[channel] === true
}

/**
 * Register the two system-prompt channels.
 *
 * Both are registered on the plugin's own context (global scope), and each
 * `text` callback reads the live snapshot. The system section opts out of
 * interpolation because this plugin substitutes its own variables and the
 * harness would otherwise throw on a user's literal `{{`.
 *
 * @param ctx - plugin context (must expose `systemPrompt`).
 * @param config - the resolved configuration.
 * @param cache - the live store snapshot.
 * @returns a disposer for both registrations.
 */
export function registerPromptChannels(ctx, config, cache) {
  const disposeSection = ctx.systemPrompt.section({
    name: SYSTEM_SECTION_NAME,
    order: config.sectionOrder ?? SYSTEM_SECTION_ORDER,
    interpolate: false,
    text: (context) => {
      const agent = context?.agent
      const state = cache.stateFor(agent?.session?.id)
      if (!channelOpen(state, 'system')) return ''
      return cache.compose(agent?.session?.id, variablesFor(agent), config.maxChars)?.system ?? ''
    },
  })

  const disposeContext = ctx.systemPrompt.context({
    name: CONTEXT_NAME,
    order: config.contextOrder ?? CONTEXT_ORDER,
    text: (context) => {
      const agent = context?.agent
      const state = cache.stateFor(agent?.session?.id)
      if (!channelOpen(state, 'context')) return ''
      return cache.compose(agent?.session?.id, variablesFor(agent), config.maxChars)?.context ?? ''
    },
  })

  return () => {
    disposeSection()
    disposeContext()
  }
}

/**
 * Register the per-turn user-message channel.
 *
 * The message is inserted after the entering batch's own last claimed message,
 * which is where `dsh-agent-instructions` puts its reconciliation context:
 * after the user's live message and after the runtime snapshot, so the model
 * reads the live instruction first and the standing snippet last.
 *
 * Re-injection is suppressed by identity: the same composed text is not sent
 * twice in a row, so a per-step seam does not grow the transcript by one
 * message per step.
 *
 * @param ctx - plugin context.
 * @param config - the resolved configuration.
 * @param cache - the live store snapshot.
 * @returns a disposer for the listener.
 */
export function registerMessageChannel(ctx, config, cache) {
  const lastIdentity = new WeakMap()
  return ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    signal?.throwIfAborted?.()
    const sessionId = agent?.session?.id
    const state = cache.stateFor(sessionId)
    if (!channelOpen(state, 'message')) return decision
    const injection = cache.compose(sessionId, variablesFor(agent), config.maxChars)
    if (injection === undefined || injection.chars.message === 0) return decision
    const identity = `${IDENTITY_PREFIX}:${injectionIdentity(injection, state.inject)}`
    if (lastIdentity.get(agent.session) === identity) return decision
    lastIdentity.set(agent.session, identity)
    const message = promptMessage(injection.message, identity, injection.contributed.message.length)
    // After the last claimed message, so the live user turn stays first. Matched
    // by id rather than by object identity: a listener earlier in the waterfall
    // may have rebuilt the batch, and the claimed messages are what decides the
    // position, not which array instance survived.
    const claimedIds = new Set(messages.map((message) => message?.id))
    const lastClaimed = decision.messages.findLastIndex((candidate) => claimedIds.has(candidate?.id))
    const entered = decision.messages.toSpliced(lastClaimed + 1, 0, message)
    return { ...decision, messages: entered }
  })
}
