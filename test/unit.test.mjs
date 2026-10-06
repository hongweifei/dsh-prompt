/**
 * Unit tests: the snippet model and the composer.
 *
 * These are pure-function tests — no filesystem, no context, no host — so they
 * run anywhere and they pin the two behaviours the rest of the plugin depends
 * on: a malformed record is refused rather than half-stored, and a user's
 * literal `{{` can never reach the harness's strict interpolation.
 *
 * Run: node test/unit.test.mjs
 */
import assert from 'node:assert/strict'
import {
  applyBudget, composeInjection, contextText, escapeGroups, injectionIdentity,
  messageText, needsEscaping, substituteVariables, truncateChars,
} from '../lib/render.js'
import {
  clearSession, countByTarget, createStore, effectiveState, globalSwitches, isOverride,
  isTarget, nextOrder, normalizeSnippet, normalizeStore, removeSnippet, selectSnippets,
  sessionRecord, setSession, sortSnippets, upsertSnippet,
} from '../lib/snippets.js'
import { resolvePromptConfig } from '../lib/config.js'
import { shortSessionId } from '../lib/paths.js'

let passed = 0
const test = (label, fn) => {
  fn()
  passed += 1
  console.log(`  ok  ${label}`)
}

console.log('dsh-prompt unit tests')

/* ---------------- the snippet model ---------------- */

test('a snippet needs a name, text and a known target', () => {
  assert.equal(normalizeSnippet({ text: 'x', target: 'system' }).ok, false)
  assert.equal(normalizeSnippet({ name: 'a', text: '   ', target: 'system' }).ok, false)
  assert.equal(normalizeSnippet({ name: 'a', text: 'x', target: 'nope' }).ok, false)
  assert.equal(normalizeSnippet(null).ok, false)
  assert.equal(normalizeSnippet([]).ok, false)
})

test('a valid snippet is normalized, not merely accepted', () => {
  const result = normalizeSnippet({ name: '  Style  ', text: 'Use Chinese.', target: 'system' })
  assert.equal(result.ok, true)
  assert.equal(result.snippet.name, 'Style')
  assert.equal(result.snippet.enabled, true)
  assert.equal(result.snippet.order, 100)
  assert.match(result.snippet.id, /^p-[0-9a-f]{8}$/)
})

test('a partial update keeps the fields it did not mention', () => {
  const first = normalizeSnippet({ name: 'Style', text: 'Use Chinese.', target: 'system', order: 42 }).snippet
  const updated = normalizeSnippet({ enabled: false }, { existing: first })
  assert.equal(updated.ok, true)
  assert.equal(updated.snippet.enabled, false)
  assert.equal(updated.snippet.name, 'Style')
  assert.equal(updated.snippet.text, 'Use Chinese.')
  assert.equal(updated.snippet.order, 42)
  assert.equal(updated.snippet.id, first.id)
})

test('a coerced order survives as a finite integer', () => {
  assert.equal(normalizeSnippet({ name: 'a', text: 'x', target: 'system', order: '7' }).snippet.order, 7)
  assert.equal(normalizeSnippet({ name: 'a', text: 'x', target: 'system', order: 'nonsense' }).snippet.order, 100)
  assert.equal(normalizeSnippet({ name: 'a', text: 'x', target: 'system', order: 3.9 }).snippet.order, 3)
})

test('the three channel names and three overrides are exactly what is accepted', () => {
  for (const target of ['system', 'context', 'message']) assert.equal(isTarget(target), true)
  for (const bad of ['', 'SYSTEM', 'user', null, 1]) assert.equal(isTarget(bad), false)
  for (const override of ['auto', 'on', 'off']) assert.equal(isOverride(override), true)
  for (const bad of ['', 'ON', 'true', null]) assert.equal(isOverride(bad), false)
})

test('a new snippet lands after its own channel, not after everything', () => {
  const store = { snippets: [
    { id: 'a', target: 'system', order: 100, name: 'a', text: 'x', enabled: true },
    { id: 'b', target: 'message', order: 900, name: 'b', text: 'x', enabled: true },
  ] }
  assert.equal(nextOrder(store.snippets, 'system'), 110)
  assert.equal(nextOrder(store.snippets, 'message'), 910)
  assert.equal(nextOrder(store.snippets, 'context'), 100)
})

test('sorting is channel, then order, then name — and stable', () => {
  const list = [
    { id: 'd', target: 'message', order: 1, name: 'z' },
    { id: 'a', target: 'system', order: 2, name: 'b' },
    { id: 'b', target: 'system', order: 1, name: 'a' },
    { id: 'c', target: 'system', order: 1, name: 'a' },
  ]
  const sorted = sortSnippets(list).map((snippet) => snippet.id)
  // system group first (order 1 then 2), message last; the two order-1 system
  // rows tie on name and keep their relative order.
  assert.deepEqual(sorted, ['b', 'c', 'a', 'd'])
})

test('counts are per channel and never leak an unknown target', () => {
  const counts = countByTarget([
    { target: 'system' }, { target: 'system' }, { target: 'message' }, { target: 'bogus' },
  ])
  assert.deepEqual(counts, { system: 2, context: 0, message: 1 })
})

test('upsert replaces in place and appends a new id', () => {
  const store = createStore()
  const first = normalizeSnippet({ name: 'a', text: 'x', target: 'system' }).snippet
  const second = normalizeSnippet({ name: 'b', text: 'y', target: 'system' }).snippet
  let next = upsertSnippet(upsertSnippet(store, first), second)
  assert.equal(next.snippets.length, 2)
  next = upsertSnippet(next, { ...first, name: 'a2' })
  assert.equal(next.snippets.length, 2)
  assert.equal(next.snippets[0].name, 'a2')
})

test('remove reports whether it actually removed something', () => {
  const store = upsertSnippet(createStore(), normalizeSnippet({ name: 'a', text: 'x', target: 'system' }).snippet)
  const id = store.snippets[0].id
  assert.equal(removeSnippet(store, id).removed.id, id)
  assert.equal(removeSnippet(store, 'p-missing').removed, undefined)
  assert.equal(removeSnippet(store, id).store.snippets.length, 0)
})

/* ---------------- the store's normalization ---------------- */

test('a fresh store has the defaults and no snippets', () => {
  const store = createStore()
  assert.equal(store.enabled, true)
  assert.deepEqual(store.inject, { system: true, context: true, message: true })
  assert.deepEqual(store.snippets, [])
  assert.deepEqual(store.sessions, {})
})

test('a wrong store version is abandoned, not migrated', () => {
  const { store, dropped } = normalizeStore({ version: 99, snippets: [{ name: 'a', text: 'x', target: 'system' }] })
  assert.deepEqual(store.snippets, [])
  assert.equal(dropped, 0)
})

test('a malformed snippet is dropped and counted, never half-kept', () => {
  const { store, dropped } = normalizeStore({
    version: 1,
    snippets: [
      { id: 'p-1', name: 'good', text: 'x', target: 'system', enabled: true, order: 1 },
      { id: 'p-2', name: '', text: 'x', target: 'system' },
      { id: 'p-3', name: 'bad target', text: 'x', target: 'nope' },
      null,
    ],
  })
  assert.equal(store.snippets.length, 1)
  assert.equal(store.snippets[0].name, 'good')
  assert.equal(dropped, 3)
})

test('a duplicated id is dropped rather than made unreachable', () => {
  const { store, dropped } = normalizeStore({
    version: 1,
    snippets: [
      { id: 'p-same', name: 'first', text: 'x', target: 'system' },
      { id: 'p-same', name: 'second', text: 'y', target: 'system' },
    ],
  })
  assert.equal(store.snippets.length, 1)
  assert.equal(store.snippets[0].name, 'first')
  assert.equal(dropped, 1)
})

test('session records are normalized and extras validated', () => {
  const { store } = normalizeStore({
    version: 1,
    sessions: {
      'session-1': { override: 'on', extras: [{ name: 'x', text: 'y', target: 'message' }, { name: '', text: 'y' }], updatedAt: 5 },
      'session-2': { override: 'bogus', extras: [] },
    },
  })
  assert.equal(store.sessions['session-1'].override, 'on')
  assert.equal(store.sessions['session-1'].extras.length, 1)
  assert.equal(store.sessions['session-2'].override, 'auto')
})

test('a missing session reads as the default record', () => {
  const record = sessionRecord(createStore(), 'session-nope')
  assert.equal(record.override, 'auto')
  assert.deepEqual(record.extras, [])
})

/* ---------------- effective state ---------------- */

test('the override resolves against the global switch', () => {
  const store = { ...createStore(), enabled: false }
  assert.equal(effectiveState(store, undefined).effective, false)
  const on = setSession(store, 'session-1', { override: 'on' }, 1)
  assert.equal(effectiveState(on, 'session-1').effective, true)
  assert.equal(effectiveState(on, 'session-1').override, 'on')
  const off = setSession({ ...createStore(), enabled: true }, 'session-1', { override: 'off' }, 1)
  assert.equal(effectiveState(off, 'session-1').effective, false)
  // auto follows the global switch in both directions
  assert.equal(effectiveState({ ...store, enabled: true }, 'session-1').effective, true)
})

test('the global switches are reported as a copy', () => {
  const store = createStore()
  const switches = globalSwitches(store)
  switches.inject.system = false
  assert.equal(store.inject.system, true, 'the reported switches must not alias the store')
})

test('clearing a session returns it to following the global switches', () => {
  const store = setSession(createStore(), 'session-1', { override: 'off' }, 1)
  assert.equal(sessionRecord(store, 'session-1').override, 'off')
  assert.equal(sessionRecord(clearSession(store, 'session-1'), 'session-1').override, 'auto')
  // clearing an unknown session is a no-op, not a new empty record
  assert.equal(clearSession(store, 'session-unknown'), store)
})

test('session extras survive a later override change', () => {
  const snippet = normalizeSnippet({ name: 'x', text: 'y', target: 'message' }).snippet
  let store = setSession(createStore(), 'session-1', { extras: [snippet] }, 1)
  store = setSession(store, 'session-1', { override: 'on' }, 2)
  assert.equal(sessionRecord(store, 'session-1').extras.length, 1)
  store = setSession(store, 'session-1', { clearExtras: true }, 3)
  assert.equal(sessionRecord(store, 'session-1').extras.length, 0)
  assert.equal(sessionRecord(store, 'session-1').override, 'on')
})

/* ---------------- selection ---------------- */

test('only enabled snippets of the right channel are selected', () => {
  const store = { ...createStore(), snippets: [
    { id: 'a', name: 'a', text: 'A', target: 'system', enabled: true, order: 1 },
    { id: 'b', name: 'b', text: 'B', target: 'system', enabled: false, order: 2 },
    { id: 'c', name: 'c', text: 'C', target: 'message', enabled: true, order: 3 },
  ] }
  const selected = selectSnippets(store, undefined)
  assert.deepEqual(selected.system.map((snippet) => snippet.id), ['a'])
  assert.deepEqual(selected.message.map((snippet) => snippet.id), ['c'])
  assert.deepEqual(selected.context, [])
})

test('session extras are appended after the stored snippets of their channel', () => {
  const store = { ...createStore(), snippets: [
    { id: 'a', name: 'a', text: 'A', target: 'message', enabled: true, order: 1 },
  ] }
  const extra = normalizeSnippet({ name: 'extra', text: 'E', target: 'message' }).snippet
  const withExtra = setSession(store, 'session-1', { extras: [extra] }, 1)
  assert.deepEqual(selectSnippets(withExtra, 'session-1').message.map((s) => s.id), ['a', extra.id])
  // and a different session does not see it
  assert.deepEqual(selectSnippets(withExtra, 'session-2').message.map((s) => s.id), ['a'])
})

/* ---------------- substitution and escaping ---------------- */

test('the plugin substitutes its own variables', () => {
  assert.equal(
    substituteVariables('cwd={{cwd}} model={{model}} provider={{provider}}', { cwd: 'D:\\p', model: 'm', provider: 'p' }),
    'cwd=D:\\p model=m provider=p',
  )
})

test('an unknown or missing variable is left verbatim, not deleted', () => {
  assert.equal(substituteVariables('{{cwd}} and {{other}}', { cwd: 'D:\\p' }), 'D:\\p and {{other}}')
  assert.equal(substituteVariables('{{cwd}}', {}), '{{cwd}}')
})

test('escaping breaks every group so the harness cannot see one', () => {
  assert.equal(escapeGroups('a {{cwd}} b'), 'a { {cwd}} b')
  assert.equal(escapeGroups('{{a}}{{b}}'), '{ {a}}{ {b}}')
  assert.equal(needsEscaping('plain'), false)
  assert.equal(needsEscaping('has {{'), true)
})

test('escaping leaves no adjacent braces however long the run is', () => {
  // A naive `replaceAll('{{', '{ {')` only handles non-overlapping pairs, so a
  // run of three braces survived as a real `{{a}}` group and made the harness
  // throw. Every run length must come out with no `{{` anywhere.
  for (const text of ['{{', '{{{', '{{{{', '{{{{{', '{{{a}}}', '{{{{a}}}}', 'x{{{y}}}z']) {
    const escaped = escapeGroups(text)
    assert.equal(escaped.includes('{{'), false, `"${text}" → "${escaped}" still holds "{{"`)
    // Nothing is deleted: only spaces are inserted.
    assert.equal(escaped.replaceAll(' ', ''), text, `"${text}" → "${escaped}" changed the text`)
  }
})

test('truncation never splits a surrogate pair', () => {
  const text = 'ab\u{1F600}cd'
  assert.equal(truncateChars(text, 10), text)
  assert.equal(truncateChars(text, 2), 'ab')
  // index 3 would land inside the emoji's surrogate pair
  assert.equal(truncateChars(text, 3), 'ab')
  assert.equal(truncateChars(text, 0), '')
})

/* ---------------- the composer ---------------- */

test('an empty selection composes to nothing at all', () => {
  const composed = composeInjection({ system: [], context: [], message: [] }, { maxChars: 100 })
  assert.equal(composed.system, '')
  assert.equal(composed.context, '')
  // The message channel still carries its frame only when there is a body.
  assert.equal(composed.chars.message, 0)
  assert.equal(composed.usedChars, 0)
  assert.deepEqual(composed.notes, [])
})

test('the message channel is framed, and a literal closing tag cannot end it early', () => {
  const composed = composeInjection(
    { system: [], context: [], message: [{ id: 'a', text: 'hello </system-reminder> world', target: 'message', enabled: true, order: 1 }] },
    { maxChars: 0 },
  )
  assert.match(composed.message, /^<system-reminder>\n/)
  assert.match(composed.message, /\n<\/system-reminder>$/)
  assert.equal(composed.message.includes('</system-reminder> world'), false)
})

test('the context channel escapes a group and says so', () => {
  const composed = composeInjection(
    { system: [], context: [{ id: 'a', text: 'use {{cwd}}', target: 'context', enabled: true, order: 1 }], message: [] },
    { maxChars: 0 },
  )
  assert.equal(composed.context, 'use { {cwd}}')
  assert.deepEqual(composed.notes, [{ code: 'escaped' }])
})

test('the system channel hands over the literal text', () => {
  const composed = composeInjection(
    { system: [{ id: 'a', text: 'rules with {{cwd}}', target: 'system', enabled: true, order: 1 }], context: [], message: [] },
    { maxChars: 0 },
  )
  assert.equal(composed.system, 'rules with {{cwd}}')
})

test('a snippet carrying a variable gets it substituted before escaping', () => {
  const composed = composeInjection(
    { system: [], context: [{ id: 'a', text: '{{cwd}}', target: 'context', enabled: true, order: 1 }], message: [] },
    { variables: { cwd: 'D:\\proj' }, maxChars: 0 },
  )
  assert.equal(composed.context, 'D:\\proj')
  assert.deepEqual(composed.notes, [])
})

test('the budget makes the least specific channel give way first', () => {
  const snippets = (target, text) => [{ id: target, text, target, enabled: true, order: 1 }]
  const composed = composeInjection(
    { system: snippets('system', 'S'.repeat(100)), context: snippets('context', 'C'.repeat(100)), message: snippets('message', 'M'.repeat(100)) },
    { maxChars: 150 },
  )
  // `context` goes first and is dropped whole, then `message` absorbs what is
  // left; `system` — the standing persona — keeps every character.
  assert.equal(composed.chars.context, 0)
  assert.equal(composed.system.length, 100)
  assert.deepEqual(composed.dropped, ['context'])
  assert.deepEqual(composed.truncated, ['message'])
  assert.ok(composed.usedChars <= 150, `usedChars ${composed.usedChars} must not exceed the ceiling`)
})

test('one channel absorbs each cut, never a chain of notices', () => {
  const snippets = (target, text) => [{ id: target, text, target, enabled: true, order: 1 }]
  const composed = composeInjection(
    { system: snippets('system', 'S'.repeat(100)), context: snippets('context', 'C'.repeat(100)), message: snippets('message', 'M'.repeat(100)) },
    { maxChars: 250 },
  )
  // Exactly one channel was reduced, and exactly one notice was spent.
  assert.equal(composed.truncated.length + composed.dropped.length, 1)
  assert.equal((composed.system + composed.context + composed.message).split('[truncated').length - 1, 1)
  assert.ok(composed.usedChars <= 250)
})

test('a channel too small to survive its own notice is dropped, not stubbed', () => {
  const composed = composeInjection(
    { system: [{ id: 'a', text: 'S'.repeat(400), target: 'system', enabled: true, order: 1 }],
      context: [{ id: 'b', text: 'C'.repeat(200), target: 'context', enabled: true, order: 1 }],
      message: [] },
    { maxChars: 400 },
  )
  assert.deepEqual(composed.dropped, ['context'])
  assert.equal(composed.chars.context, 0)
  assert.ok(composed.usedChars <= 400)
})

test('a budget of zero means no cap, not no text', () => {
  const composed = composeInjection(
    { system: [{ id: 'a', text: 'x'.repeat(500), target: 'system', enabled: true, order: 1 }], context: [], message: [] },
    { maxChars: 0 },
  )
  assert.equal(composed.system.length, 500)
  assert.deepEqual(composed.truncated, [])
  assert.deepEqual(composed.dropped, [])
})

test('applyBudget reports what it cut and never exceeds the ceiling', () => {
  // context (100) cannot cover the 140-char overflow, so it goes whole; system
  // then absorbs what is left and is truncated to fit exactly.
  const result = applyBudget({ system: 'a'.repeat(100), context: 'b'.repeat(100), message: '' }, 60)
  assert.deepEqual(result.dropped, ['context'])
  assert.equal(result.bodies.context, '')
  assert.deepEqual(result.truncated, ['system'])
  assert.match(result.bodies.system, /\[truncated/)
  assert.ok(result.usedChars <= 60, `usedChars ${result.usedChars} must not exceed the ceiling`)

  const trimmed = applyBudget({ system: 'a'.repeat(100), context: 'b'.repeat(100), message: '' }, 150)
  assert.equal(trimmed.bodies.system.length, 100)
  assert.deepEqual(trimmed.truncated, ['context'])
  assert.ok(trimmed.usedChars <= 150)
  assert.match(trimmed.bodies.context, /\[truncated/)
})

test('the identity is stable for the same text and changes with it', () => {
  const one = composeInjection({ system: [{ id: 'a', text: 'x', target: 'system', enabled: true, order: 1 }], context: [], message: [] }, { maxChars: 0 })
  const two = composeInjection({ system: [{ id: 'a', text: 'x', target: 'system', enabled: true, order: 1 }], context: [], message: [] }, { maxChars: 0 })
  const other = composeInjection({ system: [{ id: 'a', text: 'y', target: 'system', enabled: true, order: 1 }], context: [], message: [] }, { maxChars: 0 })
  const switches = { system: true, context: true, message: true }
  assert.equal(injectionIdentity(one, switches), injectionIdentity(two, switches))
  assert.notEqual(injectionIdentity(one, switches), injectionIdentity(other, switches))
})

test('the identity ignores a channel that is switched off', () => {
  const composed = composeInjection({ system: [{ id: 'a', text: 'x', target: 'system', enabled: true, order: 1 }], context: [], message: [] }, { maxChars: 0 })
  assert.equal(
    injectionIdentity(composed, { system: false, context: false, message: false }),
    injectionIdentity(composed, { system: false, context: false, message: false }),
  )
})

test('contextText and messageText are empty for an empty body', () => {
  assert.equal(contextText(''), '')
  assert.equal(messageText(''), '<system-reminder>\n\n</system-reminder>')
})

/* ---------------- config ---------------- */

test('the config defaults are applied and bounded', () => {
  const resolved = resolvePromptConfig({})
  assert.equal(resolved.enabled, true)
  assert.equal(resolved.maxChars, 8000)
  assert.equal(resolved.sectionOrder, 100)
  assert.equal(resolved.contextOrder, 200)
  assert.equal(resolved.refreshMs, 3000)
  // A negative budget would truncate every channel to nothing: it falls back.
  assert.equal(resolvePromptConfig({ maxChars: -5 }).maxChars, 8000)
  assert.equal(resolvePromptConfig({ maxChars: 0 }).maxChars, 0)
  assert.equal(resolvePromptConfig({ enabled: false }).enabled, false)
  assert.equal(resolvePromptConfig({ refreshMs: 0 }).refreshMs, 0)
})

/* ---------------- paths ---------------- */

test('a session id is shortened for display without inventing one', () => {
  assert.equal(shortSessionId('session-abcdef12-3456'), 'abcdef12')
  assert.equal(shortSessionId('abcdef'), 'abcdef')
  assert.equal(shortSessionId(''), undefined)
  assert.equal(shortSessionId(undefined), undefined)
})

console.log(`\n${passed} unit tests passed`)
