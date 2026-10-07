/**
 * Integration tests: the real plugin wired to a fake harness.
 *
 * The plugin is loaded through its actual `apply()`, against a small in-memory
 * stand-in for the harness services it uses (`fs`, `systemPrompt`, `agents`,
 * `connection`, `commands`). That is deliberate: the value of these tests is
 * that they exercise the REAL wiring — the real section callback, the real
 * `agent/pre-step` listener, the real routes — rather than a re-description of
 * it. A test that re-implements the wiring only proves the test agrees with
 * itself.
 *
 * Run: node test/integration.test.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { apply } from '../lib/index.js'
import { ROUTE_PATHS } from '../lib/routes.js'

let passed = 0
const test = async (label, fn) => {
  await fn()
  passed += 1
  console.log(`  ok  ${label}`)
}

console.log('dsh-prompt integration tests')

/* ------------------------------------------------------------------ */
/* The fake harness                                                    */
/* ------------------------------------------------------------------ */

/**
 * An in-memory filesystem with the same surface the plugin uses.
 *
 * Versions are bumped on every write, so the freshness intents the store relies
 * on are genuinely exercised rather than trivially satisfied.
 */
function createFs(initial = new Map()) {
  const files = new Map(initial)
  const versions = new Map()
  let counter = 0
  const versionOf = (path) => versions.get(path) ?? `v${counter}`
  return {
    files,
    /** Seed a file as if it already existed on disk. */
    seed(path, text) {
      files.set(path, text)
      versions.set(path, `seed-${(counter += 1)}`)
    },
    async resolve(path) {
      return { path }
    },
    async stat(target) {
      if (!files.has(target.path)) return undefined
      return { type: 'file', version: versionOf(target.path), size: files.get(target.path).length }
    },
    async readText(target) {
      if (!files.has(target.path)) throw Object.assign(new Error('FS_NOT_FOUND'), { code: 'FS_NOT_FOUND' })
      return files.get(target.path)
    },
    async writeText(target, content, intent) {
      const exists = files.has(target.path)
      if (intent?.kind === 'createIfAbsent' && exists) {
        throw Object.assign(new Error('FS_STALE_VERSION'), { code: 'FS_STALE_VERSION' })
      }
      if (intent?.kind === 'replaceIfVersion') {
        if (!exists) throw Object.assign(new Error('FS_NOT_FOUND'), { code: 'FS_NOT_FOUND' })
        if (intent.version !== undefined && versionOf(target.path) !== intent.version) {
          throw Object.assign(new Error('FS_STALE_VERSION'), { code: 'FS_STALE_VERSION' })
        }
      }
      files.set(target.path, content)
      versions.set(target.path, `v${(counter += 1)}`)
      return { version: versionOf(target.path) }
    },
    processPath: (target) => target.path,
  }
}

/**
 * A fake `ctx`.
 *
 * `inject` runs its callback immediately, which is what the real Cordis does
 * once the dependency is present — the tests want the wired result, not the
 * scheduling.
 */
function createCtx(options = {}) {
  const effects = []
  const listeners = new Map()
  const services = new Map()
  const sections = []
  const contexts = []
  const routes = new Map()
  const commands = []
  const logs = []
  const fs = options.fs ?? createFs()
  services.set('fs', fs)
  if (options.systemPrompt !== false) {
    services.set('systemPrompt', {
      section(section) {
        sections.push(section)
        return () => {
          const at = sections.indexOf(section)
          if (at >= 0) sections.splice(at, 1)
        }
      },
      context(context) {
        contexts.push(context)
        return () => {
          const at = contexts.indexOf(context)
          if (at >= 0) contexts.splice(at, 1)
        }
      },
    })
  }
  if (options.connection !== false) {
    services.set('connection', {
      fetch: {
        register(route) {
          routes.set(`${route.path}|${route.methods.join(',')}`, route)
          return () => routes.delete(`${route.path}|${route.methods.join(',')}`)
        },
      },
    })
  }
  services.set('agents', { currentInitiator: () => options.initiator })
  const ctx = {
    logger: {
      info: (...args) => logs.push(['info', args]),
      warn: (...args) => logs.push(['warn', args]),
    },
    effect(body, label) {
      const dispose = body()
      effects.push({ dispose, label })
      return typeof dispose === 'function' ? dispose : () => {}
    },
    inject(deps, callback) {
      const list = Array.isArray(deps) ? deps : [deps]
      if (!list.every((dep) => services.has(dep))) return () => {}
      callback(ctx)
      return () => {}
    },
    get(name) {
      return services.get(name)
    },
    provide(name, value) {
      services.set(name, value)
      if (!(name in ctx)) Object.defineProperty(ctx, name, { get: () => services.get(name), configurable: true })
      return value
    },
    on(event, listener, opts) {
      const list = listeners.get(event) ?? []
      if (opts?.prepend) list.unshift(listener)
      else list.push(listener)
      listeners.set(event, list)
      return () => {
        const at = list.indexOf(listener)
        if (at >= 0) list.splice(at, 1)
      }
    },
    sections,
    contexts,
    routes,
    commands,
    logs,
    services,
    /** Dispatch a waterfall event the way Cordis does. */
    async waterfall(event, payload, next) {
      const list = listeners.get(event) ?? []
      let index = -1
      const run = async (position) => {
        if (position <= index) throw new Error('next() called twice')
        index = position
        const listener = list[position]
        if (listener === undefined) return next()
        return listener(payload, () => run(position + 1))
      }
      return run(0)
    },
    agents: {
      currentInitiator: () => options.initiator,
    },
    agents: {
      currentInitiator: () => options.initiator,
    },
    dispose() {
      for (const { dispose } of effects.reverse()) {
        if (typeof dispose === 'function') dispose()
      }
    },
  }
  // The recorded list IS the service: the tests read the registrations, and the
  // plugin calls `register` on it. One object, so they cannot disagree.
  commands.register = (definition) => {
    commands.push(definition)
    return () => {}
  }
  ctx.commands = commands
  ctx.services.set('commands', commands)
  // Real Cordis exposes every service as a context property as well as through
  // `get()`, and the plugin uses both forms.
  for (const [serviceName, value] of services) {
    if (serviceName in ctx) continue
    Object.defineProperty(ctx, serviceName, { get: () => services.get(serviceName), configurable: true })
  }
  return ctx
}

/** A minimal session + agent, shaped the way the harness passes them. */
function createAgent(id, cwd = 'D:\\proj') {
  return {
    id,
    session: { id, header: { cwd } },
    options: { model: 'test-model', provider: 'test-provider' },
  }
}

/** Let the plugin's fire-and-forget startup read settle. */
const settle = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

/**
 * Turn the default mode on for a booted plugin.
 *
 * Injection is **off by default** — that is the product decision — so a test
 * that asserts something is injected has to say so explicitly. Making this an
 * obvious call rather than a hidden fixture default is the point: a test that
 * forgot it would fail loudly instead of passing for the wrong reason.
 */
async function enableInjection(ctx) {
  const response = await callRoute(ctx, ROUTE_PATHS.toggle, {
    method: 'POST',
    body: JSON.stringify({ defaultEnabled: true }),
  })
  assert.equal(response.status, 200, 'enabling the default mode must succeed')
}

/** Call one registered route with a URL and optional body. */
async function callRoute(ctx, path, init) {
  const bare = path.split('?')[0]
  const key = [...ctx.routes.keys()].find((candidate) => candidate.startsWith(`${bare}|`))
  assert.ok(key, `no route registered for ${bare}`)
  const route = ctx.routes.get(key)
  const request = new Request(`http://127.0.0.1:19387${path}`, init)
  const response = await route.fetch(request)
  const text = await response.text()
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : undefined }
}

/**
 * A real-disk filesystem provider, shaped like the harness's `ctx.fs`.
 *
 * The in-memory double above is right for behaviour, but a persistence test
 * must actually persist — asserting on a file the double never wrote would pass
 * while proving nothing.
 */
function createNodeFs() {
  const versionOf = (path) => {
    try {
      return `mtime-${statSync(path).mtimeMs}`
    } catch {
      return undefined
    }
  }
  return {
    async resolve(path) {
      return { path }
    },
    async stat(target) {
      try {
        const info = statSync(target.path)
        if (!info.isFile()) return undefined
        return { type: 'file', version: versionOf(target.path), size: info.size }
      } catch {
        return undefined
      }
    },
    async readText(target) {
      return readFileSync(target.path, 'utf8')
    },
    async writeText(target, content, intent) {
      if (intent?.kind === 'createIfAbsent' && existsSync(target.path)) {
        throw Object.assign(new Error('FS_STALE_VERSION'), { code: 'FS_STALE_VERSION' })
      }
      if (intent?.kind === 'replaceIfVersion' && intent.version !== undefined) {
        const current = versionOf(target.path)
        if (current !== undefined && current !== intent.version) {
          throw Object.assign(new Error('FS_STALE_VERSION'), { code: 'FS_STALE_VERSION' })
        }
      }
      mkdirSync(dirname(target.path), { recursive: true })
      writeFileSync(target.path, content, 'utf8')
      return { version: versionOf(target.path) }
    },
    processPath: (target) => target.path,
  }
}

/**
 * Run a test body with a temporary DSH_HOME, so the suite never touches the
 * real store.
 *
 * The restore has to wait for an async body: `finally` runs as soon as the
 * promise is returned, which would put the real home back while the body is
 * still running.
 */
async function withTempHome(body) {
  const previous = process.env.DSH_HOME
  const dir = mkdtempSync(join(tmpdir(), 'dsh-prompt-test-'))
  process.env.DSH_HOME = dir
  try {
    return await body(dir)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

await test('the plugin wires both prompt channels and the pre-step listener', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    assert.equal(ctx.sections.length, 1)
    assert.equal(ctx.contexts.length, 1)
    assert.equal(ctx.sections[0].name, 'prompt:user-snippets')
    assert.equal(ctx.sections[0].interpolate, false, 'the system section MUST opt out of interpolation')
    assert.equal(ctx.sections[0].order, 100)
    assert.equal(ctx.contexts[0].order, 200)
    assert.ok(ctx.routes.has(`${ROUTE_PATHS.status}|GET`))
    assert.equal(ctx.commands.length, 4)
    ctx.dispose()
  }))

await test('the plugin tolerates a profile with no systemPrompt, no connection and no commands', () =>
  withTempHome(async () => {
    const ctx = createCtx({ systemPrompt: false, connection: false })
    ctx.services.delete('commands')
    apply(ctx, {})
    await settle()
    assert.equal(ctx.sections.length, 0)
    assert.equal(ctx.routes.size, 0)
    ctx.dispose()
  }))

await test('a disabled plugin provides the service but registers no channel', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, { enabled: false })
    await settle()
    assert.equal(ctx.sections.length, 0)
    assert.equal(ctx.contexts.length, 0)
    assert.ok(ctx.get('prompt'), 'the service must still answer')
    ctx.dispose()
  }))

/* ------------------------------------------------------------------ */
/* The injection seams                                                 */
/* ------------------------------------------------------------------ */

await test('a run of three braces cannot reach the harness as a real group', () =>
  withTempHome(async () => {
    // This is the exact shape that made a LIVE run fail with
    //   unknown prompt variable "{{a}}" in context "prompt:user-snippets"
    // The old `replaceAll('{{', '{ {')` handled only non-overlapping pairs and
    // left `{ {{a}}}` — still a group, so the harness threw and the whole model
    // call failed. The channel must now carry no `{{` at all.
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'braces', text: 'test {{{a}}} and {{unknown}} and {{ open', target: 'context' }),
    })
    const text = ctx.contexts[0].text({ agent: createAgent('session-braces') })
    assert.equal(text.includes('{{'), false, `the context channel still carries a group: ${text}`)
    assert.match(text, /\{ \{ \{a\}\}\}/, 'the run of braces must be broken apart, not deleted')
    ctx.dispose()
  }))

await test('an empty store injects nothing at all on every channel', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    const agent = createAgent('session-empty')
    assert.equal(ctx.sections[0].text({ agent }), '')
    assert.equal(ctx.contexts[0].text({ agent }), '')
    const decision = await ctx.waterfall(
      'agent/pre-step',
      { agent, messages: [{ id: 'm1' }], turn: 1, step: 1, signal: undefined },
      async () => ({ kind: 'enter', messages: [{ id: 'm1' }] }),
    )
    assert.deepEqual(decision.messages.map((message) => message.id), ['m1'])
    ctx.dispose()
  }))

await test('a system snippet reaches the system section, verbatim', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'style', text: 'Reply in Chinese.', target: 'system' }),
    })
    const agent = createAgent('session-a')
    assert.equal(ctx.sections[0].text({ agent }), 'Reply in Chinese.')
    // The other channels stay silent, which is the point of per-channel targets.
    assert.equal(ctx.contexts[0].text({ agent }), '')
    ctx.dispose()
  }))

await test('a user literal {{ never reaches the harness uninterpolated on the system channel', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'braces', text: 'Write {{curly}} literally.', target: 'system' }),
    })
    const text = ctx.sections[0].text({ agent: createAgent('session-b') })
    // `interpolate: false` is what makes this safe; the literal survives.
    assert.equal(text, 'Write {{curly}} literally.')
    ctx.dispose()
  }))

await test('a context snippet is escaped so the harness cannot throw on it', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'braces', text: 'Write {{curly}} literally.', target: 'context' }),
    })
    const text = ctx.contexts[0].text({ agent: createAgent('session-c') })
    assert.equal(text, 'Write { {curly}} literally.')
    ctx.dispose()
  }))

await test('{{cwd}} is substituted from the assembly agent, not the host process', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'cwd', text: 'Working in {{cwd}} as {{model}}.', target: 'system' }),
    })
    const text = ctx.sections[0].text({ agent: createAgent('session-d', 'D:\\elsewhere') })
    assert.equal(text, 'Working in D:\\elsewhere as test-model.')
    ctx.dispose()
  }))

await test('the message channel adds a framed message after the claimed batch', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'temp', text: 'Answer briefly.', target: 'message' }),
    })
    const agent = createAgent('session-e')
    const claimed = [{ id: 'm1' }]
    const decision = await ctx.waterfall(
      'agent/pre-step',
      { agent, messages: claimed, turn: 1, step: 1, signal: undefined },
      async () => ({ kind: 'enter', messages: [...claimed] }),
    )
    assert.equal(decision.messages.length, 2)
    assert.equal(decision.messages[0].id, 'm1', 'the live user message must stay first')
    const injected = decision.messages[1]
    assert.equal(injected.role, 'user')
    assert.equal(injected.source.kind, 'prompt')
    assert.match(injected.content[0].text, /^<system-reminder>\n/)
    assert.match(injected.content[0].text, /Answer briefly\./)
    ctx.dispose()
  }))

await test('the message channel does not inject the same text twice in a row', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'temp', text: 'Answer briefly.', target: 'message' }),
    })
    const agent = createAgent('session-f')
    const dispatch = () =>
      ctx.waterfall(
        'agent/pre-step',
        { agent, messages: [{ id: 'm1' }], turn: 1, step: 1, signal: undefined },
        async () => ({ kind: 'enter', messages: [{ id: 'm1' }] }),
      )
    const first = await dispatch()
    const second = await dispatch()
    assert.equal(first.messages.length, 2)
    assert.equal(second.messages.length, 1, 'an unchanged injection must not repeat on every step')
    ctx.dispose()
  }))

await test('a rejected step is passed through untouched', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'temp', text: 'Answer briefly.', target: 'message' }),
    })
    const decision = await ctx.waterfall(
      'agent/pre-step',
      { agent: createAgent('session-g'), messages: [], turn: 1, step: 1, signal: undefined },
      async () => ({ kind: 'reject' }),
    )
    assert.equal(decision.kind, 'reject')
    ctx.dispose()
  }))

await test('switching a channel off silences only that channel', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 's', text: 'SYSTEM TEXT', target: 'system' }),
    })
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'c', text: 'CONTEXT TEXT', target: 'context' }),
    })
    const agent = createAgent('session-h')
    assert.equal(ctx.sections[0].text({ agent }), 'SYSTEM TEXT')
    await callRoute(ctx, ROUTE_PATHS.toggle, { method: 'POST', body: JSON.stringify({ inject: { system: false } }) })
    assert.equal(ctx.sections[0].text({ agent }), '')
    assert.equal(ctx.contexts[0].text({ agent }), 'CONTEXT TEXT')
    ctx.dispose()
  }))

await test('a per-session override beats the default mode, in both directions', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 's', text: 'SYSTEM TEXT', target: 'system' }),
    })
    const agent = createAgent('session-i')
    // Default off: a session that has not chosen gets nothing.
    await callRoute(ctx, ROUTE_PATHS.toggle, { method: 'POST', body: JSON.stringify({ defaultEnabled: false }) })
    assert.equal(ctx.sections[0].text({ agent }), '')
    // Session forced on: it injects even though the default is off.
    await callRoute(ctx, ROUTE_PATHS.session, {
      method: 'POST',
      body: JSON.stringify({ action: 'on', sessionId: 'session-i' }),
    })
    assert.equal(ctx.sections[0].text({ agent }), 'SYSTEM TEXT')
    // Another session is unaffected by that override.
    assert.equal(ctx.sections[0].text({ agent: createAgent('session-other') }), '')
    // With the default on, a session forced OFF stays silent while others inject.
    await callRoute(ctx, ROUTE_PATHS.toggle, { method: 'POST', body: JSON.stringify({ defaultEnabled: true }) })
    await callRoute(ctx, ROUTE_PATHS.session, {
      method: 'POST',
      body: JSON.stringify({ action: 'off', sessionId: 'session-i' }),
    })
    assert.equal(ctx.sections[0].text({ agent }), '')
    assert.equal(ctx.sections[0].text({ agent: createAgent('session-other') }), 'SYSTEM TEXT')
    ctx.dispose()
  }))

await test('injection is off until it is turned on', () =>
  withTempHome(async () => {
    // The product decision: installing the plugin must not change any request.
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 's', text: 'SYSTEM TEXT', target: 'system' }),
    })
    const agent = createAgent('session-default-off')
    assert.equal(ctx.sections[0].text({ agent }), '', 'a fresh install must inject nothing')
    assert.equal(ctx.contexts[0].text({ agent }), '')
    const status = await ctx.get('prompt').status({ session: agent.session })
    assert.equal(status.defaultEnabled, false, 'the default mode must ship off')
    assert.equal(status.session.effective, false)
    // And the message channel stays silent too.
    const decision = await ctx.waterfall(
      'agent/pre-step',
      { agent, messages: [{ id: 'm1' }], turn: 1, step: 1, signal: undefined },
      async () => ({ kind: 'enter', messages: [{ id: 'm1' }] }),
    )
    assert.equal(decision.messages.length, 1)
    ctx.dispose()
  }))

await test('the composer switch turns one session on without changing the default', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 's', text: 'SYSTEM TEXT', target: 'system' }),
    })
    // What the composer button does: force THIS session on.
    await callRoute(ctx, ROUTE_PATHS.session, {
      method: 'POST',
      body: JSON.stringify({ action: 'on', sessionId: 'session-quick' }),
    })
    const agent = createAgent('session-quick')
    assert.equal(ctx.sections[0].text({ agent }), 'SYSTEM TEXT')
    const status = await ctx.get('prompt').status({ session: agent.session })
    assert.equal(status.defaultEnabled, false, 'the default must be untouched by a session switch')
    assert.equal(status.session.override, 'on')
    assert.equal(status.session.effective, true)
    // A brand-new session still follows the default, which is still off.
    assert.equal(ctx.sections[0].text({ agent: createAgent('session-fresh') }), '')
    ctx.dispose()
  }))

await test('a session-only extra applies to that session and no other', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    await callRoute(ctx, ROUTE_PATHS.session, {
      method: 'POST',
      body: JSON.stringify({ action: 'add-extra', sessionId: 'session-j', text: 'ONLY HERE', target: 'message' }),
    })
    const withExtra = await ctx.waterfall(
      'agent/pre-step',
      { agent: createAgent('session-j'), messages: [{ id: 'm1' }], turn: 1, step: 1, signal: undefined },
      async () => ({ kind: 'enter', messages: [{ id: 'm1' }] }),
    )
    assert.equal(withExtra.messages.length, 2)
    // The injected message goes after the claimed one, whichever array instance
    // an earlier listener left behind.
    assert.equal(withExtra.messages[1].source.kind, 'prompt')
    assert.match(withExtra.messages[1].content[0].text, /ONLY HERE/)
    const without = await ctx.waterfall(
      'agent/pre-step',
      { agent: createAgent('session-k'), messages: [{ id: 'm1' }], turn: 1, step: 1, signal: undefined },
      async () => ({ kind: 'enter', messages: [{ id: 'm1' }] }),
    )
    assert.equal(without.messages.length, 1)
    ctx.dispose()
  }))

/* ------------------------------------------------------------------ */
/* The store                                                           */
/* ------------------------------------------------------------------ */

await test('a snippet written through the route is persisted to disk', () =>
  withTempHome(async () => {
    const ctx = createCtx({ fs: createNodeFs() })
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    const created = await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'persisted', text: 'Hello.', target: 'system' }),
    })
    assert.equal(created.status, 200)
    const file = join(process.env.DSH_HOME, 'prompt', 'snippets.json')
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(parsed.version, 2)
    assert.equal(parsed.snippets.length, 1)
    assert.equal(parsed.snippets[0].name, 'persisted')
    const status = await ctx.get('prompt').status({})
    assert.equal(status.storage.path, file)
    ctx.dispose()
  }))

await test('a store written by one process is read back by the next', () =>
  withTempHome(async () => {
    const first = createCtx({ fs: createNodeFs() })
    apply(first, {})
    await settle()
    await enableInjection(first)
    await callRoute(first, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'durable', text: 'SURVIVES', target: 'system' }),
    })
    first.dispose()
    // A brand-new plugin instance, as a restarted host would build.
    const second = createCtx({ fs: createNodeFs() })
    apply(second, {})
    await settle()
    await enableInjection(second)
    assert.equal(second.sections[0].text({ agent: createAgent('session-restart') }), 'SURVIVES')
    second.dispose()
  }))

await test('a snippet edited in the file is picked up by a refresh', () =>
  withTempHome(async (dir) => {
    const file = join(dir, 'prompt', 'snippets.json')
    const fs = createFs()
    fs.seed(file, JSON.stringify({ version: 2, defaultEnabled: true, inject: { system: true, context: true, message: true }, snippets: [{ id: 'p-1', name: 'external', text: 'FROM FILE', target: 'system', enabled: true, order: 1 }], sessions: {} }))
    const ctx = createCtx({ fs })
    apply(ctx, {})
    await settle()
    assert.equal(ctx.sections[0].text({ agent: createAgent('session-l') }), 'FROM FILE')
    // Rewrite the file behind the plugin's back and refresh.
    fs.seed(file, JSON.stringify({ version: 2, defaultEnabled: true, inject: { system: true, context: true, message: true }, snippets: [{ id: 'p-2', name: 'external2', text: 'CHANGED', target: 'system', enabled: true, order: 1 }], sessions: {} }))
    await ctx.get('prompt').refresh()
    assert.equal(ctx.sections[0].text({ agent: createAgent('session-l') }), 'CHANGED')
    ctx.dispose()
  }))

await test('a corrupt store is reported and falls back to empty, never throwing', () =>
  withTempHome(async (dir) => {
    const file = join(dir, 'prompt', 'snippets.json')
    const fs = createFs()
    fs.seed(file, '{ this is not json')
    const ctx = createCtx({ fs })
    apply(ctx, {})
    await settle()
    // Deliberately NO `enableInjection` here: it writes the store, which would
    // replace the corrupt fixture this test exists to read.
    const status = await ctx.get('prompt').status({})
    assert.match(status.storage.error, /not valid JSON/)
    assert.deepEqual(status.snippets, [])
    assert.equal(ctx.sections[0].text({ agent: createAgent('session-m') }), '')
    ctx.dispose()
  }))

await test('deleting a snippet removes it from disk and from injection', () =>
  withTempHome(async () => {
    const ctx = createCtx({ fs: createNodeFs() })
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    const created = await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'gone', text: 'REMOVE ME', target: 'system' }),
    })
    const id = created.body.snippet.id
    assert.equal(ctx.sections[0].text({ agent: createAgent('session-n') }), 'REMOVE ME')
    const removed = await callRoute(ctx, `${ROUTE_PATHS.snippet}?id=${id}`, { method: 'DELETE' })
    assert.equal(removed.status, 200)
    assert.equal(ctx.sections[0].text({ agent: createAgent('session-n') }), '')
    const file = JSON.parse(readFileSync(join(process.env.DSH_HOME, 'prompt', 'snippets.json'), 'utf8'))
    assert.equal(file.snippets.length, 0)
    ctx.dispose()
  }))

await test('deleting an unknown id is a 404, not a silent success', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    const response = await callRoute(ctx, `${ROUTE_PATHS.snippet}?id=p-nope`, { method: 'DELETE' })
    assert.equal(response.status, 404)
    ctx.dispose()
  }))

await test('an invalid snippet is refused with a reason and nothing is written', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    const empty = await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'x', text: '   ', target: 'system' }),
    })
    assert.equal(empty.status, 400)
    assert.match(empty.body.error, /empty/)
    const badTarget = await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'x', text: 'y', target: 'nowhere' }),
    })
    assert.equal(badTarget.status, 400)
    const status = await ctx.get('prompt').status({})
    assert.deepEqual(status.snippets, [])
    ctx.dispose()
  }))

await test('a malformed request body is refused, not crashed on', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    const response = await callRoute(ctx, ROUTE_PATHS.snippet, { method: 'POST', body: 'not json' })
    assert.equal(response.status, 400)
    assert.match(response.body.error, /valid JSON/)
    ctx.dispose()
  }))

await test('editing an existing snippet keeps its id and order', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    const created = await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'first', text: 'one', target: 'system', order: 7 }),
    })
    const id = created.body.snippet.id
    const updated = await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ id, name: 'second', text: 'two', target: 'system' }),
    })
    assert.equal(updated.body.snippet.id, id)
    assert.equal(updated.body.snippet.order, 7)
    assert.equal(updated.body.snippet.name, 'second')
    assert.equal(ctx.sections[0].text({ agent: createAgent('session-o') }), 'two')
    ctx.dispose()
  }))

/* ------------------------------------------------------------------ */
/* Status and preview                                                  */
/* ------------------------------------------------------------------ */

await test('status reports the channels, counts, session and budget', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 's', text: 'system text', target: 'system' }),
    })
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'm', text: 'message text', target: 'message' }),
    })
    const agent = createAgent('session-p')
    const status = await ctx.get('prompt').status({ session: agent.session })
    assert.equal(status.defaultEnabled, true)
    assert.deepEqual(status.inject, { system: true, context: true, message: true })
    assert.equal(status.snippets.length, 2)
    assert.deepEqual(status.counts, { system: 1, context: 0, message: 1 })
    assert.equal(status.session.id, 'session-p')
    assert.equal(status.session.override, 'auto')
    assert.equal(status.session.effective, true)
    assert.equal(status.session.cwd, 'D:\\proj')
    assert.equal(status.budget.maxChars, 8000)
    assert.ok(status.budget.usedChars > 0)
    assert.equal(status.storage.error, null)
    ctx.dispose()
  }))

await test('status with no session in scope reports null rather than inventing one', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    const status = await ctx.get('prompt').status({})
    assert.equal(status.session, null)
    ctx.dispose()
  }))

await test('preview shows each channel and says which snippets fed it', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    const created = await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 's', text: 'SYSTEM', target: 'system' }),
    })
    const agent = createAgent('session-q')
    const preview = await ctx.get('prompt').preview(agent.session)
    assert.equal(preview.available, true)
    assert.equal(preview.system.text, 'SYSTEM')
    assert.deepEqual(preview.system.snippets, [created.body.snippet.id])
    assert.equal(preview.context.text, '')
    assert.equal(preview.session.id, 'session-q')
    ctx.dispose()
  }))

await test('preview of a session with injection off says so instead of showing text', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 's', text: 'SYSTEM', target: 'system' }),
    })
    await callRoute(ctx, ROUTE_PATHS.session, {
      method: 'POST',
      body: JSON.stringify({ action: 'off', sessionId: 'session-r' }),
    })
    const preview = await ctx.get('prompt').preview({ id: 'session-r', header: { cwd: 'D:\\proj' } })
    assert.equal(preview.session.effective, false)
    assert.equal(preview.system.text, '')
    assert.ok(preview.notes.length > 0)
    ctx.dispose()
  }))

await test('preview with no session is unavailable, not wrong', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    const preview = await ctx.get('prompt').preview(undefined)
    assert.equal(preview.available, false)
    assert.match(preview.reason, /no session/)
    ctx.dispose()
  }))

await test('the preview route answers over the real HTTP handler', () =>
  withTempHome(async () => {
    const agent = createAgent('session-s')
    const ctx = createCtx({ initiator: agent })
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 's', text: 'OVER HTTP', target: 'system' }),
    })
    const response = await callRoute(ctx, ROUTE_PATHS.preview)
    assert.equal(response.status, 200)
    assert.equal(response.body.available, true)
    assert.equal(response.body.system.text, 'OVER HTTP')
    ctx.dispose()
  }))

await test('the status route names the session it was asked about', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    const response = await callRoute(ctx, `${ROUTE_PATHS.status}?session=session-named`)
    assert.equal(response.status, 200)
    assert.equal(response.body.session.id, 'session-named')
    ctx.dispose()
  }))

await test('every route the client half calls is registered', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    const literals = new Set([...client.matchAll(/['"](\/api\/prompt\/[A-Za-z0-9_-]+)/g)].map((match) => match[1]))
    assert.ok(literals.size > 0, 'the client half must call at least one /api/prompt route')
    const server = new Set(Object.values(ROUTE_PATHS))
    assert.deepEqual([...literals].sort(), [...server].sort(), 'client and Host must agree on the route set')
    for (const path of literals) {
      assert.ok([...ctx.routes.keys()].some((key) => key.startsWith(`${path}|`)), `${path} has no registered route`)
    }
    ctx.dispose()
  }))

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

await test('/prompt lists the snippets and the channel state', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'listed', text: 'TEXT', target: 'system' }),
    })
    const command = ctx.commands.find((candidate) => candidate.name === 'prompt')
    const result = await command.handler({ agent: createAgent('session-t'), rawInput: '' })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /default mode on/)
    assert.match(result.text, /system=1/)
    assert.match(result.text, /listed/)
    ctx.dispose()
  }))

await test('/prompt-add validates its target and refuses a bad one', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    const command = ctx.commands.find((candidate) => candidate.name === 'prompt-add')
    const bad = await command.handler({ rawInput: 'name | nowhere | text' })
    assert.equal(bad.kind, 'error')
    const missing = await command.handler({ rawInput: 'name | system' })
    assert.equal(missing.kind, 'error')
    const good = await command.handler({ rawInput: 'name | message | the text' })
    assert.equal(good.kind, 'success')
    const listed = await ctx.get('prompt').status({})
    assert.equal(listed.counts.message, 1)
    ctx.dispose()
  }))

await test('/prompt-remove refuses an unknown id and deletes a known one', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    const add = ctx.commands.find((candidate) => candidate.name === 'prompt-add')
    await add.handler({ rawInput: 'gone | system | text' })
    const status = await ctx.get('prompt').status({})
    const id = status.snippets[0].id
    const remove = ctx.commands.find((candidate) => candidate.name === 'prompt-remove')
    assert.equal((await remove.handler({ rawInput: 'p-nope' })).kind, 'error')
    assert.equal((await remove.handler({ rawInput: id })).kind, 'success')
    assert.equal((await ctx.get('prompt').status({})).snippets.length, 0)
    ctx.dispose()
  }))

await test('/prompt-session sets an override and reports the resolved state', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    const command = ctx.commands.find((candidate) => candidate.name === 'prompt-session')
    const agent = createAgent('session-u')
    const off = await command.handler({ agent, rawInput: 'off' })
    assert.equal(off.kind, 'success')
    assert.match(off.text, /effective=off/)
    const status = await ctx.get('prompt').status({ session: agent.session })
    assert.equal(status.session.override, 'off')
    const cleared = await command.handler({ agent, rawInput: 'clear' })
    assert.equal(cleared.kind, 'success')
    assert.equal((await ctx.get('prompt').status({ session: agent.session })).session.override, 'auto')
    ctx.dispose()
  }))

await test('/prompt-session refuses an unknown action rather than doing nothing quietly', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    const command = ctx.commands.find((candidate) => candidate.name === 'prompt-session')
    const result = await command.handler({ agent: createAgent('session-v'), rawInput: 'nonsense' })
    assert.equal(result.kind, 'error')
    assert.match(result.text, /unknown action/)
    ctx.dispose()
  }))

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

await test('disposal unregisters the channels and stops the timer', () =>
  withTempHome(async () => {
    const ctx = createCtx()
    apply(ctx, {})
    await settle()
    assert.equal(ctx.sections.length, 1)
    ctx.dispose()
    assert.equal(ctx.sections.length, 0)
    assert.equal(ctx.contexts.length, 0)
  }))

await test('a store write made by one process is not clobbered by another writer', () =>
  withTempHome(async (dir) => {
    const file = join(dir, 'prompt', 'snippets.json')
    const fs = createFs()
    const ctx = createCtx({ fs })
    apply(ctx, {})
    await settle()
    await enableInjection(ctx)
    // A first writer creates the file through the route.
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'one', text: 'ONE', target: 'system' }),
    })
    // A second writer, outside the plugin, adds a snippet to the same file.
    const onDisk = JSON.parse(fs.files.get(file))
    onDisk.snippets.push({ id: 'p-outside', name: 'outside', text: 'OUTSIDE', target: 'system', enabled: true, order: 99 })
    fs.seed(file, JSON.stringify(onDisk))
    // The plugin's next write must rebase onto that, not discard it.
    await callRoute(ctx, ROUTE_PATHS.snippet, {
      method: 'POST',
      body: JSON.stringify({ name: 'two', text: 'TWO', target: 'system' }),
    })
    const final = JSON.parse(fs.files.get(file))
    const names = final.snippets.map((snippet) => snippet.name).sort()
    assert.deepEqual(names, ['one', 'outside', 'two'])
    ctx.dispose()
  }))

console.log(`\n${passed} integration tests passed`)
