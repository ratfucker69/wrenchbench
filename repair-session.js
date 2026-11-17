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
    return { accepted: true, sessionId: thread.sessionId }
  }

  /** The thread as the panel draws it. */
  async function conversation(boardId, boardName) {
    const service = controller()
    if (!service) return { messages: [], running: false, sessionId: null, unavailable: 'no-session-service' }
    const thread = await ensure(boardId, boardName)
    if (thread.error) return { messages: [], running: false, sessionId: null, unavailable: thread.error }

    let messages = []
    let running = false
    if (typeof service.inspect === 'function') {
      try {
        const inspected = await service.inspect(thread.sessionId)
        messages = transcriptOf(inspected?.events)
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
    return { messages, running, sessionId: thread.sessionId }
  }

  /**
   * Remove the thread for a board that is being deleted.
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
    // The caller must hand over the id it read before the board moved to the
    // trash: once the board directory is gone the record is gone with it, and
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

  return { ensure, reset, ask, conversation, forget, sweep, transcriptOf }
}
