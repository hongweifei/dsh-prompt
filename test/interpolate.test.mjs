/**
 * Check this plugin's escaping against the harness's REAL interpolation scan.
 *
 * The context channel cannot opt out of `{{variable}}` interpolation, so this
 * plugin rewrites `{{` before handing the text over. The only question that
 * matters is whether the *harness's own scanner* is satisfied by the result —
 * and a test that re-states the plugin's intent cannot answer it. So the oracle
 * below is `interpolate()` copied verbatim from
 * `@deepseek-ai/dsh-system-prompt/lib/index.js:152-177`, and every candidate
 * string is fed through it.
 *
 * Run: node test/interpolate.test.mjs
 */
import assert from 'node:assert/strict'
import { escapeGroups, needsEscaping } from '../lib/render.js'

let passed = 0
const test = (label, fn) => {
  fn()
  passed += 1
  console.log(`  ok  ${label}`)
}

console.log('dsh-prompt interpolation-safety tests')

/* ---- the oracle: the harness's own scanner, copied verbatim ---- */

const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/
const GROUP_AT = /^\{\{([^{}]*)\}\}/

/**
 * `interpolate` from `@deepseek-ai/dsh-system-prompt/lib/index.js`.
 *
 * Copied rather than reimplemented: the whole point is to run the user's text
 * through the code that will actually see it. `variables` holds only the three
 * names the harness itself registers (`provider`, `model`, `cwd`), which is the
 * realistic worst case — any other name is unknown and throws.
 */
function harnessInterpolate(text, variables, kind, name) {
  const input = { text, name }
  let result = ''
  let last = 0
  for (let open = text.indexOf('{{'); open >= 0; open = text.indexOf('{{', last)) {
    const group = GROUP_AT.exec(text.slice(open))
    if (group === null) {
      if (text.indexOf('}}', open + 2) >= 0) {
        throw new Error(`malformed prompt variable reference at "${text.slice(open, open + 16)}…" in ${kind} "${input.name}" (references are complete simple {{name}} groups)`)
      }
      result += text.slice(last, open + 2)
      last = open + 2
      continue
    }
    const variable = group[0].slice(2, -2)
    if (!VARIABLE_NAME.test(variable)) {
      throw new Error(`malformed prompt variable reference "{{${variable}}}" in ${kind} "${input.name}" (variable names match ${String(VARIABLE_NAME)})`)
    }
    if (!Object.hasOwn(variables, variable)) {
      const known = Object.keys(variables)
      throw new Error(`unknown prompt variable "{{${variable}}}" in ${kind} "${input.name}"; registered variables: ${known.length > 0 ? known.join(', ') : '(none)'}`)
    }
    const value = variables[variable]
    if (value === undefined) throw new Error(`prompt variable "{{${variable}}}" has no value for this assembly (${kind} "${input.name}")`)
    result += text.slice(last, open) + value
    last = open + group[0].length
  }
  return result + text.slice(last)
}

/** The three names the harness registers itself — everything else is unknown. */
const HARNESS_VARIABLES = { provider: 'p', model: 'm', cwd: 'C:\\w' }

/** The adversarial texts a user could actually type. */
const ADVERSARIAL = [
  'plain text',
  'use {{cwd}} here',
  'a single { brace',
  'a single } brace',
  '{{',
  '}}',
  '{{}}',
  '{{{',
  '}}}',
  '{{{{',
  '}}}}',
  '{{a}}',
  '{{{a}}}',
  '{{{{a}}}}',
  '{{{a}}',
  '{a}}',
  'nested {{{{cwd}}}}',
  'json { "k": "{{v}}" }',
  'code: function f() { return {{x}} }',
  '{{1bad}}',
  '{{Upper}}',
  '{{a b}}',
  'mixed {{a}} and {{cwd}} and {{',
  'trailing {{a}} then }}',
  '{{a}}{{b}}{{c}}',
  '{ { already escaped',
  'emoji 😀 {{a}} tail',
]

test('the harness oracle throws on a raw group it does not know', () => {
  // A positive control: if the oracle never throws, the tests below prove nothing.
  assert.throws(() => harnessInterpolate('use {{unknown}}', HARNESS_VARIABLES, 'context', 'x'), /unknown prompt variable/)
  assert.throws(() => harnessInterpolate('{{a b}}', HARNESS_VARIABLES, 'context', 'x'), /malformed/)
  // And a registered name is substituted, not thrown.
  assert.equal(harnessInterpolate('use {{cwd}}', HARNESS_VARIABLES, 'context', 'x'), 'use C:\\w')
})

test('every adversarial text is safe after escaping', () => {
  for (const text of ADVERSARIAL) {
    const escaped = escapeGroups(text)
    let rendered
    try {
      rendered = harnessInterpolate(escaped, HARNESS_VARIABLES, 'context', 'snippet')
    } catch (error) {
      assert.fail(`escaping left "${text}" unsafe as "${escaped}": ${error.message}`)
    }
    // Escaping must not have substituted anything: the harness sees no group.
    assert.equal(rendered, escaped, `the harness changed "${escaped}" to "${rendered}"`)
  }
})

test('escaping never leaves two adjacent braces', () => {
  for (const text of ADVERSARIAL) {
    const escaped = escapeGroups(text)
    assert.equal(escaped.includes('{{'), false, `"${text}" escaped to "${escaped}", which still holds "{{"`)
  }
})

test('escaping preserves the text, only breaking the group', () => {
  // Nothing is deleted: the braces are separated, so a reader still sees what
  // the user wrote rather than a silently mangled snippet.
  for (const text of ADVERSARIAL) {
    const escaped = escapeGroups(text)
    assert.equal(escaped.replaceAll(' ', ''), text.replaceAll(' ', ''), `"${text}" → "${escaped}" lost or gained characters`)
  }
})

test('needsEscaping agrees with whether escaping does anything', () => {
  for (const text of ADVERSARIAL) {
    assert.equal(needsEscaping(text), escapeGroups(text) !== text, `needsEscaping disagreed for "${text}"`)
  }
})

test('the system channel needs no escaping because it opts out of interpolation', () => {
  // Documents the asymmetry: the same text that must be escaped for `context`
  // is handed over verbatim for `system`, where `interpolate: false` is set.
  const text = '{{{a}}} and {{cwd}}'
  assert.equal(escapeGroups(text) === text, false)
  // The harness would throw on it; that is why `interpolate: false` is load-bearing.
  assert.throws(() => harnessInterpolate(text, HARNESS_VARIABLES, 'section', 'x'))
})

console.log(`\n${passed} interpolation-safety tests passed`)
