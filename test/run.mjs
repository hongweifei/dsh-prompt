/**
 * Run every suite in one process and report a single total.
 *
 * Each suite is a separate file because they need different environments (the
 * client suite needs React; the integration suite needs a temporary
 * `DSH_HOME`), so this only sequences them and sums the counts.
 *
 * Run: node test/run.mjs
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const suites = ['unit', 'interpolate', 'integration', 'client', 'architecture']

let total = 0
let failed = false
for (const suite of suites) {
  const file = join(here, `${suite}.test.mjs`)
  process.stdout.write(`\n── ${suite} ─────────────────────────────────────\n`)
  try {
    const output = execFileSync(process.execPath, [file], { encoding: 'utf8' })
    process.stdout.write(output)
    // The suite name may contain a hyphen (`interpolation-safety`), so the
    // separator class cannot be `\w+`: a missed match silently under-counts.
    const match = /(\d+) [\w-]+ tests passed/.exec(output)
    if (match) total += Number(match[1])
    else throw new Error(`the ${suite} suite printed no test count`)
  } catch (error) {
    failed = true
    process.stdout.write(error.stdout ?? '')
    process.stderr.write(error.stderr ?? '')
    process.stderr.write(`\n✗ the ${suite} suite failed\n`)
  }
}

process.stdout.write(`\n═══════════════════════════════════════════════\n`)
if (failed) {
  process.stderr.write(`✗ at least one suite failed\n`)
  process.exit(1)
}
console.log(`✓ ${total} tests passed across ${suites.length} suites`)
