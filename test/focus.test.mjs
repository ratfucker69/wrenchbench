/**
 * Focus ownership tests.
 *
 * The bug this guards: the panel polls the agent's canvas focus every couple of
 * seconds, and the first version cleared the local selection whenever that
 * focus was empty. So a technician clicked a pad, saw its net light up, and lost
 * it two seconds later.
 *
 * The fix rests on two things, and both are checked here:
 *   1. the Host bumps a monotonic `revision` on every focus write, so "the agent
 *      re-pointed at the same part" is distinguishable from "the agent has done
 *      nothing since I last looked";
 *   2. the panel only adopts a focus whose signature it has not already applied.
 *
 * Run with `node test/focus.test.mjs`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const libraryDir = path.join(os.tmpdir(), `wrenchbench-focus-${process.pid}`)
process.env.DSH_WRENCHBENCH_DIR = libraryDir

const store = await import('../store.js')

let passed = 0
const failures = []

function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

console.log('\nfocus revision')

check('an untouched focus file has no revision', () => {
  const focus = store.readFocus()
  assert.equal(focus.revision, undefined)
})

check('the first write establishes revision 1', () => {
  const focus = store.writeFocus({ boardId: 'board-a', refdes: 'U1', net: null, pin: null, annotation: null })
  assert.equal(focus.revision, 1)
  assert.equal(store.readFocus().revision, 1)
})

check('re-issuing the same target still bumps the revision', () => {
  const first = store.writeFocus({ boardId: 'board-a', refdes: 'U1', net: null, pin: null, annotation: null })
  const second = store.writeFocus({ boardId: 'board-a', refdes: 'U1', net: null, pin: null, annotation: null })
  assert.equal(second.revision, first.revision + 1)
})

check('two writes in the same millisecond are still distinguishable', () => {
  // The revision, not the timestamp, is what the panel compares.
  const a = store.writeFocus({ refdes: 'C1' })
  const b = store.writeFocus({ refdes: 'C1' })
  assert.notEqual(a.revision, b.revision)
})

check('clearing a focus is a write, so a panel can tell it happened', () => {
  const before = store.readFocus().revision
  const cleared = store.writeFocus({ boardId: 'board-a', refdes: null, net: null, pin: null, annotation: null })
  assert.equal(cleared.revision, before + 1)
  assert.equal(cleared.refdes, null)
})

check('revision survives a reload of the record', () => {
  store.writeFocus({ refdes: 'R9' })
  const written = store.readFocus().revision
  const reread = store.readFocus().revision
  assert.equal(reread, written)
})

console.log('\npanel invariant')

const here = path.dirname(fileURLToPath(import.meta.url))
const clientSource = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

/** The poll body only — the invariant is about that block, not the whole file. */
function pollBlock() {
  const start = clientSource.indexOf('// --- the agent\'s canvas focus')
  if (start === -1) return ''
  const end = clientSource.indexOf('}, 2000)', start)
  return end === -1 ? '' : clientSource.slice(start, end)
}

check('the focus poll exists and still runs on a timer', () => {
  assert.notEqual(pollBlock().length, 0)
  assert.match(clientSource, /\}, 2000\)/)
})

check('the poll guards on the focus signature', () => {
  const block = pollBlock()
  assert.match(block, /const signature = focusSignature\(focus\)/)
  assert.match(block, /if \(signature !== appliedFocusRef\.current\)/)
  assert.match(block, /appliedFocusRef\.current = signature/)
})

check('the poll cannot clear the selection without a new agent command', () => {
  // The original bug: an empty agent focus reset the local selection inside the
  // poll, so a clicked pad lost its net highlight two seconds later.
  const block = pollBlock()
  assert.doesNotMatch(block, /!hasTarget/)
  assert.doesNotMatch(block, /setSelection\(\(previous\)/)
  assert.match(block, /setSelection\(selectionFromFocus\(focus\)\)/)
})

check('the signature includes the monotonic revision', () => {
  assert.match(clientSource, /focus\.revision \?\? focus\.updatedAt/)
})

check('opening a board adopts the live focus and records it as applied', () => {
  assert.match(clientSource, /appliedFocusRef\.current = focusSignature\(openingFocus\)/)
})

fs.rmSync(libraryDir, { recursive: true, force: true })

console.log(failures.length === 0 ? `\nFOCUS CHECKS PASS (${passed})` : `\n${failures.length} FOCUS CHECK(S) FAILED`)
if (failures.length > 0) process.exitCode = 1
