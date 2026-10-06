/**
 * Search the current session log for evidence of what each channel injected.
 *
 * The log is **multi-frame zstd**: `zstdDecompressSync` reads only the first
 * frame, which on this file yields a few hundred bytes of a 1.9 MB log and
 * makes every "not found" a lie. So the file is split on the zstd magic
 * (0x28 0xB5 0x2F 0xFD) and each frame decompressed on its own.
 *
 * A POSITIVE CONTROL runs first: something guaranteed to be in the log. Without
 * it, "found nothing" cannot be distinguished from "decoded nothing".
 *
 * Run: node test/probe-session.mjs <sessionDir> [needle]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * Decompress every zstd frame in a buffer.
 *
 * @param buffer - the raw file bytes.
 * @returns the concatenated decompressed frames, and how many frames were read.
 */
function decompressAllFrames(buffer) {
  const offsets = []
  for (let index = 0; index <= buffer.length - MAGIC.length; index += 1) {
    if (buffer.compare(MAGIC, 0, MAGIC.length, index, index + MAGIC.length) === 0) offsets.push(index)
  }
  let text = ''
  let frames = 0
  for (let index = 0; index < offsets.length; index += 1) {
    const slice = buffer.subarray(offsets[index], offsets[index + 1] ?? buffer.length)
    try {
      text += zstdDecompressSync(slice).toString('utf8')
      frames += 1
    } catch {
      /* a frame boundary inside a payload: skip it */
    }
  }
  return { text, frames, candidates: offsets.length }
}

const dir = process.argv[2] ?? join(process.env.DSH_HOME ?? '', 'sessions')
const needle = process.argv[3]
const file = join(dir, 'session.v4.jsonl.zstd')
const buffer = readFileSync(file)
const { text, frames, candidates } = decompressAllFrames(buffer)

console.log(`file: ${file}`)
console.log(`bytes: ${buffer.length}`)
console.log(`zstd magic hits: ${candidates}; frames decoded: ${frames}`)
console.log(`decoded chars: ${text.length}`)

// POSITIVE CONTROL: the harness always records its own system prompt identity.
const control = 'You are an AI agent powered by DeepSeek Harness'
const controlFound = text.includes(control)
console.log(`\nPOSITIVE CONTROL ("${control.slice(0, 30)}…"): ${controlFound ? 'FOUND' : 'MISSING'}`)
if (!controlFound) {
  console.log('  ✗ the decode produced nothing useful — every "not found" below is meaningless')
  process.exit(1)
}

const probes = needle === undefined
  ? ['系统通道探针', '上下文通道探针', '通道自检', 'prompt:user-snippets', 'unknown prompt variable']
  : [needle]

console.log('')
for (const probe of probes) {
  const at = text.indexOf(probe)
  console.log(`${probe}: ${at < 0 ? 'not found' : `found at ${at}`}`)
  if (at >= 0) {
    const start = Math.max(0, at - 120)
    console.log(`   …${text.slice(start, at + 160).replaceAll('\n', '\\n')}…`)
  }
}
