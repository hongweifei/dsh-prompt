/**
 * The `ctx.prompt` runtime service.
 *
 * The panel, the slash commands and any other plugin read the same facts from
 * here, so there is one answer to "what is injected right now" rather than one
 * per consumer. The service never writes: writes go through `store.js`, which
 * owns the freshness discipline, and the caller refreshes the snapshot after.
 *
 * @module @dsh-external/dsh-prompt/service
 */

import { countByTarget, globalSwitches, selectSnippets, sessionRecord, sortSnippets } from './snippets.js'
import { storePath } from './paths.js'
import { messageOf, readStore } from './store.js'
import { composeInjection } from './render.js'

/**
 * Build the service object registered as `ctx.prompt`.
 *
 * @param ctx - plugin context.
 * @param config - the resolved configuration.
 * @param cache - the live store snapshot.
 * @param lifecycle - the plugin's lifetime signal.
 * @returns the service value.
 */
export function createPromptService(ctx, config, cache, lifecycle) {
  /**
   * The live store, or a fresh read when the snapshot is still cold.
   *
   * A panel opened before the first timer tick must not be told the plugin
   * holds nothing, so the cold case reads once rather than reporting emptiness.
   *
   * @returns `{ store, error }`.
   */
  const liveStore = async () => {
    if (cache.store !== undefined) return { store: cache.store, error: cache.error }
    const fs = ctx.get('fs')
    if (fs === undefined) return { store: undefined, error: 'no filesystem provider is mounted' }
    const read = await readStore(fs, lifecycle.signal).catch((failure) => ({ store: undefined, error: messageOf(failure) }))
    return { store: read.store, error: read.error ?? null }
  }

  /**
   * The full status snapshot the panel polls.
   *
   * @param request - `{ session }` — the session the caller speaks for.
   * @returns the status payload.
   */
  const status = async (request = {}) => {
    const { store, error } = await liveStore()
    const session = request?.session
    const sessionId = session?.id
    const fallback = store === undefined ? undefined : { ...globalSwitches(store), override: 'auto', effective: store.defaultEnabled === true }
    const state = store === undefined ? undefined : cache.stateFor(sessionId) ?? fallback
    const record = store === undefined ? { override: 'auto', extras: [] } : sessionRecord(store, sessionId)
    const snippets = store === undefined ? [] : sortSnippets(store.snippets)
    const composed = store === undefined ? undefined : composeInjection(selectSnippets(store, sessionId), { variables: {}, maxChars: config.maxChars })
    return {
      // The settings panel's "default mode": what a session that has not chosen gets.
      defaultEnabled: store === undefined ? false : store.defaultEnabled === true,
      inject: state?.inject ?? { system: true, context: true, message: true },
      snippets,
      counts: countByTarget(snippets),
      session:
        sessionId === undefined
          ? null
          : {
              id: sessionId,
              cwd: session?.header?.cwd,
              override: state?.override ?? 'auto',
              effective: state?.effective ?? false,
              extras: sortSnippets(record.extras ?? []),
            },
      budget: { maxChars: config.maxChars, usedChars: composed?.usedChars ?? 0 },
      storage: { path: storePath(), exists: store !== undefined, mtimeMs: undefined, error: error ?? null },
    }
  }

  return {
    /**
     * The full status snapshot.
     *
     * @param request - `{ session }`.
     * @returns the status payload.
     */
    status,

    /**
     * What each channel would inject for one session, without changing anything.
     *
     * Composing is pure, so a preview cannot alter what the next real request
     * sends — the property `dsh-memory`'s preview also had to guarantee.
     *
     * @param session - the session to speak for, when there is one.
     * @returns the preview payload.
     */
    async preview(session) {
      const sessionId = session?.id
      if (sessionId === undefined) {
        return { available: false, reason: 'no session is in scope: a preview has to speak for one' }
      }
      const { store } = await liveStore()
      if (store === undefined) return { available: false, reason: 'the snippet store has not been read yet' }
      const composed = composeInjection(selectSnippets(store, sessionId), { variables: {}, maxChars: config.maxChars })
      const state = cache.stateFor(sessionId) ?? { ...globalSwitches(store), override: 'auto', effective: store.defaultEnabled === true }
      const effective = state.effective === true
      const channel = (name) => ({
        text: effective && state.inject[name] === true ? composed[name] : '',
        chars: effective && state.inject[name] === true ? composed.chars[name] : 0,
        snippets: composed.contributed[name],
      })
      return {
        available: true,
        reason: null,
        session: { id: sessionId, cwd: session?.header?.cwd, override: state.override, effective },
        system: channel('system'),
        context: channel('context'),
        message: channel('message'),
        notes: effective ? composed.notes : [{ code: 'off' }],
        budget: { maxChars: config.maxChars, usedChars: composed.usedChars },
      }
    },

    /** Re-read the store into the live snapshot. */
    refresh: () => cache.refresh(lifecycle.signal),

    /** The live snapshot's last read error, when it had one. */
    lastError: () => cache.error,
  }
}
