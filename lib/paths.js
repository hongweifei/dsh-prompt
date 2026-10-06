/**
 * Where this plugin keeps its data.
 *
 * One file, under the harness home rather than any workspace: snippets are a
 * cross-project preference, so a snippet written while working in one project
 * must still be there in the next. The harness's own `$DSH_HOME` convention is
 * followed exactly (see `dsh-memory`'s `paths.js` for the same decision).
 *
 * @module @dsh-external/dsh-prompt/paths
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** Resolve the harness home directory, matching dsh-home-paths. */
export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return join(homedir(), '.dsh')
}

/**
 * This plugin's own directory under the harness home.
 *
 * @returns the absolute directory path (not necessarily existing).
 */
export function promptDir() {
  return join(resolveDshHome(), 'prompt')
}

/**
 * The snippet store.
 *
 * @returns the absolute path of the JSON file this plugin owns.
 */
export function storePath() {
  return join(promptDir(), 'snippets.json')
}

/**
 * A short, readable label for a session id, for the panel's session row.
 *
 * Session ids are `session-<uuid>`; the uuid alone is noise in a row that also
 * carries a working directory, so the first eight characters are enough to tell
 * two sessions apart without pretending to be the whole identity.
 *
 * @param sessionId - the raw session id, when there is one.
 * @returns the short form, or `undefined` when no id was supplied.
 */
export function shortSessionId(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
  const bare = sessionId.startsWith('session-') ? sessionId.slice('session-'.length) : sessionId
  return bare.length <= 8 ? bare : bare.slice(0, 8)
}
