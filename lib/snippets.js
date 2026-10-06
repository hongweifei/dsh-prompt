/**
 * The snippet model: validation, ordering, and the pure store transforms.
 *
 * Everything here is a pure function of its inputs — no filesystem, no
 * context, no clock — so the panel's routes, the store's reader and the tests
 * all share one definition of what a valid snippet is instead of each
 * re-checking the same fields differently.
 *
 * @module @dsh-external/dsh-prompt/snippets
 */

import { randomUUID } from 'node:crypto'
import {
  ENABLED_DEFAULT,
  INJECT_DEFAULTS,
  MAX_SNIPPETS,
  MAX_SNIPPET_CHARS,
  MAX_TRACKED_SESSIONS,
  OVERRIDE_DEFAULT,
  OVERRIDES,
  STORE_VERSION,
  TARGETS,
} from './constants.js'

/** The order a snippet gets when it does not declare one. */
const DEFAULT_ORDER = 100

/** Gap left between adjacent default orders, so a manual insert has room. */
const ORDER_STEP = 10

/** The longest name the panel and the store accept. */
const MAX_NAME_CHARS = 120

/**
 * Is this one of the three injection channels?
 *
 * @param value - any value.
 * @returns `true` when it names a channel.
 */
export function isTarget(value) {
  return typeof value === 'string' && TARGETS.includes(value)
}

/**
 * Is this one of the three per-session overrides?
 *
 * @param value - any value.
 * @returns `true` when it names an override.
 */
export function isOverride(value) {
  return typeof value === 'string' && OVERRIDES.includes(value)
}

/**
 * A fresh snippet id.
 *
 * Hex only, because the id travels in a query string on the delete route and a
 * character that needs escaping is a character that can be double-escaped.
 *
 * @returns an id unique enough for a hand-managed list.
 */
export function newSnippetId() {
  return `p-${randomUUID().replaceAll('-', '').slice(0, 8)}`
}

/**
 * Coerce one raw order value.
 *
 * @param value - the caller's order, of any type.
 * @param fallback - the value to use when it is not a finite number.
 * @returns a finite integer.
 */
function normalizeOrder(value, fallback) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.trunc(number)
}

/**
 * Validate and normalize one snippet as the store will hold it.
 *
 * The two rules that matter are that the text is never empty (an empty snippet
 * is a row that does nothing and cannot be told from a broken one) and that the
 * target is one of the three channels, because the target is what decides which
 * seam reads it.
 *
 * @param input - the caller's snippet, possibly partial.
 * @param options - `{ existing, id, order }` — the record being replaced, a forced id, and a fallback order.
 * @returns `{ ok: true, snippet }` or `{ ok: false, error }`.
 */
export function normalizeSnippet(input, options = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'a snippet must be a JSON object' }
  }
  const existing = options.existing
  const rawName = input.name === undefined ? existing?.name : input.name
  const name = typeof rawName === 'string' ? rawName.trim() : ''
  if (name.length === 0) return { ok: false, error: 'a snippet needs a name' }
  if (name.length > MAX_NAME_CHARS) {
    return { ok: false, error: `the name is longer than ${MAX_NAME_CHARS} characters` }
  }

  const rawText = input.text === undefined ? existing?.text : input.text
  if (typeof rawText !== 'string') return { ok: false, error: 'a snippet needs text' }
  if (rawText.trim().length === 0) return { ok: false, error: 'the text is empty' }
  if (rawText.length > MAX_SNIPPET_CHARS) {
    return { ok: false, error: `the text is longer than ${MAX_SNIPPET_CHARS} characters` }
  }

  const rawTarget = input.target === undefined ? existing?.target : input.target
  if (!isTarget(rawTarget)) {
    return { ok: false, error: `target must be one of ${TARGETS.join(', ')}` }
  }

  const rawEnabled = input.enabled === undefined ? existing?.enabled : input.enabled
  const enabled = rawEnabled === undefined ? true : rawEnabled === true || rawEnabled === 'true'

  const order = normalizeOrder(
    input.order === undefined ? existing?.order : input.order,
    options.order ?? existing?.order ?? DEFAULT_ORDER,
  )

  const id = options.id ?? existing?.id ?? newSnippetId()
  return { ok: true, snippet: { id, name, text: rawText, target: rawTarget, enabled, order } }
}

/**
 * The order a new snippet should take inside one channel: after every existing
 * one, so a fresh snippet lands at the end of its group rather than in the
 * middle of a deliberate sequence.
 *
 * @param snippets - every snippet currently stored.
 * @param target - the channel the new snippet belongs to.
 * @returns the next order value.
 */
export function nextOrder(snippets, target) {
  let highest = undefined
  for (const snippet of snippets) {
    if (snippet.target !== target) continue
    if (highest === undefined || snippet.order > highest) highest = snippet.order
  }
  return highest === undefined ? DEFAULT_ORDER : highest + ORDER_STEP
}

/**
 * Sort snippets for display and for injection.
 *
 * Channel order is the panel's own (`TARGETS`), then the snippet's `order`,
 * then its name in code-unit order — the same deterministic tiebreak the
 * harness uses for prompt sections, so two snippets that share an order do not
 * swap places between runs.
 *
 * @param snippets - the snippets to sort.
 * @returns a new array, sorted.
 */
export function sortSnippets(snippets) {
  return [...snippets].sort((left, right) => {
    const byTarget = TARGETS.indexOf(left.target) - TARGETS.indexOf(right.target)
    if (byTarget !== 0) return byTarget
    if (left.order !== right.order) return left.order - right.order
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  })
}

/**
 * Count the stored snippets per channel.
 *
 * @param snippets - every snippet.
 * @returns `{ system, context, message }` counts.
 */
export function countByTarget(snippets) {
  const counts = { system: 0, context: 0, message: 0 }
  for (const snippet of snippets) {
    if (isTarget(snippet.target)) counts[snippet.target] += 1
  }
  return counts
}

/**
 * The empty store: what a fresh installation reads as.
 *
 * @returns a store with the defaults and no snippets.
 */
export function createStore() {
  return {
    version: STORE_VERSION,
    enabled: ENABLED_DEFAULT,
    inject: { ...INJECT_DEFAULTS },
    snippets: [],
    sessions: {},
  }
}

/**
 * Coerce a value read from disk into a store, dropping anything malformed.
 *
 * A store file is hand-editable and may have been written by an older build, so
 * this never throws: an unreadable snippet is dropped rather than taking the
 * whole file down, and the caller can report the count it lost. There is no
 * migration — a version mismatch abandons the old shape (the plugin's own rule,
 * see `plugin-internals.md`).
 *
 * @param raw - the parsed JSON, of unknown shape.
 * @returns `{ store, dropped }` — the normalized store and how many snippets were discarded.
 */
export function normalizeStore(raw) {
  const store = createStore()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { store, dropped: 0 }
  if (raw.version !== STORE_VERSION) return { store, dropped: 0 }

  if (typeof raw.enabled === 'boolean') store.enabled = raw.enabled
  if (raw.inject !== null && typeof raw.inject === 'object' && !Array.isArray(raw.inject)) {
    for (const target of TARGETS) {
      if (typeof raw.inject[target] === 'boolean') store.inject[target] = raw.inject[target]
    }
  }

  let dropped = 0
  const seen = new Set()
  const list = Array.isArray(raw.snippets) ? raw.snippets : []
  for (const entry of list) {
    if (store.snippets.length >= MAX_SNIPPETS) {
      dropped += 1
      continue
    }
    const result = normalizeSnippet(entry, { id: typeof entry?.id === 'string' ? entry.id : undefined })
    // A duplicate id would make one of the two unreachable from the panel, so
    // the later copy is the one discarded.
    if (!result.ok || seen.has(result.snippet.id)) {
      dropped += 1
      continue
    }
    seen.add(result.snippet.id)
    store.snippets.push(result.snippet)
  }

  const sessions = raw.sessions !== null && typeof raw.sessions === 'object' && !Array.isArray(raw.sessions) ? raw.sessions : {}
  const entries = Object.entries(sessions).filter(([, value]) => value !== null && typeof value === 'object')
  // Newest first, then capped: the cap has to be applied on a deterministic
  // order, or which sessions survive would depend on JSON key order.
  entries.sort((left, right) => (right[1].updatedAt ?? 0) - (left[1].updatedAt ?? 0))
  for (const [sessionId, value] of entries.slice(0, MAX_TRACKED_SESSIONS)) {
    const record = { override: OVERRIDE_DEFAULT, extras: [], updatedAt: normalizeOrder(value.updatedAt, 0) }
    if (isOverride(value.override)) record.override = value.override
    if (Array.isArray(value.extras)) {
      for (const entry of value.extras) {
        const result = normalizeSnippet(entry, { id: typeof entry?.id === 'string' ? entry.id : undefined })
        if (result.ok) record.extras.push(result.snippet)
      }
    }
    store.sessions[sessionId] = record
  }

  return { store, dropped }
}

/**
 * Insert or replace one snippet.
 *
 * @param store - the store to change (not mutated).
 * @param snippet - a normalized snippet.
 * @returns a new store.
 */
export function upsertSnippet(store, snippet) {
  const index = store.snippets.findIndex((candidate) => candidate.id === snippet.id)
  const snippets = [...store.snippets]
  if (index === -1) snippets.push(snippet)
  else snippets[index] = snippet
  return { ...store, snippets }
}

/**
 * Remove one snippet by id.
 *
 * @param store - the store to change (not mutated).
 * @param id - the snippet id.
 * @returns `{ store, removed }` — `removed` is the snippet that left, or `undefined`.
 */
export function removeSnippet(store, id) {
  const removed = store.snippets.find((candidate) => candidate.id === id)
  if (removed === undefined) return { store, removed: undefined }
  return { store: { ...store, snippets: store.snippets.filter((candidate) => candidate.id !== id) }, removed }
}

/**
 * The record a session carries: its override and its session-only snippets.
 *
 * @param store - the store.
 * @param sessionId - the session to read.
 * @returns the record, or a default one when the session never made a choice.
 */
export function sessionRecord(store, sessionId) {
  const found = typeof sessionId === 'string' ? store.sessions[sessionId] : undefined
  if (found === undefined) return { override: OVERRIDE_DEFAULT, extras: [], updatedAt: 0 }
  return found
}

/**
 * Apply one change to a session's record, keeping the store bounded.
 *
 * @param store - the store to change (not mutated).
 * @param sessionId - the session the change belongs to.
 * @param change - `{ override?, extras?, clearExtras? }`.
 * @param now - the timestamp to record, supplied by the caller so this stays pure.
 * @returns a new store.
 */
export function setSession(store, sessionId, change, now) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return store
  const current = sessionRecord(store, sessionId)
  const next = {
    override: change.override !== undefined && isOverride(change.override) ? change.override : current.override,
    extras: change.clearExtras === true ? [] : (change.extras ?? current.extras),
    updatedAt: now,
  }
  const sessions = { ...store.sessions, [sessionId]: next }
  const keys = Object.keys(sessions)
  if (keys.length > MAX_TRACKED_SESSIONS) {
    keys.sort((left, right) => (sessions[left].updatedAt ?? 0) - (sessions[right].updatedAt ?? 0))
    for (const key of keys.slice(0, keys.length - MAX_TRACKED_SESSIONS)) delete sessions[key]
  }
  return { ...store, sessions }
}

/**
 * Drop a session's record entirely, so it goes back to following the global
 * switches with no extras.
 *
 * @param store - the store to change (not mutated).
 * @param sessionId - the session to forget.
 * @returns a new store.
 */
export function clearSession(store, sessionId) {
  if (typeof sessionId !== 'string' || store.sessions[sessionId] === undefined) return store
  const sessions = { ...store.sessions }
  delete sessions[sessionId]
  return { ...store, sessions }
}

/**
 * The global switches, as the panel and the seams read them.
 *
 * @param store - the store.
 * @returns `{ enabled, inject }`.
 */
export function globalSwitches(store) {
  return { enabled: store.enabled === true, inject: { ...store.inject } }
}

/**
 * The effective injection state for one session.
 *
 * `auto` follows the global switch, `on` forces injection on, `off` forces it
 * off. The resolved value is reported separately from the override so the panel
 * can say both "you chose on" and "it is on" without conflating them.
 *
 * @param store - the store.
 * @param sessionId - the session in scope, when there is one.
 * @returns `{ override, effective, inject }`.
 */
export function effectiveState(store, sessionId) {
  const record = sessionRecord(store, sessionId)
  const override = record.override
  const globallyOn = store.enabled === true
  const effective = override === 'on' ? true : override === 'off' ? false : globallyOn
  return { override, effective, inject: { ...store.inject } }
}

/**
 * Every snippet that applies to one session, in injection order.
 *
 * Session extras are appended after the stored snippets of their channel: they
 * were written for this session, so they are the most specific text and belong
 * last, where a more specific instruction belongs.
 *
 * @param store - the store.
 * @param sessionId - the session in scope, when there is one.
 * @returns `{ system, context, message }` arrays of snippets.
 */
export function selectSnippets(store, sessionId) {
  const extras = sessionRecord(store, sessionId).extras
  const selected = { system: [], context: [], message: [] }
  for (const snippet of sortSnippets([...store.snippets, ...extras])) {
    if (snippet.enabled !== true) continue
    if (!isTarget(snippet.target)) continue
    selected[snippet.target].push(snippet)
  }
  return selected
}
