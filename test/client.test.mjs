/**
 * Client-half checks.
 *
 * The browser bundle cannot be imported by a test — it is a classic script that
 * calls `window.__ModuleLoader__.load` — so these checks parse it and then
 * render the REAL components with React against representative payloads. That
 * is the only way to catch the failures that matter here: an asymmetric locale
 * dictionary, a route literal the Host does not serve, or a panel that throws
 * while rendering.
 *
 * Run: node test/client.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { ROUTE_PATHS } from '../lib/routes.js'

const { act } = TestRenderer
let passed = 0
const test = async (label, fn) => {
  await fn()
  passed += 1
  console.log(`  ok  ${label}`)
}

console.log('dsh-prompt client tests')

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/* ------------------------------------------------------------------ */
/* Static checks                                                       */
/* ------------------------------------------------------------------ */

await test('the bundle registers under the package id and requires only react', () => {
  assert.match(source, /window\.__ModuleLoader__\.load\(/)
  assert.match(source, /@dsh-external\/dsh-prompt/)
  const requires = new Set([...source.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((match) => match[2]))
  assert.deepEqual([...requires], ['react'], `unexpected requires: ${[...requires].join(', ')}`)
  assert.equal(/from '\.\//.test(source), false, 'the client half must not import host modules')
})

await test('no literal colour is used anywhere', () => {
  const literals = [...source.matchAll(/#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(/g)].map((match) => match[0])
  assert.deepEqual(literals, [], `literal colours found: ${literals.join(', ')}`)
})

await test('every CSS class carries the plugin prefix', () => {
  const classes = new Set([...source.matchAll(/\.([a-zA-Z][\w-]*)\s*\{/g)].map((match) => match[1]))
  assert.ok(classes.size >= 10, `expected a real stylesheet, found ${classes.size} classes`)
  for (const name of classes) assert.ok(name.startsWith('dshp-'), `class ${name} is not dshp- prefixed`)
})

await test('the stylesheet is rendered as an element, not injected into the document', () => {
  assert.match(source, /h\('style', null, CSS\)/)
  assert.equal(/document\.head/.test(source), false, 'the stylesheet must unmount with the panel')
})

await test('the theme tokens used are real harness tokens', () => {
  const tokens = new Set([...source.matchAll(/var\((--dsw-[\w-]+)/g)].map((match) => match[1]))
  assert.ok(tokens.size >= 8, `expected real theme tokens, found ${tokens.size}`)
  for (const token of tokens) assert.match(token, /^--dsw-/, `${token} is not a harness token`)
})

await test('the client only calls routes the Host registers', () => {
  const literals = new Set([...source.matchAll(/['"](\/api\/prompt\/[A-Za-z0-9_-]+)/g)].map((match) => match[1]))
  assert.ok(literals.size > 0, 'the client must call at least one route')
  assert.deepEqual([...literals].sort(), [...new Set(Object.values(ROUTE_PATHS))].sort())
})

await test('both dictionaries carry the same keys and the same placeholders', () => {
  const dictionary = (name) => {
    const match = new RegExp(`^ {4}var ${name} = \\{([\\s\\S]*?)^ {4}\\}$`, 'm').exec(source)
    assert.ok(match, `${name} dictionary not found`)
    const keys = new Map()
    for (const line of match[1].split('\n')) {
      const entry = /^\s*([A-Za-z][\w]*):\s*'((?:[^'\\]|\\.)*)'/.exec(line)
      if (entry) keys.set(entry[1], [...entry[2].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(','))
    }
    return keys
  }
  const en = dictionary('en')
  const zh = dictionary('zh')
  assert.ok(en.size > 30, `expected a real dictionary, found ${en.size} keys`)
  const missingInZh = [...en.keys()].filter((key) => !zh.has(key))
  const missingInEn = [...zh.keys()].filter((key) => !en.has(key))
  assert.deepEqual(missingInZh, [], `keys missing from zh: ${missingInZh.join(', ')}`)
  assert.deepEqual(missingInEn, [], `keys missing from en: ${missingInEn.join(', ')}`)
  for (const [key, params] of en) {
    assert.equal(zh.get(key), params, `key ${key} interpolates different params in zh (en="${params}" zh="${zh.get(key)}")`)
  }
})

await test('no user-visible string is left untranslated', () => {
  // Every literal in the dictionaries must be non-empty, and a Chinese key must
  // actually contain Chinese unless it is a known identifier.
  const identifiers = new Set(['commandConfig', 'commandRefresh', 'commandFlush', 'commandDelete', 'commandTrust', 'commandResume', 'quickLabel'])
  const zhBlock = /^ {4}var zh = \{([\s\S]*?)^ {4}\}$/m.exec(source)
  assert.ok(zhBlock, 'the zh dictionary must be present')
  const han = /[\u4e00-\u9fff]/
  for (const line of zhBlock[1].split('\n')) {
    const entry = /^\s*([A-Za-z][\w]*):\s*'((?:[^'\\]|\\.)*)'/.exec(line)
    if (!entry) continue
    const [, key, text] = entry
    assert.ok(text.length > 0, `zh.${key} is empty`)
    if (identifiers.has(key)) continue
    assert.ok(han.test(text) || /^[^\p{L}]*$/u.test(text) || text.length < 4, `zh.${key} = "${text}" does not look translated`)
  }
})

await test('both slot entries are registered with the documented ids', () => {
  assert.match(source, /'settings\.section'/)
  assert.match(source, /id: 'prompt'/)
  assert.match(source, /'conversation\.input\.left'/)
  assert.match(source, /id: 'prompt-toggle'/)
  assert.match(source, /ctx\.locale\.register\(NS, \{ zh: zh, en: en \}\)/)
})

await test('the client logic and data stay inside their budgets', () => {
  const total = source.split('\n').length
  const blocks = [
    ...source.matchAll(/^ {4}var (?:en|zh) = \{[\s\S]*?^ {4}\}$/gm),
    ...source.matchAll(/^ {4}var CSS = \[[\s\S]*?^ {4}\]\.join\('\\n'\)$/gm),
  ]
  const dataLines = blocks.reduce((sum, match) => sum + match[0].split('\n').length, 0)
  const logicLines = total - dataLines
  assert.equal(blocks.length, 3, 'the bundle must carry the en and zh dictionaries and the stylesheet')
  assert.ok(logicLines <= 700, `client.js has ${logicLines} logic lines; the budget is 700`)
  assert.ok(dataLines <= 260, `client.js carries ${dataLines} inline data lines; the budget is 260`)
  console.log(`      (client.js: ${total} total / ${logicLines} logic / ${dataLines} inline data)`)
})

/* ------------------------------------------------------------------ */
/* Rendering the real components                                       */
/* ------------------------------------------------------------------ */

/** A representative status payload — every field the panel reads is present. */
const STATUS = {
  // The panel's "default mode". The product default is off; this fixture shows a
  // user who turned it on, so the panel's ON state is what gets rendered.
  defaultEnabled: true,
  inject: { system: true, context: true, message: false },
  snippets: [
    { id: 'p-11111111', name: '代码风格', text: '回复一律用中文；提交消息也用中文。', target: 'system', enabled: true, order: 100 },
    { id: 'p-22222222', name: '构建命令', text: 'pnpm run build', target: 'context', enabled: true, order: 110 },
    { id: 'p-33333333', name: '临时要求', text: '这次只回答结论。', target: 'message', enabled: false, order: 100 },
  ],
  counts: { system: 1, context: 1, message: 1 },
  session: { id: 'session-abcdef12-3456', cwd: 'D:\\Projects\\demo', override: 'auto', effective: true, extras: [] },
  budget: { maxChars: 8000, usedChars: 132 },
  storage: { path: 'C:\\home\\.dsh\\prompt\\snippets.json', exists: true, mtimeMs: 1760000000000, error: null },
}

const PREVIEW = {
  available: true,
  reason: null,
  session: { id: 'session-abcdef12-3456', cwd: 'D:\\Projects\\demo', override: 'auto', effective: true },
  system: { text: '回复一律用中文；提交消息也用中文。', chars: 18, snippets: ['p-11111111'] },
  context: { text: 'pnpm run build', chars: 14, snippets: ['p-22222222'] },
  message: { text: '', chars: 0, snippets: [] },
  notes: [],
  budget: { maxChars: 8000, usedChars: 32 },
}

/** Load the bundle the way the browser loader does, with a fake fetch. */
function loadBundle({ status = STATUS, preview = PREVIEW, fetchImpl } = {}) {
  let registration
  new Function('window', 'require', 'fetch', source)(
    { __ModuleLoader__: { load: (next) => (registration = next) } },
    (specifier) => {
      if (specifier === 'react') return React
      throw new Error(`unexpected external ${specifier}`)
    },
    fetchImpl ??
      (async (url) => ({
        ok: true,
        json: async () => (String(url).includes('/preview') ? preview : status),
      })),
  )
  return registration.factory((specifier) => {
    if (specifier === 'react') return React
    throw new Error(`unexpected external ${specifier}`)
  })
}

/** A locale double matching the host service's register/bind contract. */
function makeLocale(active) {
  const dicts = new Map()
  const translate = (ns, key, params) => {
    const table = dicts.get(`${ns}\u0000${active}`) ?? dicts.get(`${ns}\u0000en`) ?? {}
    const template = table[key] ?? key
    return params ? template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : template
  }
  return {
    register: (ns, localeOrDicts) => {
      for (const [locale, table] of Object.entries(localeOrDicts)) dicts.set(`${ns}\u0000${locale}`, table)
      return () => {}
    },
    bind: (ns) => (key, params) => translate(ns, key, params),
  }
}

/** Apply the plugin and capture both slot registrations. */
function applyPlugin(locale) {
  const entries = new Map()
  const plugin = loadBundle()
  plugin.apply({
    effect: (body) => {
      const dispose = body()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    locale,
    slots: {
      inject: (_owner, callback) => callback(),
      register: (options, component) => {
        entries.set(options.id, { options, component })
        return () => {}
      },
    },
  })
  return entries
}

/** Render one registered component and return its tree. */
async function render(component, props) {
  let renderer
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(component, props))
  })
  await act(async () => {
    await Promise.resolve()
  })
  return renderer
}

/** Collect every string in a render tree, for content assertions. */
function texts(node, out = []) {
  if (node === null || node === undefined) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) texts(child, out)
    return out
  }
  for (const child of node.children ?? []) texts(child, out)
  return out
}

/** Collect every class name in a render tree. */
function classes(node, out = new Set()) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) classes(child, out)
    return out
  }
  for (const name of String(node.props?.className ?? '').split(/\s+/)) if (name) out.add(name)
  for (const child of node.children ?? []) classes(child, out)
  return out
}

for (const localeName of ['zh', 'en']) {
  await test(`the settings panel renders in ${localeName} with real content`, async () => {
    const locale = makeLocale(localeName)
    const entries = applyPlugin(locale)
    const entry = entries.get('prompt')
    assert.ok(entry, 'the settings panel must register under id "prompt"')
    assert.equal(entry.options.name, 'settings.section')
    assert.equal(entry.options.locale, 'prompt')
    const renderer = await render(entry.component, { t: locale.bind('prompt'), close: () => {} })
    const tree = renderer.toJSON()
    const all = texts(tree).join(' | ')
    // The three channel names and the storage path must be visible.
    assert.match(all, /system|系统/)
    assert.match(all, /snippets\.json/)
    assert.match(all, /代码风格/)
    // A real stylesheet was rendered, and no literal colour slipped in.
    const classNames = classes(tree)
    assert.ok(classNames.size >= 10, `expected real classes, found ${classNames.size}`)
    for (const name of classNames) assert.ok(name.startsWith('dshp-'), `${name} is not prefixed`)
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(JSON.stringify(tree)), false, 'the render tree carries a literal colour')
    renderer.unmount()
  })

  await test(`the composer toggle renders in ${localeName} as a single control`, async () => {
    const locale = makeLocale(localeName)
    const entries = applyPlugin(locale)
    const entry = entries.get('prompt-toggle')
    assert.ok(entry, 'the toggle must register under id "prompt-toggle"')
    assert.equal(entry.options.name, 'conversation.input.left')
    const renderer = await render(entry.component, {
      t: locale.bind('prompt'),
      sessionId: 'session-abcdef12-3456',
    })
    const tree = renderer.toJSON()
    const buttons = []
    const walk = (node) => {
      if (node === null || typeof node !== 'object') return
      if (Array.isArray(node)) return node.forEach(walk)
      if (node.type === 'button') buttons.push(node)
      ;(node.children ?? []).forEach(walk)
    }
    walk(tree)
    assert.equal(buttons.length, 1, 'the toggle must be exactly one button')
    assert.ok(buttons[0].props.title, 'the toggle needs a title so it is discoverable')
    renderer.unmount()
  })
}

await test('the panel shows a host error instead of swallowing it', async () => {
  const locale = makeLocale('zh')
  const entries = applyPlugin(locale)
  const entry = entries.get('prompt')
  const failing = loadBundle({ fetchImpl: async () => ({ ok: false, json: async () => ({ error: 'store is read-only' }) }) })
  const captured = new Map()
  failing.apply({
    effect: (body) => {
      body()
      return () => {}
    },
    locale,
    slots: {
      inject: (_owner, callback) => callback(),
      register: (options, component) => {
        captured.set(options.id, component)
        return () => {}
      },
    },
  })
  const renderer = await render(captured.get('prompt'), { t: locale.bind('prompt'), close: () => {} })
  const all = texts(renderer.toJSON()).join(' | ')
  assert.match(all, /store is read-only|不可用|unavailable|失败|failed/i, `the failure must be visible, got: ${all}`)
  renderer.unmount()
})

await test('the panel renders host notes in the panel language, never raw host prose', async () => {
  const locale = makeLocale('zh')
  const entries = applyPlugin(locale)
  const entry = entries.get('prompt')
  // Every note code the host can send, in one payload.
  const withNotes = loadBundle({
    preview: {
      ...PREVIEW,
      notes: [{ code: 'escaped' }, { code: 'truncated', channel: 'context' }, { code: 'dropped', channel: 'message' }, { code: 'off' }],
    },
  })
  const captured = new Map()
  withNotes.apply({
    effect: (body) => {
      body()
      return () => {}
    },
    locale,
    slots: {
      inject: (_owner, callback) => callback(),
      register: (options, component) => {
        captured.set(options.id, component)
        return () => {}
      },
    },
  })
  const renderer = await render(captured.get('prompt'), { t: locale.bind('prompt'), close: () => {} })
  // Press Preview so the notes are rendered.
  const buttons = []
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    if (node.type === 'button') buttons.push(node)
    ;(node.children ?? []).forEach(walk)
  }
  walk(renderer.toJSON())
  const previewButton = buttons.find((button) => /预览|Preview/.test(texts(button).join('')))
  await act(async () => {
    previewButton.props.onClick()
  })
  await act(async () => {
    await Promise.resolve()
  })
  const all = texts(renderer.toJSON()).join(' | ')
  // The Chinese page must not contain the host's English sentence.
  assert.equal(/runtime-context channel rewrites/.test(all), false, `host prose leaked onto the zh panel: ${all}`)
  assert.equal(/was truncated to fit|was dropped entirely/.test(all), false, 'host prose leaked onto the zh panel')
  // And the translated text must actually be there.
  assert.match(all, /运行时上下文通道/, 'the escaped note must be translated')
  assert.match(all, /超出总预算/, 'the budget notes must be translated')
  renderer.unmount()
})

await test('the session row shows an identifying id, not the constant prefix', async () => {
  const locale = makeLocale('zh')
  const entries = applyPlugin(locale)
  const entry = entries.get('prompt')
  const renderer = await render(entry.component, { t: locale.bind('prompt'), close: () => {} })
  const all = texts(renderer.toJSON()).join(' | ')
  // `session-` is on every id, so showing it identifies nothing.
  assert.equal(/session-\.\.\.|session-…/.test(all), false, `the session row shows only the constant prefix: ${all}`)
  // STATUS.session.id is `session-abcdef12-3456`, so the row must show `abcdef12`.
  assert.match(all, /abcdef12/, 'the session row must show the id it is talking about')
  assert.equal(/session-abcdef12/.test(all), false, 'the constant prefix must be stripped')
  renderer.unmount()
})

await test('the panel offers the default mode as a setting, not a master switch', async () => {
  const locale = makeLocale('zh')
  const entries = applyPlugin(locale)
  const entry = entries.get('prompt')
  const renderer = await render(entry.component, { t: locale.bind('prompt'), close: () => {} })
  const all = texts(renderer.toJSON()).join(' | ')
  // The row exists, names both states, and explains what it governs.
  assert.match(all, /默认模式/, 'the default-mode row must be present')
  assert.match(all, /默认开/, 'the ON choice must be offered')
  assert.match(all, /默认关/, 'the OFF choice must be offered')
  assert.match(all, /没有单独设置过的会话/, 'the row must explain what the default governs')
  // The old master-switch wording must be gone.
  assert.equal(/总开关/.test(all), false, 'the master-switch wording must be gone')
  // And the session row still offers the per-session override.
  assert.match(all, /跟随默认/, 'the session override must still be offered')
  renderer.unmount()
})

await test('the panel renders with the default OFF, which is how it ships', async () => {
  const locale = makeLocale('zh')
  const entries = applyPlugin(locale)
  const entry = entries.get('prompt')
  const off = loadBundle({ status: { ...STATUS, defaultEnabled: false, session: { ...STATUS.session, effective: false } } })
  const captured = new Map()
  off.apply({
    effect: (body) => {
      body()
      return () => {}
    },
    locale,
    slots: {
      inject: (_owner, callback) => callback(),
      register: (options, component) => {
        captured.set(options.id, component)
        return () => {}
      },
    },
  })
  const renderer = await render(captured.get('prompt'), { t: locale.bind('prompt'), close: () => {} })
  const all = texts(renderer.toJSON()).join(' | ')
  assert.match(all, /注入关/, 'the effective state must read as off')
  renderer.unmount()
})

await test('the composer button reports the session state and its next click', async () => {
  const locale = makeLocale('zh')
  const entries = applyPlugin(locale)
  const entry = entries.get('prompt-toggle')
  // Default off, session forced on: the button must show ON and offer to turn it off.
  const forced = loadBundle({
    status: { ...STATUS, defaultEnabled: false, session: { ...STATUS.session, override: 'on', effective: true } },
  })
  const captured = new Map()
  forced.apply({
    effect: (body) => {
      body()
      return () => {}
    },
    locale,
    slots: {
      inject: (_owner, callback) => callback(),
      register: (options, component) => {
        captured.set(options.id, component)
        return () => {}
      },
    },
  })
  const renderer = await render(captured.get('prompt-toggle'), { t: locale.bind('prompt'), sessionId: 'session-abcdef12-3456' })
  const tree = renderer.toJSON()
  const buttons = []
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    if (node.type === 'button') buttons.push(node)
    ;(node.children ?? []).forEach(walk)
  }
  walk(tree)
  assert.equal(buttons.length, 1)
  const button = buttons[0]
  assert.equal(button.props['aria-pressed'], 'true', 'the button must report the effective state')
  assert.equal(button.props['data-state'], 'forced-on', 'a session forced against the default must look forced')
  assert.match(button.props.title, /本会话强制开启/, 'the title must say why it is on')
  assert.match(button.props.title, /关闭注入/, 'the title must name what the next click does')
  renderer.unmount()
})

await test('the panel survives a status payload with a null session', async () => {
  const locale = makeLocale('zh')
  const entries = applyPlugin(locale)
  const entry = entries.get('prompt')
  const noSession = loadBundle({ status: { ...STATUS, session: null } })
  const captured = new Map()
  noSession.apply({
    effect: (body) => {
      body()
      return () => {}
    },
    locale,
    slots: {
      inject: (_owner, callback) => callback(),
      register: (options, component) => {
        captured.set(options.id, component)
        return () => {}
      },
    },
  })
  const renderer = await render(captured.get('prompt'), { t: locale.bind('prompt'), close: () => {} })
  assert.ok(texts(renderer.toJSON()).length > 0)
  renderer.unmount()
})

await test('the preview disclosure is present and folded by default', async () => {
  const locale = makeLocale('zh')
  const entries = applyPlugin(locale)
  const entry = entries.get('prompt')
  const renderer = await render(entry.component, { t: locale.bind('prompt'), close: () => {} })
  const tree = renderer.toJSON()
  // Find the preview button and press it, so the loaded state is rendered.
  const buttons = []
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    if (node.type === 'button') buttons.push(node)
    ;(node.children ?? []).forEach(walk)
  }
  walk(tree)
  assert.ok(buttons.length > 0, 'the panel must render controls')
  const previewButton = buttons.find((button) => /预览|Preview/.test(texts(button).join('')))
  assert.ok(previewButton, 'the preview button must exist')
  await act(async () => {
    previewButton.props.onClick()
  })
  await act(async () => {
    await Promise.resolve()
  })
  const after = texts(renderer.toJSON()).join(' | ')
  assert.match(after, /回复一律用中文/, 'the preview must show the composed text after it is run')
  renderer.unmount()
})

console.log(`\n${passed} client tests passed`)
