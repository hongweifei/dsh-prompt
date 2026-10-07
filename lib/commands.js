/**
 * Human-facing slash commands.
 *
 * The panel is the full interface; these are the paths that are faster from the
 * keyboard, and the ones that work in a profile with no web connection at all.
 * Every one of them reports what it did, because a command that changes
 * injection and says nothing is a command the user cannot trust.
 *
 * @module @dsh-external/dsh-prompt/commands
 */

import { TARGETS, TARGET_PURPOSE } from './constants.js'
import { updateStore } from './store.js'
import { clearSession, countByTarget, nextOrder, normalizeSnippet, removeSnippet, setSession, sortSnippets, upsertSnippet } from './snippets.js'

/**
 * One line describing a snippet, for a command's output.
 *
 * @param snippet - the snippet.
 * @param marker - a prefix marking the row, e.g. a selection caret.
 * @returns the line.
 */
function describe(snippet, marker) {
  const state = snippet.enabled === true ? 'on ' : 'off'
  const text = snippet.text.replaceAll(/\s+/g, ' ').trim()
  const preview = text.length > 48 ? `${text.slice(0, 48)}…` : text
  return `${marker}${snippet.id}  [${state}] ${snippet.target}  ${snippet.name}  —  ${preview}`
}

/**
 * Register the plugin's slash commands.
 *
 * @param ctx - plugin context (must expose `commands`).
 * @param config - the resolved configuration.
 * @param cache - the live store snapshot.
 * @param lifecycle - the plugin's lifetime signal.
 */
export function registerCommands(ctx, config, cache, lifecycle) {
  /**
   * Run one store mutation and refresh the snapshot.
   *
   * @param mutate - `(store) => store`.
   * @returns the outcome.
   */
  const write = async (mutate) => {
    const fs = ctx.get('fs')
    if (fs === undefined) return { ok: false, error: 'no filesystem provider is mounted' }
    const outcome = await updateStore(fs, mutate, lifecycle.signal)
    if (outcome.ok) await cache.refresh(lifecycle.signal)
    return outcome
  }

  /** The live store, or undefined when it cannot be read. */
  const storeNow = async () => {
    if (cache.store !== undefined) return cache.store
    await cache.refresh(lifecycle.signal)
    return cache.store
  }

  ctx.commands.register({
    name: 'prompt',
    description: 'List the prompt snippets and what each channel would inject.',
    input: { hint: '[list|on|off|status]' },
    async handler({ agent, rawInput }) {
      const action = String(rawInput ?? '').trim().toLowerCase() || 'list'
      const store = await storeNow()
      if (store === undefined) return { kind: 'error', text: 'prompt: the snippet store could not be read' }
      const sessionId = agent?.session?.id

      if (action === 'on' || action === 'off') {
        const outcome = await write((current) => ({ ...current, defaultEnabled: action === 'on' }))
        if (!outcome.ok) return { kind: 'error', text: `prompt: ${outcome.error}` }
        return {
          kind: 'success',
          text: `prompt: default mode is now ${action === 'on' ? 'on' : 'off'} — sessions that chose for themselves are unaffected`,
        }
      }

      const lines = [`prompt: default mode ${store.defaultEnabled ? 'on' : 'off'}`]
      lines.push(
        `channels: ${TARGETS.map((target) => `${target}=${store.inject[target] ? 'on' : 'off'}`).join('  ')}`,
      )
      const state = cache.stateFor(sessionId)
      if (state !== undefined) {
        lines.push(`this session: override=${state.override} effective=${state.effective ? 'on' : 'off'}`)
      }
      const counts = countByTarget(store.snippets)
      lines.push(`snippets: ${TARGETS.map((target) => `${target}=${counts[target]}`).join('  ')}  (budget ${config.maxChars} chars)`)
      const ordered = sortSnippets(store.snippets)
      if (ordered.length === 0) lines.push('  (none yet — add one in Settings → Prompt, or with /prompt-add)')
      for (const snippet of ordered) lines.push(describe(snippet, '  '))
      const extras = sessionId === undefined ? [] : sortSnippets(store.sessions[sessionId]?.extras ?? [])
      if (extras.length > 0) {
        lines.push('session-only:')
        for (const snippet of extras) lines.push(describe(snippet, '  '))
      }
      return { kind: 'success', text: lines.join('\n') }
    },
  })

  ctx.commands.register({
    name: 'prompt-add',
    description: 'Add a prompt snippet: /prompt-add <name> | <target> | <text>.',
    input: { hint: '<name> | <target> | <text>' },
    async handler({ rawInput }) {
      const raw = String(rawInput ?? '')
      const parts = raw.split('|')
      if (parts.length < 3) {
        return { kind: 'error', text: 'prompt-add: use <name> | <system|context|message> | <text>' }
      }
      const name = parts[0].trim()
      const target = parts[1].trim()
      const text = parts.slice(2).join('|').trim()
      if (!TARGETS.includes(target)) {
        return { kind: 'error', text: `prompt-add: target must be one of ${TARGETS.join(', ')}` }
      }
      let added
      let failure
      const outcome = await write((store) => {
        const normalized = normalizeSnippet({ name, text, target, enabled: true }, { order: nextOrder(store.snippets, target) })
        if (!normalized.ok) {
          failure = normalized.error
          return store
        }
        added = normalized.snippet
        return upsertSnippet(store, normalized.snippet)
      })
      if (failure !== undefined) return { kind: 'error', text: `prompt-add: ${failure}` }
      if (!outcome.ok) return { kind: 'error', text: `prompt-add: ${outcome.error}` }
      return {
        kind: 'success',
        text: `prompt: added ${added.id} to ${target} — ${TARGET_PURPOSE[target]}`,
      }
    },
  })

  ctx.commands.register({
    name: 'prompt-remove',
    description: 'Delete one prompt snippet by id: /prompt-remove <id>.',
    input: { hint: '<id>' },
    async handler({ rawInput }) {
      const id = String(rawInput ?? '').trim()
      if (id.length === 0) return { kind: 'error', text: 'prompt-remove: an id is required (see /prompt)' }
      let removed
      const outcome = await write((store) => {
        const result = removeSnippet(store, id)
        removed = result.removed
        return result.store
      })
      if (!outcome.ok) return { kind: 'error', text: `prompt-remove: ${outcome.error}` }
      if (removed === undefined) return { kind: 'error', text: `prompt-remove: no snippet with id ${id}` }
      return { kind: 'success', text: `prompt: deleted ${removed.id} (${removed.name})` }
    },
  })

  ctx.commands.register({
    name: 'prompt-session',
    description: 'Turn injection on or off for THIS session, or add a session-only snippet.',
    input: { hint: '[auto|on|off|clear] [text]' },
    async handler({ agent, rawInput }) {
      const sessionId = agent?.session?.id
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        return { kind: 'error', text: 'prompt-session: no session is in scope' }
      }
      const raw = String(rawInput ?? '').trim()
      const space = raw.indexOf(' ')
      const action = (space === -1 ? raw : raw.slice(0, space)).toLowerCase() || 'status'
      const rest = space === -1 ? '' : raw.slice(space + 1).trim()

      if (action === 'status') {
        const store = await storeNow()
        if (store === undefined) return { kind: 'error', text: 'prompt-session: the snippet store could not be read' }
        const state = cache.stateFor(sessionId)
        const extras = sortSnippets(store.sessions[sessionId]?.extras ?? [])
        return {
          kind: 'success',
          text: [
            `prompt: this session override=${state?.override ?? 'auto'} effective=${state?.effective ? 'on' : 'off'}`,
            `session-only snippets: ${extras.length}`,
            ...extras.map((snippet) => describe(snippet, '  ')),
          ].join('\n'),
        }
      }

      if (action === 'add') {
        if (rest.length === 0) return { kind: 'error', text: 'prompt-session add: the snippet text is required' }
        let failure
        const outcome = await write((store) => {
          const current = store.sessions[sessionId]?.extras ?? []
          const normalized = normalizeSnippet(
            { name: `session-${current.length + 1}`, text: rest, target: 'message', enabled: true },
            { order: nextOrder(current, 'message') },
          )
          if (!normalized.ok) {
            failure = normalized.error
            return store
          }
          return setSession(store, sessionId, { extras: [...current, normalized.snippet] }, Date.now())
        })
        if (failure !== undefined) return { kind: 'error', text: `prompt-session: ${failure}` }
        if (!outcome.ok) return { kind: 'error', text: `prompt-session: ${outcome.error}` }
        return { kind: 'success', text: 'prompt: added a session-only snippet to the message channel' }
      }

      if (action === 'clear') {
        const outcome = await write((store) => clearSession(store, sessionId))
        if (!outcome.ok) return { kind: 'error', text: `prompt-session: ${outcome.error}` }
        return { kind: 'success', text: 'prompt: this session follows the global switches again' }
      }

      if (!['auto', 'on', 'off'].includes(action)) {
        return { kind: 'error', text: `prompt-session: unknown action "${action}" — use status, auto, on, off, add or clear` }
      }
      const outcome = await write((store) => setSession(store, sessionId, { override: action }, Date.now()))
      if (!outcome.ok) return { kind: 'error', text: `prompt-session: ${outcome.error}` }
      const state = cache.stateFor(sessionId)
      return {
        kind: 'success',
        text: `prompt: this session override=${action} (effective=${state?.effective ? 'on' : 'off'})`,
      }
    },
  })
}
