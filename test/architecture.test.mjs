/**
 * Module-boundary tests.
 *
 * The plugin is one bundle with a Host half split into focused modules. These
 * tests enforce the shape so it cannot silently decay back into one large file:
 * a layered import graph with no cycles, `index.js` as the only aggregator, and
 * no module reaching outside its layer.
 *
 * Run: node test/architecture.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const libDir = join(here, '..', 'lib')

let passed = 0
const test = (label, fn) => {
  fn()
  passed += 1
  console.log(`  ok  ${label}`)
}

console.log('dsh-prompt architecture tests')

/** Every module's source, keyed by file name. */
const sources = new Map()
for (const name of readdirSync(libDir).filter((name) => name.endsWith('.js'))) {
  sources.set(name, readFileSync(join(libDir, name), 'utf8'))
}

/** Local import edges: `{ from: Set<to> }`. */
const graph = new Map()
for (const [name, source] of sources) {
  const targets = new Set()
  for (const match of source.matchAll(/from '\.\/([a-z-]+)\.js'/g)) targets.add(`${match[1]}.js`)
  graph.set(name, targets)
}

/** The layering this plugin intends, lowest first. */
const LAYERS = [
  ['constants.js'],
  ['paths.js', 'snippets.js'],
  ['render.js', 'config.js'],
  ['store.js', 'inject.js'],
  ['service.js', 'routes.js', 'commands.js'],
  ['index.js'],
]
const layerOf = new Map()
LAYERS.forEach((layer, index) => layer.forEach((name) => layerOf.set(name, index)))

const MAX_HOST_LOGIC_LINES = 500
const MAX_CLIENT_LOGIC_LINES = 700
const MAX_INLINE_DATA_LINES = 260

test('the Host half is split into focused modules', () => {
  const hostModules = [...sources.keys()].filter((name) => name !== 'client.js')
  assert.ok(hostModules.length >= 8, `expected a split Host half, found ${hostModules.length} modules`)
  assert.ok(sources.has('index.js'))
})

test('no module is a god file', () => {
  for (const [name, source] of sources) {
    if (name === 'client.js') continue
    const lines = source.split('\n').length
    assert.ok(
      lines <= MAX_HOST_LOGIC_LINES,
      `${name} is ${lines} lines; split it rather than growing past ${MAX_HOST_LOGIC_LINES}`,
    )
  }
})

test('the client bundle holds its logic to its own budget', () => {
  const source = sources.get('client.js')
  const total = source.split('\n').length
  const blocks = [
    ...source.matchAll(/^ {4}var (?:en|zh) = \{[\s\S]*?^ {4}\}$/gm),
    ...source.matchAll(/^ {4}var CSS = \[[\s\S]*?^ {4}\]\.join\('\\n'\)$/gm),
  ]
  const dataLines = blocks.reduce((sum, match) => sum + match[0].split('\n').length, 0)
  const logicLines = total - dataLines
  assert.equal(blocks.length, 3, 'the client bundle must carry the en and zh dictionaries and the stylesheet')
  assert.ok(
    logicLines <= MAX_CLIENT_LOGIC_LINES,
    `client.js has ${logicLines} lines of logic; show less rather than growing past ${MAX_CLIENT_LOGIC_LINES}`,
  )
  assert.ok(
    dataLines <= MAX_INLINE_DATA_LINES,
    `client.js carries ${dataLines} lines of inline locale data; the budget is ${MAX_INLINE_DATA_LINES}`,
  )
})

test('index.js is wiring only', () => {
  const lines = sources.get('index.js').split('\n').length
  assert.ok(lines <= 300, `index.js is ${lines} lines; keep it as wiring (<=300)`)
})

test('the local import graph is acyclic', () => {
  const visiting = new Set()
  const done = new Set()
  const visit = (name, trail) => {
    if (done.has(name)) return
    assert.ok(!visiting.has(name), `import cycle: ${[...trail, name].join(' -> ')}`)
    visiting.add(name)
    for (const target of graph.get(name) ?? []) visit(target, [...trail, name])
    visiting.delete(name)
    done.add(name)
  }
  for (const name of graph.keys()) visit(name, [])
})

test('imports only point downward through the layers', () => {
  for (const [name, targets] of graph) {
    for (const target of targets) {
      assert.ok(
        layerOf.get(target) < layerOf.get(name),
        `${name} (layer ${layerOf.get(name)}) must not import ${target} (layer ${layerOf.get(target)})`,
      )
    }
  }
})

test('index.js is the only module that imports the presentation layers', () => {
  const presentation = ['service.js', 'routes.js', 'commands.js']
  for (const [name, targets] of graph) {
    if (name === 'index.js') continue
    for (const target of targets) {
      assert.ok(!presentation.includes(target), `${name} must not import ${target}; only index.js wires those`)
    }
  }
})

test('the client half is self-contained', () => {
  const client = sources.get('client.js')
  assert.ok(!/from '\.\//.test(client), 'client.js must not import Host modules')
  assert.ok(!/require\(['"]\.\//.test(client), 'client.js must not require Host modules')
  assert.ok(client.includes('@dsh-external/dsh-prompt'), 'the client half registers under the package id')
})

test('no Host module imports a harness package it does not need', () => {
  // A plugin bundle that imports a harness package ties itself to one
  // installation's module graph; `schemastery` is the one exception, because
  // the Loader requires the schema to be built from it.
  const allowed = new Set(['@deepseek-ai/schemastery'])
  for (const [name, source] of sources) {
    if (name === 'client.js') continue
    for (const match of source.matchAll(/from '(@[^']+)'/g)) {
      assert.ok(allowed.has(match[1]), `${name} imports ${match[1]}, which the bundle cannot depend on`)
    }
  }
})

test('each module documents its purpose', () => {
  for (const [name, source] of sources) {
    assert.match(source, /\/\*\*[\s\S]*?@module /, `${name} needs a module doc comment with @module`)
  }
})

test('no shipped file carries CP936 damage or a BOM', () => {
  // Editing a text file with `Get-Content`/`Set-Content` on this machine
  // re-encodes it through CP936, and CJK comes back as garbage. The markers are
  // built from code points so this file does not contain what it looks for.
  const root = join(here, '..')
  const markers = [0x950b, 0x9225, 0x93b8, 0x93c2, 0x9286, 0x951f, 0x95ff, 0x9428].map((code) => String.fromCharCode(code))
  const skip = new Set(['node_modules', '.git'])
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(js|mjs|json|md|yml|svg)$/.test(entry.name)) continue
      const text = readFileSync(full, 'utf8')
      const where = full.slice(root.length + 1)
      const hit = markers.find((marker) => text.includes(marker))
      assert.equal(hit, undefined, `${where} carries CP936 damage`)
      assert.notEqual(text.charCodeAt(0), 0xfeff, `${where} starts with a BOM`)
    }
  }
  walk(root)
})

test('nothing shipped names an absolute path from one machine', () => {
  const root = join(here, '..')
  const skip = new Set(['node_modules', '.git'])
  const homePath = /(?:[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}|\/home\/)([A-Za-z0-9._-]+)/g
  const placeholder = /(?:[\\/])(?:[A-Za-z]|\.[A-Za-z0-9._-]+)$/
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(js|mjs|json|md|yml|svg|txt)$/.test(entry.name)) continue
      const offending = [...readFileSync(full, 'utf8').matchAll(homePath)]
        .map((match) => match[0])
        .filter((hit) => !placeholder.test(hit))
      assert.deepEqual(offending, [], `${full.slice(root.length + 1)} names a machine-specific home directory`)
    }
  }
  walk(root)
})

console.log(`\n${passed} architecture tests passed`)
