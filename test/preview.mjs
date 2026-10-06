/**
 * Render the Prompt settings panel to a self-contained HTML preview.
 *
 * The panel itself is real: the actual lib/client.js components are rendered
 * with React and the real theme-token styles, against a representative status
 * payload. This is a preview of the panel's content and layout, not a
 * substitute for the live page (which the harness serves inside its own
 * settings shell).
 *
 * Run: node test/preview.mjs   →  test/preview.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import React from 'react'
import TestRenderer from 'react-test-renderer'

const { act } = TestRenderer
const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

const STATUS = {
  enabled: true,
  inject: { system: true, context: true, message: false },
  snippets: [
    {
      id: 'p-1a2b3c4d',
      name: '代码风格',
      text: '回复一律用中文；提交消息也用中文。变量：工作目录 {{cwd}}，模型 {{model}}。',
      target: 'system',
      enabled: true,
      order: 100,
    },
    {
      id: 'p-5e6f7a8b',
      name: '构建与测试',
      text: '构建用 pnpm run build，测试用 node test/run.mjs；不要绕过失败。',
      target: 'context',
      enabled: true,
      order: 100,
    },
    {
      id: 'p-9c0d1e2f',
      name: '当前分支约束',
      text: '这次只改渲染层，不要动存储格式。',
      target: 'message',
      enabled: false,
      order: 100,
    },
  ],
  counts: { system: 1, context: 1, message: 1 },
  session: {
    id: 'session-7f3a91c2-4d5e-4a6b-8c9d-0e1f2a3b4c5d',
    cwd: 'D:\\Projects\\demo',
    override: 'auto',
    effective: true,
    extras: [
      { id: 'p-aa11bb22', name: 'session-1', text: '本次评审只看新增文件。', target: 'message', enabled: true, order: 100 },
    ],
  },
  budget: { maxChars: 8000, usedChars: 132 },
  storage: { path: 'C:\\home\\.dsh\\prompt\\snippets.json', exists: true, mtimeMs: 1760000000000, error: null },
}

const PREVIEW = {
  available: true,
  reason: null,
  session: { id: 'session-7f3a91c2', cwd: 'D:\\Projects\\demo', override: 'auto', effective: true },
  system: {
    text: '回复一律用中文；提交消息也用中文。变量：工作目录 D:\\Projects\\demo，模型 deepseek-v4.1-flash。',
    chars: 58,
    snippets: ['p-1a2b3c4d'],
  },
  context: {
    text: '构建用 pnpm run build，测试用 node test/run.mjs；不要绕过失败。',
    chars: 41,
    snippets: ['p-5e6f7a8b'],
  },
  message: { text: '', chars: 0, snippets: [] },
  // Notes are structured codes, not prose: the panel renders them in the user's
  // language. A fixture carrying the old English sentence would make the panel
  // look untranslated while the real host sends codes — a double that lies.
  notes: [{ code: 'escaped' }],
  budget: { maxChars: 8000, usedChars: 99 },
}

let registration
new Function('window', 'require', 'fetch', source)(
  { __ModuleLoader__: { load: (next) => (registration = next) } },
  (specifier) => {
    if (specifier === 'react') return React
    throw new Error(`unexpected external ${specifier}`)
  },
  async (url) => ({
    ok: true,
    json: async () => (String(url).includes('/preview') ? PREVIEW : STATUS),
  }),
)

const plugin = registration.factory((specifier) => React)

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

const locale = makeLocale(process.env.PREVIEW_LOCALE === 'en' ? 'en' : 'zh')
const registered = new Map()
plugin.apply({
  effect: (body) => {
    const dispose = body()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  locale,
  slots: {
    inject: (_owner, callback) => callback(),
    register: (options, component) => {
      registered.set(options.id, { options, component })
      return () => {}
    },
  },
})

const panel = registered.get('prompt')
const toggle = registered.get('prompt-toggle')
if (panel === undefined) throw new Error('the settings panel did not register under id "prompt"')

let renderer
await act(async () => {
  renderer = TestRenderer.create(React.createElement(panel.component, { t: locale.bind('prompt'), close: () => {} }))
})
await act(async () => {
  await Promise.resolve()
})

/**
 * Press the preview button so the rendered page shows the loaded state.
 *
 * A preview that silently stopped at the resting shape would look fine and
 * prove nothing — the exact "check that always passes" trap this project has
 * already paid for. Say so loudly instead.
 */
const findButtons = (node, out = []) => {
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findButtons(child, out)
    return out
  }
  if (node.type === 'button') out.push(node)
  for (const child of node.children ?? []) findButtons(child, out)
  return out
}
const previewButton = findButtons(renderer.toJSON()).find((button) => {
  const text = JSON.stringify(button.children ?? [])
  return /预览|Preview/.test(text)
})
if (previewButton !== undefined) {
  await act(async () => {
    previewButton.props.onClick()
  })
  await act(async () => {
    await Promise.resolve()
  })
}
const panelTree = renderer.toJSON()
renderer.unmount()

// The composer toggle, rendered on its own so its compact shape is visible.
let toggleTree = null
if (toggle !== undefined) {
  let toggleRenderer
  await act(async () => {
    toggleRenderer = TestRenderer.create(
      React.createElement(toggle.component, { t: locale.bind('prompt'), sessionId: STATUS.session.id }),
    )
  })
  await act(async () => {
    await Promise.resolve()
  })
  toggleTree = toggleRenderer.toJSON()
  toggleRenderer.unmount()
}

/**
 * Serialize the render tree to HTML.
 *
 * Emits `class`, `data-*` and boolean control attributes too — the panel styles
 * itself through prefixed classes, so a serializer that only carried inline
 * `style` would produce an unstyled preview that looks like a CSS bug.
 */
function toHtml(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return escapeHtml(node)
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(toHtml).join('')
  const tag = node.type
  const props = node.props ?? {}
  const attrs = []
  if (props.className) attrs.push(`class="${escapeHtml(String(props.className))}"`)
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('data-') && value !== undefined) attrs.push(`${key}="${escapeHtml(String(value))}"`)
  }
  if (props.title) attrs.push(`title="${escapeHtml(String(props.title))}"`)
  if (props.disabled === true) attrs.push('disabled')
  if (props.checked === true) attrs.push('checked')
  if (tag === 'select' && props.value !== undefined) attrs.push(`data-value="${escapeHtml(String(props.value))}"`)
  if (tag === 'textarea') attrs.push('rows="6"')
  const style = props.style
  if (style) {
    attrs.push(
      `style="${Object.entries(style)
        .map(([key, value]) => `${camelToKebab(key)}:${String(value).replace(/"/g, '&quot;')}`)
        .join(';')}"`,
    )
  }
  return `<${tag}${attrs.length > 0 ? ` ${attrs.join(' ')}` : ''}>${(node.children ?? []).map(toHtml).join('')}</${tag}>`
}

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const camelToKebab = (name) => name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)

/**
 * Standalone stand-ins for the Harness theme.
 *
 * The token NAMES are the real ones. The values approximate the host's neutral
 * palette so this preview shows the panel's own layout and the stylesheet it
 * ships. `PREVIEW_THEME=dark` pins the dark set directly, because a headless
 * screenshot cannot drive `prefers-color-scheme`.
 */
const LIGHT_TOKENS = `
    --dsw-alias-bg-base: #ffffff;
    --dsw-alias-bg-layer-2: #f7f7f8;
    --dsw-alias-bg-layer-3: #ffffff;
    --dsw-alias-border-l2: #ececec;
    --dsw-alias-border-l3: #dcdcdc;
    --dsw-alias-border-l4: #d0d0d0;
    --dsw-alias-interactive-bg-hover: #f0f0f1;
    --dsw-alias-interactive-bg-active: #e6e6e8;
    --dsw-alias-label-primary: #1a1a1a;
    --dsw-alias-label-secondary: #5c5c5c;
    --dsw-alias-label-tertiary: #8a8a8a;
    --dsw-alias-label-error: #d33;
    --dsw-alias-state-business-primary: #2f6feb;
    --dsw-alias-state-success-primary: #1a7f45;
    --dsw-alias-state-warn-primary: #a86500;`

const DARK_TOKENS = `
    --dsw-alias-bg-base: #171717;
    --dsw-alias-bg-layer-2: #1f1f1f;
    --dsw-alias-bg-layer-3: #232323;
    --dsw-alias-border-l2: #2e2e2e;
    --dsw-alias-border-l3: #3a3a3a;
    --dsw-alias-border-l4: #454545;
    --dsw-alias-interactive-bg-hover: #2a2a2a;
    --dsw-alias-interactive-bg-active: #333333;
    --dsw-alias-label-primary: #ededed;
    --dsw-alias-label-secondary: #b0b0b0;
    --dsw-alias-label-tertiary: #8a8a8a;
    --dsw-alias-label-error: #ff6b6b;
    --dsw-alias-state-business-primary: #6f9dff;
    --dsw-alias-state-success-primary: #4ec27a;
    --dsw-alias-state-warn-primary: #e0a458;`

/** Shared tokens whose values do not change between themes. */
const FIXED_TOKENS = `
    --dsw-radius-sm: 6px;
    --dsw-radius-md: 8px;
    --dsw-font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    --dsw-font-markdown-code-font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    --dsw-focus-ring-width: 2px;
    --dsw-focus-ring-color: #2f6feb;`

const pinned = process.env.PREVIEW_THEME
const themeCss =
  pinned === 'dark'
    ? `:root {${DARK_TOKENS}${FIXED_TOKENS}
  }`
    : pinned === 'light'
      ? `:root {${LIGHT_TOKENS}${FIXED_TOKENS}
  }`
      : `:root {${LIGHT_TOKENS}${FIXED_TOKENS}
  }
  @media (prefers-color-scheme: dark) {
    :root {${DARK_TOKENS}
    }
  }`

const html = `<!doctype html>
<html lang="${process.env.PREVIEW_LOCALE === 'en' ? 'en' : 'zh'}">
<head>
<meta charset="utf-8">
<title>Prompt snippets panel — preview</title>
<style>
${themeCss}
  body { margin: 0; background: var(--dsw-alias-bg-base); }
  .frame { max-width: 760px; margin: 0 auto; padding: 24px; }
  .caption {
    font: 12px/1.5 var(--dsw-font-markdown-code-font-family);
    color: var(--dsw-alias-label-secondary);
    border-bottom: 0.5px solid var(--dsw-alias-border-l2);
    padding-bottom: 12px; margin-bottom: 20px;
  }
  .composer {
    display: flex; align-items: center; gap: 8px;
    margin-top: 24px; padding: 10px 12px;
    border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
    background: var(--dsw-alias-bg-layer-2);
  }
  .composer-label { font: 12px/1.5 var(--dsw-font-family); color: var(--dsw-alias-label-tertiary); }
</style>
</head>
<body>
<div class="frame">
  <div class="caption">
    Preview of the registered <code>settings.section</code> entry “Prompt snippets” (order 70), and the
    <code>conversation.input.left</code> toggle.<br>
    Rendered from the real lib/client.js with React against a representative status payload.<br>
    The live page appears inside the harness settings shell; this shows its content and layout.
  </div>
  ${toHtml(panelTree)}
  <div class="composer">
    <span class="composer-label">composer tool row →</span>
    ${toggleTree === null ? '<em>toggle did not register</em>' : toHtml(toggleTree)}
  </div>
</div>
</body>
</html>
`

const out = process.env.PREVIEW_OUT ?? join(here, 'preview.html')
writeFileSync(out, html)
console.log(`wrote ${out} (${html.length} bytes)`)
if (previewButton === undefined) console.log('  ⚠ the Preview button was not found: the page shows the unloaded card')
if (toggleTree === null) console.log('  ⚠ the composer toggle did not register')
