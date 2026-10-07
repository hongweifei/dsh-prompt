/**
 * Find every file in the checkout carrying CP936 damage.
 *
 * The same round-trip trap (`Get-Content -Raw` -> `WriteAllText`) has damaged
 * this repository twice now, so this scans the whole tree rather than the one
 * file I happened to notice. Run before every commit.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const markers = [0x950b, 0x9225, 0x93b8, 0x93c2, 0x9286, 0x951f, 0x95ff, 0x9428].map((c) => String.fromCharCode(c))
const skip = new Set(['node_modules', '.git', 'test/shots'])
const damaged = []

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }
    if (!/\.(js|mjs|json|md|yml|svg|txt)$/.test(entry.name)) continue
    const text = readFileSync(full, 'utf8')
    const hit = markers.filter((m) => text.includes(m))
    const bom = text.charCodeAt(0) === 0xfeff
    if (hit.length > 0 || bom) damaged.push({ file: full, markers: hit.length, bom })
  }
}

walk('.')
if (damaged.length === 0) {
  console.log('clean: no CP936 damage and no BOM anywhere')
} else {
  for (const { file, markers: count, bom } of damaged) {
    console.log(`DAMAGED ${file}  markers=${count} bom=${bom}`)
  }
  process.exit(1)
}
