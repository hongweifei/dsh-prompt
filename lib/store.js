/**
 * The snippet store on disk.
 *
 * One JSON file under `$DSH_HOME/prompt`, read and written through the
 * harness's `ctx.fs` provider rather than `node:fs`, so the plugin obeys
 * whatever filesystem the deployment composes (including a provider that
 * cannot see the host's paths at all).
 *
 * Writes follow the same freshness discipline `dsh-memory` uses: a version is
 * carried from the read and re-checked at the write, so a store edited by
 * another window or another process is not silently overwritten. A conflict is
 * reported, not resolved by force.
 *
 * @module @dsh-external/dsh-prompt/store
 */

import { createStore, normalizeStore } from './snippets.js'
import { promptDir, storePath } from './paths.js'

/** Freshness error codes a retry can resolve. */
const RETRYABLE_CODES = new Set(['FS_STALE_VERSION', 'FS_NOT_OBSERVED'])

/** How many times a write that lost a freshness race is retried. */
const MAX_WRITE_ATTEMPTS = 3

/**
 * The sandbox policy a store write runs under.
 *
 * The store lives under `$DSH_HOME` — outside every session workspace — so the
 * plugin declares its own directory as the workspace root, exactly as
 * `dsh-memory` does with its `memory-root` policy. Without this, a
 * `workspace-write` deployment would refuse to save a snippet at all.
 *
 * @returns the per-call policy.
 */
function storePolicy() {
  return { mode: 'workspace-write', workspaceRoot: promptDir() }
}

/**
 * Read the store.
 *
 * A missing file is a fresh installation, not an error. A malformed file is
 * reported through `error` while the in-memory store falls back to the
 * defaults, so the panel can say what happened instead of showing an empty list
 * as if the user had deleted everything.
 *
 * @param fs - the composed filesystem.
 * @param signal - cancellation.
 * @returns `{ store, version, exists, mtimeMs, dropped, error }`.
 */
export async function readStore(fs, signal) {
  const path = storePath()
  let target
  let info
  try {
    target = await fs.resolve(path, { signal })
    info = await fs.stat(target, signal)
  } catch (error) {
    return { store: createStore(), version: undefined, exists: false, mtimeMs: undefined, dropped: 0, error: messageOf(error) }
  }
  if (info === undefined || info.type !== 'file') {
    return { store: createStore(), version: undefined, exists: false, mtimeMs: undefined, dropped: 0, error: null }
  }
  let text
  try {
    text = await fs.readText(target, signal)
  } catch (error) {
    return { store: createStore(), version: info.version, exists: true, mtimeMs: undefined, dropped: 0, error: messageOf(error) }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return {
      store: createStore(),
      version: info.version,
      exists: true,
      mtimeMs: undefined,
      dropped: 0,
      error: `the store file is not valid JSON: ${messageOf(error)}`,
    }
  }
  const { store, dropped } = normalizeStore(parsed)
  return { store, version: info.version, exists: true, mtimeMs: undefined, dropped, error: null }
}

/**
 * Write the store, refusing to clobber a version the caller did not read.
 *
 * @param fs - the composed filesystem.
 * @param store - the store to persist.
 * @param expectedVersion - the version carried from the read, when there was one.
 * @param signal - cancellation.
 * @returns `{ ok: true }` or `{ ok: false, error }`.
 */
export async function writeStore(fs, store, expectedVersion, signal) {
  const path = storePath()
  const text = `${JSON.stringify(store, null, 2)}\n`
  let lastError
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    let target
    try {
      target = await fs.resolve(path, { signal })
    } catch (error) {
      return { ok: false, error: messageOf(error) }
    }
    const info = await fs.stat(target, signal).catch(() => undefined)
    const intent =
      info === undefined
        ? { kind: 'createIfAbsent' }
        : expectedVersion === undefined
          ? { kind: 'replaceIfVersion', version: info.version }
          : { kind: 'replaceIfVersion', version: expectedVersion }
    try {
      await fs.writeText(target, text, intent, signal, storePolicy())
      return { ok: true }
    } catch (error) {
      lastError = error
      const code = error !== null && typeof error === 'object' ? error.code : undefined
      // A stale version is the one failure worth retrying, and only when the
      // caller did not pin a version: retrying a pinned write would defeat it.
      if (attempt < MAX_WRITE_ATTEMPTS - 1 && RETRYABLE_CODES.has(code) && expectedVersion === undefined) continue
      return { ok: false, error: messageOf(error) }
    }
  }
  return { ok: false, error: messageOf(lastError) }
}

/**
 * Read, change and write the store in one step.
 *
 * The read is repeated on a lost race, so a change made by another writer is
 * rebased onto rather than discarded — but only when the mutation itself can be
 * replayed, which is why the caller passes a function rather than a value.
 *
 * @param fs - the composed filesystem.
 * @param mutate - `(store) => store`, a pure transform.
 * @param signal - cancellation.
 * @returns `{ ok, store, error }`.
 */
export async function updateStore(fs, mutate, signal) {
  let last
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const read = await readStore(fs, signal)
    const next = mutate(read.store)
    const written = await writeStore(fs, next, undefined, signal)
    if (written.ok) return { ok: true, store: next, error: null }
    last = written.error
    const code = typeof last === 'string' && last.includes('stale') ? true : false
    if (!code) break
  }
  return { ok: false, store: undefined, error: last ?? 'the store could not be written' }
}

/**
 * Describe an unknown error as one line.
 *
 * @param error - the thrown value.
 * @returns a human-readable message.
 */
export function messageOf(error) {
  if (error === null || error === undefined) return 'unknown error'
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
