/**
 * Run every test file in this directory in its own process.
 *
 * Each suite is written as a plain script (no test framework), so isolation
 * matters: the store tests point DSH_WRENCHBENCH_DIR at a temp directory, and a
 * shared module cache would leak that between suites.
 *
 * Usage: node test/run-all.mjs
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const files = fs
  .readdirSync(here)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()

if (files.length === 0) {
  console.error('no test files found')
  process.exit(1)
}

const results = []
for (const file of files) {
  const started = Date.now()
  const result = spawnSync(process.execPath, [path.join(here, file)], {
    encoding: 'utf8',
    timeout: 120000,
  })
  const ms = Date.now() - started
  const ok = result.status === 0
  results.push({ file, ok, ms })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file.padEnd(24)} ${ms} ms`)
  if (!ok) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    console.log(
      output
        .split('\n')
        .filter((line) => /FAIL|Error|error|expected|actual/.test(line))
        .slice(0, 12)
        .map((line) => `      ${line.trim()}`)
        .join('\n'),
    )
  }
}

const failed = results.filter((entry) => !entry.ok)
console.log('')
console.log(`${results.length - failed.length}/${results.length} suites passed`)
if (failed.length > 0) {
  console.log(`failed: ${failed.map((entry) => entry.file).join(', ')}`)
  process.exit(1)
}
