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

  /** The board's thread, created on first use. */
  async function ensure(boardId, boardName) {
    const existing = readId(boardId)
    if (existing) return { sessionId: existing, created: false }
    const made = await create(boardId, boardName)
    if (made.error) return made
    return { sessionId: made.sessionId, created: true }
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

  return { ensure, reset, ask, conversation, transcriptOf }
}
