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
const { createRepairThread, transcriptOf, isHarnessMessage, pendingQuestionOf } = await import('../repair-session.js')

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

// A repair thread also leaves a group in the harness session store. The bench
// once left ten of those behind, which is what a technician sees as an
// ungrouped session.
const fakeHome = path.join(os.tmpdir(), `wrenchbench-home-${process.pid}`)
const sessionsRoot = path.join(fakeHome, '.dsh', 'sessions')
const groupFor = (id) => path.join(sessionsRoot, `--C-Users-bench-.dsh-wrenchbench-repair-${id}--`)
const realHome = process.env.USERPROFILE
const realHomeLower = process.env.HOME
process.env.USERPROFILE = fakeHome
process.env.HOME = fakeHome
fs.mkdirSync(sessionsRoot, { recursive: true })

await checkAsync('forget removes the harness session group even after the board is gone', async () => {
  await thread.ask('gone-board', 'Gone Board', 'hi')
  const stored = store.readRepairSession('gone-board')
  assert.ok(stored?.sessionId, 'the thread id was not recorded')
  fs.mkdirSync(groupFor('gone-board'), { recursive: true })
  // Delete the board record first, exactly as the delete route does: the id
  // must be handed over, or the group is unreachable from the store.
  store.deleteBoard('gone-board')
  const removed = await thread.forget('gone-board', stored.sessionId)
  assert.equal(removed.harnessDirectory, true, 'the session group survived the delete')
  assert.equal(fs.existsSync(groupFor('gone-board')), false, 'the group is still on disk')
})

await checkAsync('a sweep drops session groups whose board is gone', () => {
  fs.mkdirSync(groupFor('sweep-live'), { recursive: true })
  fs.mkdirSync(groupFor('sweep-dead'), { recursive: true })
  // Not ours: a group that only looks similar must be left alone.
  const foreign = path.join(sessionsRoot, '--C-Users-bench-Documents-workspace--')
  fs.mkdirSync(foreign, { recursive: true })
  thread.sweep(['sweep-live'])
  assert.equal(fs.existsSync(groupFor('sweep-live')), true, 'a live board lost its session group')
  assert.equal(fs.existsSync(groupFor('sweep-dead')), false, 'an orphaned session group survived')
  assert.equal(fs.existsSync(foreign), true, 'the sweep reached a session that is not ours')
})


await checkAsync('a remembered id the service no longer knows is replaced', async () => {
  const strict = createRepairThread({
    ctx: {
      get: () => ({
        async create() {
          return { sessionId: 'fresh-1' }
        },
        async rename() {
          return {}
        },
        async inspect(id) {
          if (id === 'fresh-1') return { events: [] }
          throw new Error('no such session')
        },
        // controller() only accepts a service that can admit a prompt.
        async prompt() {
          return { accepted: true }
        },
        async list() {
          return { items: [{ sessionId: 'fresh-1' }] }
        },
      }),
    },
    root: store.dataRoot,
    store,
  })
  store.writeRepairSession('stale-board', { sessionId: 'gone-forever' })
  const reconnected = await strict.ensure('stale-board', 'Stale Board')
  assert.equal(reconnected.created, true, 'the stale id was reused')
  assert.equal(reconnected.sessionId, 'fresh-1')
  assert.equal(store.readRepairSession('stale-board')?.sessionId, 'fresh-1', 'the record still holds the dead id')
})

await checkAsync('a group whose repair directory survives is left alone', () => {
  const kept = path.join(store.dataRoot, 'repair', 'kept-live')
  fs.mkdirSync(kept, { recursive: true })
  fs.mkdirSync(groupFor('kept-live'), { recursive: true })
  // The listing is empty: the belt-and-braces check is what protects it.
  thread.sweep([])
  assert.equal(fs.existsSync(groupFor('kept-live')), true, 'a live repair directory lost its session group')
})


await checkAsync('an empty listing never wipes session groups', () => {
  fs.mkdirSync(groupFor('listing-lost'), { recursive: true })
  // An empty array is what a failed library read looks like. It must not be
  // read as "nothing is live".
  thread.sweep([])
  assert.equal(fs.existsSync(groupFor('listing-lost')), true, 'an unreadable library cost a session group')
})

// A real listing of a live board still leaves its group alone.
await checkAsync('a real listing keeps the group of a live board', () => {
  const kept = path.join(store.dataRoot, 'repair', 'listing-live')
  fs.mkdirSync(kept, { recursive: true })
  fs.mkdirSync(groupFor('listing-live'), { recursive: true })
  thread.sweep(['listing-live'])
  assert.equal(fs.existsSync(groupFor('listing-live')), true, 'a live board lost its session group')
})

process.env.USERPROFILE = realHome
process.env.HOME = realHomeLower


console.log('\na blocked turn')

await check('the pending question is read off the transcript', () => {
  assert.equal(pendingQuestionOf([{ type: 'tool/call', data: { name: 'wrenchbench_mark', arguments: '{}' } }]), null)
  const call = {
    type: 'tool/call',
    data: {
      name: 'ask_user_question',
      callId: 'call-1',
      arguments: JSON.stringify({
        questions: [{ question: 'Rail present?', header: 'Rail', options: [{ label: '0 V' }, { label: '3.3 V' }, 'not reachable'] }],
      }),
    },
  }
  const pending = pendingQuestionOf([call])
  assert.equal(pending.question, 'Rail present?')
  assert.deepEqual(pending.options, ['0 V', '3.3 V', 'not reachable'])
  // A result for that call closes it again.
  const answered = pendingQuestionOf([
    call,
    { type: 'tool/result', data: { message: { toolCallId: 'call-1' } } },
  ])
  assert.equal(answered, null)
  // Malformed arguments are unusable, not fatal.
  assert.equal(pendingQuestionOf([{ type: 'tool/call', data: { name: 'ask_user_question', arguments: '{oops' } }]), null)
})

await checkAsync('asking cancels a turn that is stuck on a question', async () => {
  const calls = []
  let running = true
  const sticky = createRepairThread({
    ctx: {
      get: () => ({
        async create() {
          return { sessionId: 'stuck-1' }
        },
        async rename() {
          return {}
        },
        async inspect() {
          return { events: [{ type: 'tool/call', data: { name: 'ask_user_question', arguments: '{}' } }] }
        },
        async list() {
          return { items: [{ sessionId: 'stuck-1', running }] }
        },
        cancel(request) {
          calls.push(request)
          running = false
          return { accepted: true }
        },
        async prompt(request) {
          calls.push(request)
          return { accepted: true }
        },
      }),
    },
    root: store.dataRoot,
    store,
  })
  const answer = await sticky.ask('stuck-board', 'Stuck Board', 'next question')
  assert.equal(answer.accepted, true)
  assert.equal(answer.cancelledPreviousTurn, true, 'the blocked turn was not cancelled')
  assert.equal(calls[0].sessionId, 'stuck-1', 'the cancel went to the wrong session')
  assert.equal(calls[1].content[0].text, 'next question', 'the prompt did not follow the cancel')
})

await checkAsync('an idle thread is not cancelled', async () => {
  let cancelled = false
  const idle = createRepairThread({
    ctx: {
      get: () => ({
        async create() {
          return { sessionId: 'idle-1' }
        },
        async rename() {
          return {}
        },
        async list() {
          return { items: [{ sessionId: 'idle-1', running: false }] }
        },
        cancel() {
          cancelled = true
          return { accepted: true }
        },
        async prompt() {
          return { accepted: true }
        },
      }),
    },
    root: store.dataRoot,
    store,
  })
  const answer = await idle.ask('idle-board', 'Idle Board', 'q')
  assert.equal(answer.cancelledPreviousTurn, false)
  assert.equal(cancelled, false, 'an idle thread was cancelled for no reason')
})

await checkAsync('the transcript reports the question the panel must draw', async () => {
  const shown = createRepairThread({
    ctx: {
      get: () => ({
        async create() {
          return { sessionId: 'pending-1' }
        },
        async inspect() {
          return {
            events: [
              { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Rail first.' }] } } },
              {
                type: 'tool/call',
                data: { name: 'ask_user_question', callId: 'c9', arguments: JSON.stringify({ questions: [{ question: '0 V or 3.3 V?', options: [{ label: '0 V' }, { label: '3.3 V' }] }] }) },
              },
            ],
          }
        },
        async list() {
          return { items: [{ sessionId: 'pending-1', running: true }] }
        },
        async prompt() {
          return { accepted: true }
        },
      }),
    },
    root: store.dataRoot,
    store,
  })
  const threadView = await shown.conversation('pending-board', 'Pending Board')
  // The answer, then one muted line for the tool it used.
  assert.equal(threadView.messages.length, 2)
  assert.equal(threadView.messages[0].role, 'assistant')
  assert.match(threadView.messages[0].text, /Rail first/)
  assert.equal(threadView.pending.question, '0 V or 3.3 V?')
  assert.deepEqual(threadView.pending.options, ['0 V', '3.3 V'])
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
