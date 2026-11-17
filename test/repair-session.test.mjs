/**
 * The repair thread: one session per board, owned by WrenchBench.
 *
 * The behaviour under test is what the technician sees — a conversation drawn
 * in the panel, its own directory, its own id, and no context lines mixed into
 * their words. The failure this prevents is the bench question landing in the
 * user's workspace chat.
 *
 * Run with `node test/repair-session.test.mjs`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const libraryDir = path.join(os.tmpdir(), `wrenchbench-repair-${process.pid}`)
process.env.DSH_WRENCHBENCH_DIR = libraryDir

const store = await import('../store.js')
const { createRepairThread, transcriptOf, isHarnessMessage } = await import('../repair-session.js')

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

async function checkAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

/** A fake session service that records what it was asked to do. */
function fakeService() {
  const made = []
  const prompts = []
  const renames = []
  const events = []
  let counter = 0
  return {
    made,
    prompts,
    renames,
    events,
    async create(request) {
      counter += 1
      const sessionId = `wrenchbench-${counter}`
      made.push({ sessionId, ...request })
      return { sessionId }
    },
    async rename(request) {
      renames.push(request)
      return { title: request.title, seq: 0 }
    },
    async prompt(request, signal) {
      signal?.throwIfAborted?.()
      prompts.push(request)
      events.push({ type: 'user/message', time: Date.now(), data: { role: 'user', content: request.content } })
      return { accepted: true }
    },
    async inspect() {
      return { events }
    },
    async list() {
      return { items: [{ sessionId: counter === 0 ? null : `wrenchbench-${counter}`, running: false }] }
    },
  }
}

const boardId = 'bench-board'
const boardName = 'Bench Board'
const service = fakeService()
const ctx = { get: (name) => (name === 'sessionController' ? service : undefined) }
const thread = createRepairThread({ ctx, root: store.dataRoot, store })

console.log('\ntranscript')

check('user and assistant text are paired, tool names kept as one line', () => {
  const messages = transcriptOf([
    { type: 'user/message', time: 1, data: { role: 'user', content: [{ type: 'text', text: 'which rail is Net73?' }] } },
    { type: 'tool/call', time: 2, data: { name: 'wrenchbench_net' } },
    { type: 'assistant/message', time: 3, data: { message: { content: [{ type: 'text', text: '1.0 V VDDCR_GFX' }] } } },
  ])
  assert.deepEqual(
    messages.map((message) => `${message.role}:${message.text}`),
    ['user:which rail is Net73?', 'tool:wrenchbench_net', 'assistant:1.0 V VDDCR_GFX'],
  )
})

check('harness scaffolding is recognised and kept out', () => {
  const scaffolding = [
    '<system-reminder>\nA skill is available',
    'Current runtime context. This snapshot supersedes earlier ones.',
    'Time sampled while preparing turn 3, step 1: ...',
    'This is an automatically generated checkpoint condensing an earlier span',
    '[WrenchBench] board on the canvas: PS5',
    'RECALL: append-only log',
  ]
  for (const text of scaffolding) assert.equal(isHarnessMessage(text), true, text)
  for (const text of ['which rail is Net73?', 'is Net72 shorted?', '0.9 V on the chip']) {
    assert.equal(isHarnessMessage(text), false, text)
  }
})

check('scaffolding never reaches the panel transcript', () => {
  const messages = transcriptOf([
    { type: 'user/message', data: { content: [{ type: 'text', text: 'which rail is Net73?' }] } },
    { type: 'user/message', data: { content: [{ type: 'text', text: 'Current runtime context. This snapshot…' }] } },
    { type: 'user/message', data: { content: [{ type: 'text', text: '<system-reminder> skills' }] } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '1.0 V VDDCR_GFX' }] } } },
  ])
  assert.deepEqual(
    messages.map((message) => `${message.role}:${message.text}`),
    ['user:which rail is Net73?', 'assistant:1.0 V VDDCR_GFX'],
  )
})

check('reasoning and empty messages are not part of the bench conversation', () => {
  const messages = transcriptOf([
    { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'thinking' }] } } },
    { type: 'user/message', data: { role: 'user', content: [] } },
  ])
  assert.equal(messages.length, 0)
})

console.log('\nownership')

await checkAsync('the first question creates a session in its own directory', async () => {
  const answer = await thread.ask(boardId, boardName, 'is Net72 shorted?')
  assert.equal(answer.accepted, true)
  assert.equal(service.made.length, 1)
  const dir = service.made[0].cwd
  assert.ok(dir.startsWith(store.dataRoot), `session cwd outside the wrenchbench root: ${dir}`)
  assert.ok(!/default-workspace/.test(dir), 'the repair session must not live in the workspace')
  assert.ok(fs.existsSync(dir), 'the session directory was not created')
})

await checkAsync('the session is named, so a stray sighting still says what it is', async () => {
  assert.equal(service.renames[0]?.title, `WrenchBench — ${boardName}`)
})

await checkAsync('the question goes in verbatim, with no context lines mixed in', async () => {
  const request = service.prompts[0]
  assert.equal(request.content.length, 1)
  assert.equal(request.content[0].text, 'is Net72 shorted?')
  assert.ok(!/\[WrenchBench\]/.test(request.content[0].text), 'context leaked into the technician\'s sentence')
  assert.equal(request.mode, 'queue')
})

await checkAsync('the thread id is remembered per board', async () => {
  const stored = store.readRepairSession(boardId)
  assert.equal(stored?.sessionId, 'wrenchbench-1')
  const second = await thread.ask(boardId, boardName, 'and Net73?')
  assert.equal(second.sessionId, 'wrenchbench-1')
  assert.equal(service.made.length, 1, 'a second question must reuse the thread')
})

await checkAsync('the conversation reads back as the panel draws it', async () => {
  const conversation = await thread.conversation(boardId, boardName)
  assert.equal(conversation.sessionId, 'wrenchbench-1')
  assert.equal(conversation.messages.length, 2)
  assert.equal(conversation.messages[0].role, 'user')
  assert.equal(conversation.messages[0].text, 'is Net72 shorted?')
  assert.equal(conversation.running, false)
})

await checkAsync('a new session replaces the thread and forgets the messages', async () => {
  const fresh = await thread.reset(boardId, boardName)
  assert.equal(fresh.sessionId, 'wrenchbench-2')
  service.events.length = 0
  const conversation = await thread.conversation(boardId, boardName)
  assert.equal(conversation.sessionId, 'wrenchbench-2')
  assert.equal(conversation.messages.length, 0)
})

await checkAsync('a board with no thread yet reads as empty, without creating one', async () => {
  const before = service.made.length
  const conversation = await thread.conversation('other-board', 'Other')
  assert.ok(conversation.sessionId, 'a thread should be opened on first read')
  assert.equal(service.made.length, before + 1)
  assert.equal(conversation.messages.length, 0)
})

await checkAsync('deleting the board removes its thread state', async () => {
  const made = await thread.ask('delete-me', 'Deletable', 'anything')
  assert.equal(made.accepted, true)
  const dir = path.join(store.dataRoot, 'repair', 'delete-me')
  assert.ok(fs.existsSync(dir), 'the thread directory was not created')
  const removed = await thread.forget('delete-me')
  assert.equal(removed.sessionDirectory, true)
  assert.equal(fs.existsSync(dir), false, 'the thread directory survived')
})

await checkAsync('a sweep drops threads for boards that no longer exist', async () => {
  await thread.ask('orphan-a', 'Orphan A', 'hi')
  await thread.ask('orphan-b', 'Orphan B', 'hi')
  const swept = thread.sweep(['orphan-a'])
  assert.ok(swept >= 1, 'nothing was swept')
  const root = path.join(store.dataRoot, 'repair')
  const left = fs.readdirSync(root)
  assert.ok(left.includes('orphan-a'), 'a live board lost its thread')
  assert.ok(!left.includes('orphan-b'), 'an orphaned thread survived')
})

console.log('\nfailures are reported, never hidden')

await checkAsync('a missing session service is a clear refusal', async () => {
  const bare = createRepairThread({ ctx: { get: () => undefined }, root: store.dataRoot, store })
  const answer = await bare.ask(boardId, boardName, 'hello')
  assert.equal(answer.accepted, false)
  assert.equal(answer.reason, 'no-session-service')
  assert.match(answer.detail, /session service/)
})

await checkAsync('a refused admission carries its reason', async () => {
  const refusing = createRepairThread({
    ctx: {
      get: () => ({
        async create() {
          return { sessionId: 'wrenchbench-9' }
        },
        async prompt() {
          const error = new Error('another writer holds this session')
          error.code = 'session/writer-held'
          throw error
        },
      }),
    },
    root: store.dataRoot,
    store,
  })
  const answer = await refusing.ask('refusing-board', 'Board', 'hello')
  assert.equal(answer.accepted, false)
  assert.equal(answer.reason, 'session/writer-held')
  assert.match(answer.detail, /writer holds/)
})

await checkAsync('a failure to create a directory is reported, not swallowed', async () => {
  const broken = createRepairThread({
    ctx: {
      get: () => ({
        // A usable service: the failure under test is the directory, not the
        // service lookup.
        async prompt() {
          return { accepted: true }
        },
        async create() {
          throw new Error('create is off')
        },
      }),
    },
    root: path.join(store.dataRoot, 'nope', '\u0000bad'),
    store,
  })
  const answer = await broken.ask('dir-board', 'Board', 'hello')
  assert.equal(answer.accepted, false)
  assert.ok(['cannot-create-directory', 'create-failed'].includes(answer.reason))
})

console.log('')
try {
  fs.rmSync(libraryDir, { recursive: true, force: true })
} catch {
  // Best effort.
}
if (failures.length > 0) {
  console.log(`${failures.length} REPAIR-SESSION CHECK(S) FAILED`)
  process.exit(1)
}
console.log(`REPAIR-SESSION CHECKS PASS (${passed})`)
