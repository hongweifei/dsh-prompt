/**
 * Read back what the LIVE plugin would inject, using the installed code and the
 * real store — the same composition the seams run.
 *
 * This is a probe, not a test: it answers "what is in my context right now",
 * which is the only question that settles whether the three channels are live.
 * Paths come from `DSH_HOME` and the session id is passed on the command line,
 * so this file names no machine.
 *
 * Run: node test/probe-live.mjs [sessionId]
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { composeInjection } from '../lib/render.js'
import { normalizeStore, selectSnippets } from '../lib/snippets.js'

const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const storePath = join(home, 'prompt', 'snippets.json')
const sessionId = process.argv[2]

const { store, dropped } = normalizeStore(JSON.parse(readFileSync(storePath, 'utf8')))
if (dropped > 0) console.log(`(${dropped} malformed snippet(s) were dropped by the store)`)

const selected = selectSnippets(store, sessionId)
const composed = composeInjection(selected, {
  variables: { cwd: process.cwd(), model: '<model>', provider: '<provider>' },
  maxChars: 8000,
})

console.log(`store: ${storePath}`)
console.log(`session: ${sessionId ?? '(none — global snippets only)'}`)
console.log(`snippets: ${store.snippets.length}`)
console.log('\n--- system channel (interpolate: false, handed over verbatim) ---')
console.log(composed.system || '(empty)')
console.log('\n--- context channel (escaped so the harness cannot see a group) ---')
console.log(composed.context || '(empty)')
console.log('\n--- message channel (framed) ---')
console.log(composed.message || '(empty)')

console.log('\n--- safety ---')
console.log('system  contains "{{":', composed.system.includes('{{'), '(fine: interpolate:false)')
console.log('context contains "{{":', composed.context.includes('{{'), '<-- MUST be false')
console.log('notes:', JSON.stringify(composed.notes))
console.log('chars:', JSON.stringify(composed.chars), 'total', composed.usedChars)
