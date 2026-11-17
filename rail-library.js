/**
 * What the bench has learned about rails, across every board.
 *
 * One board's schematic is only one source of names. A bench that repairs
 * hundreds of boards can do better: every time a rail is named — proved from a
 * schematic, or typed by the technician — its electrical shape is remembered.
 * When a new board turns up with an unnamed net of a similar shape, that name
 * becomes a suggestion, with the other board as the citation.
 *
 * This is the part that makes naming dynamic rather than a one-off: the library
 * grows from use, and it never overwrites what the technician said.
 *
 * Stored as one JSON file under the library root, capped so it cannot grow
 * without bound, and keyed by name so votes from many boards aggregate.
 */

import fs from 'node:fs'
import path from 'node:path'

/** How many learned rails to keep. Oldest go first. */
const MAX_ENTRIES = 4000
/** How many boards one name needs before it is trusted for suggestions. */
export const MIN_AGREEING_BOARDS = 1
/** How many signatures are kept per name. */
const MAX_SIGNATURES_PER_NAME = 12

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function writeAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(value, null, 2))
  fs.renameSync(temp, file)
}

/**
 * The learned rail library for this bench.
 *
 * @param {string} root the wrenchbench data root
 */
export function createRailLibrary(root) {
  const file = path.join(root, 'rail-library.json')

  /** @returns {object[]} one entry per (name, board) pair */
  function entries() {
    const stored = readJson(file)
    const list = Array.isArray(stored?.entries) ? stored.entries : []
    return list.filter((entry) => entry && typeof entry.name === 'string' && entry.signature)
  }

  /**
   * Remember one named rail.
   *
   * Called for proved names and for names the technician confirmed; never for a
   * suggestion nobody accepted. Repeating the same (name, board, net) replaces
   * the earlier row rather than adding a duplicate.
   */
  function learn({ name, voltage = null, signature, boardId, boardName = null, net, source = 'schematic' }) {
    if (!name || !signature || !boardId || !net) return null
    const list = entries()
    const row = {
      name,
      voltage: typeof voltage === 'number' ? voltage : null,
      signature,
      boardId,
      boardName,
      net,
      source,
      at: new Date().toISOString(),
    }
    const index = list.findIndex((entry) => entry.name === name && entry.boardId === boardId && entry.net === net)
    if (index >= 0) list[index] = row
    else list.push(row)

    // Cap per name so one prolific board cannot crowd out the rest.
    const perName = list.filter((entry) => entry.name === name)
    const trimmed =
      perName.length > MAX_SIGNATURES_PER_NAME
        ? (() => {
            const keep = new Set(perName.slice(-MAX_SIGNATURES_PER_NAME))
            return list.filter((entry) => entry.name !== name || keep.has(entry))
          })()
        : list

    const capped = trimmed.slice(-MAX_ENTRIES)
    writeAtomic(file, { version: 1, entries: capped })
    return row
  }

  /** Everything known, newest last. */
  function all() {
    const list = entries()
    return list.map((entry) => ({
      name: entry.name,
      voltage: entry.voltage,
      signature: entry.signature,
      boardId: entry.boardId,
      boardName: entry.boardName,
      source: entry.source,
      pads: entry.signature ? Math.round(2 ** entry.signature.pads - 1) : null,
    }))
  }

  /**
   * Names this bench has seen, with how many boards agree on each.
   *
   * Used by the panel and the agent to offer a shortlist rather than every token
   * in every schematic.
   */
  function knownNames(limit = 24) {
    const votes = new Map()
    for (const entry of entries()) {
      const row = votes.get(entry.name) ?? { name: entry.name, boards: new Set(), voltage: entry.voltage, pads: 0 }
      row.boards.add(entry.boardId)
      if (row.voltage === null && typeof entry.voltage === 'number') row.voltage = entry.voltage
      if (entry.signature) row.pads = Math.max(row.pads, Math.round(2 ** entry.signature.pads - 1))
      votes.set(entry.name, row)
    }
    return [...votes.values()]
      .map((row) => ({ name: row.name, boards: row.boards.size, voltage: row.voltage, pads: row.pads }))
      .sort((a, b) => b.boards - a.boards || b.pads - a.pads)
      .slice(0, limit)
  }

  /** Drop everything learned on one board, for when a board is deleted. */
  function forgetBoard(boardId) {
    const list = entries()
    const kept = list.filter((entry) => entry.boardId !== boardId)
    if (kept.length === list.length) return 0
    writeAtomic(file, { version: 1, entries: kept })
    return list.length - kept.length
  }

  /** Where the library lives, for the tool and diagnostics. */
  function location() {
    return file
  }

  return { learn, all, knownNames, forgetBoard, location }
}
