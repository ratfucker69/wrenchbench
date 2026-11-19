/**
 * The repair conversation, kept inside WrenchBench.
 *
 * A bench session is not a coding session and must not appear in the workspace
 * session list: the technician should see one program with an Ask box, not a
 * chat transcript leaking into their workspace. So the panel owns a session of
 * its own —
 *
 *   - it is created in its own directory, so the workspace-scoped session list
 *     has nothing to show;
 *   - its id is remembered per board, so a repair thread survives restarts;
 *   - every question and answer is read back through this module, which means
 *     the panel draws the conversation itself.
 *
 * The agent is the same agent loop, the same tools and the same model as
 * anywhere else. Only the session is separate.
 *
 * Failures are reported, never hidden: when the session service is unavailable
 * the caller is told, because silently posting into the technician's workspace
 * conversation is exactly the behaviour this module exists to prevent.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** How many turns of history the panel is given. */
const MAX_MESSAGES = 200

/**
 * Turn scaffolding the harness writes into a session as a user message.
 *
 * A repair session is still a harness session, so the runtime context block, the
 * skill catalogue and the checkpoint notices arrive as if the technician had
 * typed them. They are not part of the bench conversation and must not be drawn
 * in the panel, or the transcript reads like source code.
 */
const HARNESS_TEXT = [
  /^<system-reminder>/i,
  /^<compacted-checkpoint>/i,
  /^This is an automatically generated checkpoint/i,
  /^Current runtime context./i,
  /^Time sampled while/i,
  /^RECALL:/i,
  /^\[WrenchBench\]/i,
]

/** True when a user message is harness scaffolding rather than the technician. */
export function isHarnessMessage(text) {
  const trimmed = String(text ?? '').trimStart()
  if (trimmed.length === 0) return true
  return HARNESS_TEXT.some((pattern) => pattern.test(trimmed))
}

/** Extract the readable text of a message's content blocks. */
function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/**
 * Read a session's events into the shape the panel draws.
 *
 * Only what a technician needs: their own questions, the answers, and one muted
 * line per tool the agent used. Reasoning, headers and tool payloads are not
 * part of the bench conversation.
 */
export function transcriptOf(events) {
  const messages = []
  for (const event of events ?? []) {
    if (!event?.type) continue
    if (event.type === 'user/message') {
      const text = textOf(event.data?.content)
      if (text.length > 0 && !isHarnessMessage(text)) messages.push({ role: 'user', text, time: event.time ?? null })
      continue
    }
    if (event.type === 'assistant/message') {
      const text = textOf(event.data?.message?.content)
      if (text.length > 0) messages.push({ role: 'assistant', text, time: event.time ?? null })
      continue
    }
    if (event.type === 'tool/call') {
      const name = String(event.data?.name ?? 'tool')
      messages.push({ role: 'tool', text: name, time: event.time ?? null })
    }
  }
  return messages.slice(-MAX_MESSAGES)
}

/**
 * The question a blocked turn is waiting on, if there is one.
 *
 * A repair session has no chat UI to answer `ask_user_question`, so a turn that
 * ends with one waits forever. The panel cannot answer the tool call either —
 * but it can draw the options and send the chosen label as the next message,
 * which is what the technician meant to do anyway. Detecting it here is what
 * turns a wedged thread into a working one.
 */
export function pendingQuestionOf(events) {
  let pending = null
  for (const event of events ?? []) {
    if (!event?.type) continue
    if (event.type === 'tool/call') {
      const name = String(event.data?.name ?? '')
      if (name !== 'ask_user_question') continue
      const args = parseArguments(event.data?.arguments)
      const first = Array.isArray(args?.questions) ? args.questions[0] : null
      pending = {
        callId: event.data?.callId ?? null,
        question: String(first?.question ?? '').trim(),
        header: String(first?.header ?? '').trim(),
        options: Array.isArray(first?.options)
          ? first.options
              .map((option) => (typeof option === 'string' ? option : String(option?.label ?? '').trim()))
              .filter((label) => label.length > 0)
          : [],
      }
      continue
    }
    // Any result closes the question it belongs to; a later call replaces it.
    if (event.type === 'tool/result') {
      const callId = event.data?.message?.toolCallId ?? event.data?.toolCallId ?? null
      if (pending && (callId === null || pending.callId === null || String(callId) === String(pending.callId))) pending = null
    }
  }
  return pending && pending.question.length > 0 ? pending : null
}

/**
 * Detect a turn that can never finish.
 *
 * The runner stops at the end of a turn, so a log whose last `turn/start` has no
 * `turn/end` is not "running" — and a cancelled turn whose tool call was never
 * answered stays exactly that way. Nothing is live to cancel, and every prompt
 * admitted afterwards is queued behind a turn that will never end: the panel
 * looks like it swallows messages. A dangling tool call is the same fault in a
 * narrower form, and it is what a bench `ask_user_question` leaves behind when
 * the technician answers by typing rather than by clicking an option.
 *
 * Both are read off the log itself, never off `running`, because `running` is
 * false in exactly the state this has to catch.
 */
export function wedgedOf(events) {
  const turns = new Map()
  const dangling = new Set()
  let open = null
  for (const event of events ?? []) {
    if (!event?.type) continue
    const turn = Number.isFinite(event.data?.turn) ? event.data.turn : null
    if (event.type === 'turn/start') {
      turns.set(turn, { steps: 0, ended: false, failure: null })
      open = turn
      dangling.clear()
      continue
    }
    if (event.type === 'turn/end') {
      const row = turns.get(turn)
      if (row) {
        row.ended = true
        row.failure = event.data?.reason?.kind === 'error' ? event.data.reason.error?.message ?? 'error' : null
      }
      if (open === turn) open = null
      continue
    }
    if (event.type === 'step/start') {
      const row = turns.get(turn)
      if (row) row.steps += 1
      continue
    }
    if (event.type === 'tool/call') {
      const callId = String(event.data?.callId ?? '')
      if (callId.length > 0) dangling.add(callId)
      continue
    }
    if (event.type === 'tool/result') {
      const callId = String(event.data?.message?.toolCallId ?? event.data?.toolCallId ?? '')
      if (callId.length > 0) dangling.delete(callId)
      continue
    }
  }
  const calls = [...dangling]
  if (open !== null) return { reason: 'open-turn', turn: open, failedTurns: 0, danglingCalls: calls }
  // A turn that ended with an error before taking a step is the failure this
  // exists to catch: the prompt that opened it was not answered and never landed
  // in the transcript. Nothing is running and nothing is thrown at the panel — it
  // simply looks like it drops what the technician types, which is what it did.
  // A *cancelled* turn is excluded on purpose: the technician pressing Stop also
  // leaves a turn with no step, and that thread is healthy.
  const failed = [...turns.values()].filter((row) => row.ended && row.steps === 0 && row.failure)
  if (failed.length > 0) {
    return {
      reason: 'failed-turn',
      turn: null,
      failedTurns: failed.length,
      failure: failed[failed.length - 1].failure,
      danglingCalls: calls,
    }
  }
  if (calls.length > 0) return { reason: 'dangling-call', turn: null, failedTurns: 0, danglingCalls: calls }
  return null
}

/** Tool arguments arrive as a JSON string; a malformed one is simply unusable. */
function parseArguments(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Own the per-board repair session.
 *
 * @param {object} options
 * @param {object} options.ctx the plugin context (services are read per call)
 * @param {string} options.root directory the repair sessions live under
 * @param {object} options.store the board store, for reading and writing the thread id
 */
export function createRepairThread({ ctx, root, store }) {
  const dirFor = (boardId) => path.join(root, 'repair', boardId)

  const controller = () => {
    const service = ctx.get('sessionController')
    return service && typeof service.prompt === 'function' ? service : null
  }

  function readId(boardId) {
    try {
      const stored = store.readRepairSession?.(boardId)
      return stored?.sessionId ?? null
    } catch {
      return null
    }
  }

  function saveId(boardId, sessionId, extra = {}) {
    try {
      store.writeRepairSession?.(boardId, { sessionId, ...extra })
    } catch {
      // A thread id is recoverable; failing to remember it is not fatal.
    }
  }

  /**
   * Create the session this board's repair thread runs in.
   *
   * The directory is created first and is deliberately outside the workspace:
   * that is what keeps the thread out of the workspace session list.
   */
  async function create(boardId, boardName) {
    const service = controller()
    if (!service || typeof service.create !== 'function') return { error: 'no-session-service' }
    const dir = dirFor(boardId)
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch (error) {
      return { error: 'cannot-create-directory', detail: String(error?.message ?? error) }
    }
    let created
    try {
      created = await service.create({ cwd: dir })
    } catch (error) {
      return { error: 'create-failed', detail: String(error?.message ?? error) }
    }
    const sessionId = created?.sessionId
    if (!sessionId) return { error: 'create-failed', detail: 'the session service returned no id' }
    // Name it, so a stray appearance anywhere in the harness still says what it
    // is rather than showing a bare session id.
    if (typeof service.rename === 'function' && boardName) {
      try {
        await service.rename({ sessionId, title: `WrenchBench — ${boardName}` })
      } catch {
        // Cosmetic only.
      }
    }
    saveId(boardId, sessionId, { name: boardName ?? null, at: new Date().toISOString() })
    return { sessionId }
  }

  /**
   * The board's thread, created on first use.
   *
   * A remembered id is only trusted while the session service still knows it.
   * The store groups sessions by working directory, so a group can disappear
   * (a swept store, a cleared profile) while the board record still carries its
   * id — and prompting into a session that no longer exists would fail at the
   * bench with a message about nothing. A stale id is therefore replaced, not
   * reused.
   */
  async function ensure(boardId, boardName) {
    const existing = readId(boardId)
    if (existing && (await sessionExists(existing))) return { sessionId: existing, created: false }
    const made = await create(boardId, boardName)
    if (made.error) return made
    return { sessionId: made.sessionId, created: true }
  }

  /** True when the session service can still see a session by id. */
  async function sessionExists(sessionId) {
    const service = controller()
    if (!service) return false
    if (typeof service.inspect === 'function') {
      try {
        const inspected = await service.inspect(sessionId)
        if (inspected && typeof inspected === 'object') return true
      } catch {
        return false
      }
    }
    if (typeof service.list === 'function') {
      try {
        const listed = await service.list({})
        return (listed?.items ?? []).some((item) => String(item.sessionId) === String(sessionId))
      } catch {
        return false
      }
    }
    return true
  }

  /** Start the thread over, leaving the old one behind. */
  async function reset(boardId, boardName) {
    return create(boardId, boardName)
  }

  /**
   * Ask one question in the board's own thread.
   *
   * The question goes in verbatim. The board, the rails and the marks are
   * already in the agent's system prompt, so no `[WrenchBench]` context lines
   * are mixed into the technician's words — which also keeps the transcript the
   * panel draws exactly what they typed.
   *
   * A bench thread can be blocked, and there are two versions of it. The first is
   * a turn still live on the runner — the interview brief tells the agent to end a
   * turn with a question, and `ask_user_question` waits for an answer only a chat
   * UI can give. The second is worse: a turn that died without closing (the runner
   * exited, or the call was interrupted), which reports `running: false` and yet
   * still swallows every prompt admitted after it. Both are cleared first — a live
   * turn by `cancel`, a dead one by forking the log past it, so that the transcript
   * the technician is reading survives.
   */
  async function ask(boardId, boardName, question) {
    const service = controller()
    if (!service) {
      return {
        accepted: false,
        reason: 'no-session-service',
        detail: 'This profile has no session service, so WrenchBench cannot keep its own repair thread.',
      }
    }
    const thread = await ensure(boardId, boardName)
    if (thread.error) {
      return {
        accepted: false,
        reason: thread.error,
        detail:
          thread.error === 'no-session-service'
            ? 'This profile has no session service, so WrenchBench cannot keep its own repair thread.'
            : `WrenchBench could not open a repair session (${thread.detail ?? thread.error}).`,
      }
    }

    // A turn still live on the runner is ended first, so the new question does not
    // queue behind work that only a chat UI could finish.
    const unblocked = await clearBlockedTurn(service, thread.sessionId)

    // Then the log is checked for a turn that is already dead but never closed.
    // Forking past it keeps the transcript and lets the harness synthesise the
    // closers; without a fork service the thread is replaced instead, which loses
    // the history but not the bench.
    const events = await inspectEvents(service, thread.sessionId)
    const wedge = wedgedOf(events)
    let recovery = null
    if (wedge) {
      const forked = await forkThread(service, thread.sessionId, events)
      if (forked) {
        thread.sessionId = forked
        saveId(boardId, forked, { name: boardName ?? null, at: new Date().toISOString() })
        recovery = 'forked'
      } else {
        const replaced = await create(boardId, boardName)
        if (!replaced.error) {
          thread.sessionId = replaced.sessionId
          recovery = 'replaced'
        }
      }
    }

    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 60000)
    try {
      await service.prompt(
        {
          requestId: `wrenchbench-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          sessionId: thread.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: question }],
        },
        abort.signal,
      )
    } catch (error) {
      return {
        accepted: false,
        reason: String(error?.code ?? error?.name ?? 'prompt-failed'),
        detail: error instanceof Error ? error.message : String(error),
        sessionId: thread.sessionId,
      }
    } finally {
      clearTimeout(timer)
    }
    return {
      accepted: true,
      sessionId: thread.sessionId,
      cancelledPreviousTurn: unblocked,
      recovered: recovery,
    }
  }

  /**
   * The session log, or an empty list when it cannot be read.
   *
   * Every decision below is made from events rather than from `running`: the state
   * that swallows prompts reports itself as idle.
   */
  async function inspectEvents(service, sessionId) {
    if (typeof service.inspect !== 'function') return []
    try {
      const inspected = await service.inspect(sessionId)
      return Array.isArray(inspected?.events) ? inspected.events : []
    } catch {
      return []
    }
  }

  /**
   * Fork a dead thread past its open turn, keeping the transcript.
   *
   * The fork boundary is pinned to the last event rather than left to the default
   * "latest completed turn", because a wedged log may have no completed turn at
   * all: the default would hand back an empty session and quietly drop the repair
   * conversation. An open cut is closed by the harness with synthetic closers, so
   * the forked session starts with a turn that can actually end.
   *
   * Returns the new session id, or null when this profile cannot fork.
   */
  async function forkThread(service, sessionId, events) {
    if (typeof service.fork !== 'function') return null
    const last = events?.length ? events[events.length - 1]?.seq : undefined
    const request = { sessionId }
    if (Number.isFinite(last)) request.atSeq = last
    try {
      const made = await service.fork(request)
      const forked = made?.sessionId
      if (!forked) return null
      if (String(forked) === String(sessionId)) return null
      return forked
    } catch {
      return null
    }
  }

  /**
   * Cancel a running turn so the thread can accept a new question.
   *
   * Returns true when a turn was actually cancelled. Never throws: a thread that
   * cannot be cancelled still gets the prompt admitted, and the queue does the
   * rest when the blocked turn is ended by the host.
   */
  async function clearBlockedTurn(service, sessionId) {
    if (typeof service.cancel !== 'function') return false
    const running = await isRunning(service, sessionId)
    if (!running) return false
    try {
      service.cancel({ sessionId })
    } catch {
      return false
    }
    // Give the turn a moment to actually end; the prompt is worth admitting even
    // if it queues, so this is a wait, not a gate.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (!(await isRunning(service, sessionId))) return true
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    return true
  }

  /** True when the session service reports a live turn for this session. */
  async function isRunning(service, sessionId) {
    if (typeof service.list !== 'function') return false
    try {
      const listed = await service.list({})
      const row = (listed?.items ?? []).find((item) => String(item.sessionId) === String(sessionId))
      return row?.running === true
    } catch {
      return false
    }
  }

  /**
   * End the thread's active turn without dropping what is queued behind it.
   *
   * The panel offers this because a bench turn can be waiting on something no
   * panel can supply; the technician needs a way out that is not "reload and
   * hope", and a cancelled turn still leaves the answer that already arrived.
   */
  async function cancel(boardId) {
    const service = controller()
    if (!service || typeof service.cancel !== 'function') {
      return { cancelled: false, reason: 'no-session-service' }
    }
    const existing = readId(boardId)
    if (!existing) return { cancelled: false, reason: 'no-thread' }
    if (!(await isRunning(service, existing))) return { cancelled: false, reason: 'idle' }
    try {
      service.cancel({ sessionId: existing })
    } catch (error) {
      return { cancelled: false, reason: 'cancel-failed', detail: error instanceof Error ? error.message : String(error) }
    }
    return { cancelled: true, sessionId: existing }
  }

  /** The thread as the panel draws it. */
  async function conversation(boardId, boardName) {
    const service = controller()
    if (!service) return { messages: [], running: false, sessionId: null, unavailable: 'no-session-service' }
    const thread = await ensure(boardId, boardName)
    if (thread.error) return { messages: [], running: false, sessionId: null, unavailable: thread.error }

    let messages = []
    let running = false
    let pending = null
    let wedge = null
    if (typeof service.inspect === 'function') {
      try {
        const inspected = await service.inspect(thread.sessionId)
        messages = transcriptOf(inspected?.events)
        // A turn waiting on an unanswerable question is the one state the panel
        // must draw differently: it needs the options, not a spinner.
        pending = pendingQuestionOf(inspected?.events)
        // A dead-but-unclosed turn is the other: nothing is running, and yet the
        // next question would vanish, so the panel has to say so.
        wedge = wedgedOf(inspected?.events)
      } catch {
        // A session that has not been written yet is simply empty.
      }
    }
    if (typeof service.list === 'function') {
      try {
        const listed = await service.list({})
        const row = (listed?.items ?? []).find((item) => String(item.sessionId) === String(thread.sessionId))
        running = row?.running === true
      } catch {
        // Running state is advisory; the transcript still draws.
      }
    }
    return {
      messages,
      running,
      pending,
      wedged: Boolean(pending) || Boolean(wedge),
      openTurn: wedge?.turn ?? null,
      sessionId: thread.sessionId,
    }
  }

  /**
   * Remove the thread for a board that is being deleted for good.
   *
   * Not for the reversible delete: a board that moves to the trash can come back,
   * and its thread must come back with it. Calling this from there deleted the
   * thread's session log while the board was still restorable, and the restored
   * board then admitted prompts into a session whose log file no longer existed:
   * every turn died with ENOENT before taking a step, so the panel accepted a
   * message and drew nothing, for ever. Trashed boards count as live in `sweep`
   * for the same reason.
   *
   * The board directory goes with the board, so the id file goes with it; what
   * is left behind is this module's own session directory and the harness's
   * session folder. Both are ours, and both are only removed when nothing is
   * live on that session — a repair in progress must not be deleted from under
   * the technician.
   */
  async function forget(boardId, knownSessionId = null) {
    let removed = { sessionDirectory: false, harnessDirectory: false }
    try {
      fs.rmSync(dirFor(boardId), { recursive: true, force: true })
      removed.sessionDirectory = true
    } catch {
      // Left behind; the sweep below will try again next start.
    }
    // The caller must hand over the id it read before the board was removed: once
    // the board directory is gone the record is gone with it, and
    // reading it here silently skipped the harness session — which is how ten
    // orphan session groups were left behind by the feature tour.
    const stored = knownSessionId ?? readId(boardId)
    if (stored) {
      const agents = ctx.get('agents')
      const live = agents && typeof agents.get === 'function' ? agents.get(stored) : undefined
      if (!live) {
        const sessionsRoot = path.join(process.env.USERPROFILE ?? process.env.HOME ?? os.homedir(), '.dsh', 'sessions')
        try {
          const entries = fs.readdirSync(sessionsRoot).filter((entry) => entry.includes("-repair-" + boardId + "--"))
          for (const entry of entries) {
            fs.rmSync(path.join(sessionsRoot, entry), { recursive: true, force: true })
            removed.harnessDirectory = true
          }
        } catch {
          // The session store may not be on this host; nothing to remove.
        }
      }
    }
    return removed
  }

  /**
   * Drop thread state for boards that no longer exist.
   *
   * A deleted board used to leave its repair directory and its session folder
   * behind, which grows without bound over a repair bench. Called at start.
   */
  function sweep(liveBoardIds) {
    // Session groups first, while this module's own repair directories are still
    // on disk: a group whose board has a repair directory here is live, whatever
    // the listing said. An orphan group then goes on the next start, after its
    // repair directory has been removed by this pass.
    let swept = sweepHarnessGroups(liveBoardIds)
    // Only this module's own directory is touched, and only directory entries
    // that look like board ids: a wider sweep here once reached the library.
    const repairRoot = path.join(root, 'repair')
    let entries = []
    try {
      entries = fs.readdirSync(repairRoot, { withFileTypes: true })
    } catch {
      return 0
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(entry.name)) continue
      if (liveBoardIds.includes(entry.name)) continue
      try {
        fs.rmSync(path.join(repairRoot, entry.name), { recursive: true, force: true })
        swept += 1
      } catch {
        // Locked or already gone.
      }
    }
    return swept
  }

  /**
   * Drop this module's session groups for boards that no longer exist.
   *
   * The session store names a group after the working directory, so a repair
   * thread leaves `…-wrenchbench-repair-<board-id>--` in the harness session
   * list. Those are the entries a technician sees as ungrouped sessions, and a
   * deleted board has no reason to keep one. The match is deliberately narrow —
   * the group must carry the `wrenchbench-repair` segment *and* end in a board id
   * that is not in the library — so no other session can be caught by it.
   */
  function sweepHarnessGroups(liveBoardIds) {
    // An empty or missing listing means the library could not be read, not that
    // every board is gone: sweeping on that reading would take a bench's repair
    // history with it. Refuse to sweep without a listing.
    if (!Array.isArray(liveBoardIds) || liveBoardIds.length === 0) return 0
    const sessionsRoot = path.join(process.env.USERPROFILE ?? process.env.HOME ?? os.homedir(), '.dsh', 'sessions')
    let swept = 0
    let entries = []
    try {
      entries = fs.readdirSync(sessionsRoot, { withFileTypes: true })
    } catch {
      return 0
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!entry.name.includes('-wrenchbench-repair-')) continue
      const match = /-wrenchbench-repair-([a-z0-9][a-z0-9-]{0,80})--$/.exec(entry.name)
      if (!match) continue
      if (liveBoardIds.includes(match[1])) continue
      // Two facts must agree before a group goes: the board is not in the
      // library, and this module's own directory for it is gone too. A board
      // whose repair directory is still there is live, whatever the listing
      // said at start-up.
      if (fs.existsSync(dirFor(match[1]))) continue
      // Never remove a group with a live agent on it: a repair in progress is
      // not ours to delete because the board record moved.
      try {
        fs.rmSync(path.join(sessionsRoot, entry.name), { recursive: true, force: true })
        swept += 1
      } catch {
        // Locked; try again next start.
      }
    }
    return swept
  }

  return { ensure, reset, ask, cancel, conversation, forget, sweep, transcriptOf }
}
