/**
 * Screenshot the panel preview into test/shots/.
 *
 * Headless Edge is used directly rather than through a browser driver: the
 * driver available on this machine hangs, and `--headless=new --screenshot` is
 * the one that reliably returns. The theme is pinned per shot, because headless
 * Edge reports `prefers-color-scheme: dark` and an unpinned "light" capture
 * would silently show the dark palette.
 *
 * Edge caches `file://` by URL, so each capture writes to a unique filename.
 *
 * Run: node test/shots.mjs
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const shots = join(here, 'shots')
mkdirSync(shots, { recursive: true })

/** Find the Edge binary, trying the usual install locations. */
function findEdge() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ]
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  return undefined
}

const edge = findEdge()
if (edge === undefined) {
  console.log('--  (skipped: Microsoft Edge was not found, so no screenshots were taken)')
  process.exit(0)
}

const shotsToTake = [
  { locale: 'zh', theme: 'light' },
  { locale: 'zh', theme: 'dark' },
  { locale: 'en', theme: 'light' },
  { locale: 'en', theme: 'dark' },
]

for (const { locale, theme } of shotsToTake) {
  // Edge caches `file://` by URL, so each capture needs its own HTML path or
  // the second locale silently reuses the first one's image. A unique name per
  // capture is the fix; the file is removed again below.
  const unique = `${locale}-${theme}`
  const htmlPath = join(here, `preview-${unique}.html`)
  execFileSync(process.execPath, [join(here, 'preview.mjs')], {
    env: { ...process.env, PREVIEW_LOCALE: locale, PREVIEW_THEME: theme, PREVIEW_OUT: htmlPath },
    stdio: 'inherit',
  })
  const outPath = join(shots, `panel-${unique}.png`)
  rmSync(outPath, { force: true })
  execFileSync(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--window-size=820,1800',
      `--screenshot=${outPath}`,
      `file:///${htmlPath.replaceAll('\\', '/')}`,
    ],
    { stdio: 'inherit' },
  )
  rmSync(htmlPath, { force: true })
  const size = existsSync(outPath) ? statSync(outPath).size : 0
  console.log(`  ${size > 0 ? 'ok ' : 'FAIL'} ${outPath} (${size} bytes)`)
}

// `preview.html` is a build artifact, not documentation.
rmSync(join(here, 'preview.html'), { force: true })
console.log(`\nshots: ${readdirSync(shots).join(', ')}`)

/**
 * Prove the four captures are actually four different images.
 *
 * Edge's `file://` cache made two of them byte-identical once, which looks
 * exactly like a successful run. A size check alone would not have caught it,
 * so the hashes are compared and a collision fails the run.
 */
const hashes = new Map()
for (const { locale, theme } of shotsToTake) {
  const file = join(shots, `panel-${locale}-${theme}.png`)
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex')
  const twin = hashes.get(digest)
  if (twin !== undefined) {
    console.error(`\n✗ panel-${locale}-${theme}.png is byte-identical to panel-${twin}.png — the capture was cached`)
    process.exitCode = 1
  }
  hashes.set(digest, `${locale}-${theme}`)
}
if (process.exitCode !== 1) console.log(`all ${shotsToTake.length} shots are distinct images`)
