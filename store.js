/**
 * The WrenchBench board library.
 *
 * One directory per board under `<dataRoot>/library`, holding the normalized
 * board model, the parsed schematic text layer and a small metadata record.
 * Raw uploads are never written to disk: only the derived model is kept, so
 * the library holds what the canvas can draw and the agent can cite, and
 * nothing else.
 *
 * Every write is atomic (temp file plus rename) so an interrupted import
 * cannot leave a half-parsed board that the canvas would then fail to draw.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Ceiling on one serialized board, so a huge library item cannot be loaded by accident. */
const MAX_BOARD_JSON_BYTES = 192 * 1024 * 1024

function resolveRoot() {
  const configured = process.env.DSH_WRENCHBENCH_DIR
  if (configured && configured.trim().length > 0) return path.resolve(configured.trim())
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim().length > 0
    ? path.resolve(process.env.DSH_HOME.trim())
    : path.join(os.homedir(), '.dsh')
  return path.join(home, 'wrenchbench')
}

export const dataRoot = resolveRoot()
const libraryRoot = path.join(dataRoot, 'library')
const trashRoot = path.join(dataRoot, 'trash')
const focusFile = path.join(dataRoot, 'focus.json')

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function writeAtomic(file, value) {
  ensureDir(path.dirname(file))
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, value)
  fs.renameSync(temporary, file)
}

function readJson(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function slugify(value) {
  const base = String(value ?? '')
    .toLowerCase()
    .replace(/\.[a-z0-9_]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return base.length > 0 ? base : 'board'
}

/** Content-addressed identity: importing the same file twice updates one entry. */
export function boardIdFor(bytes, name) {
  const digest = createHash('sha1').update(bytes).digest('hex').slice(0, 10)
  return `${slugify(name)}-${digest}`
}

function boardDir(id) {
  return path.join(libraryRoot, id)
}

function metaFile(id) {
  return path.join(boardDir(id), 'meta.json')
}

function boardFile(id) {
  return path.join(boardDir(id), 'board.json')
}

function schematicFile(id) {
  return path.join(boardDir(id), 'schematic.json')
}

function railLabelsFile(id) {
  return path.join(boardDir(id), 'rails.json')
}

function railMapFile(id) {
  return path.join(boardDir(id), 'railmap.json')
}

function repairSessionFile(id) {
  return path.join(boardDir(id), 'repair.json')
}

function aliasesFile(id) {
  return path.join(boardDir(id), 'aliases.json')
}

/** Guard every id that arrives from a URL so it cannot escape the library root. */
export function isBoardId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,80}$/.test(value)
}

/**
 * Save one parsed board.
 *
 * @param {{id: string, name: string, sourceName: string, format: string, units: string, board: object, warnings: string[]}} input
 * @returns {object} the stored metadata record
 */
export function saveBoard(input) {
  const id = input.id
  const stats = input.board?.stats ?? { parts: 0, pins: 0, nets: 0 }
  const previous = readJson(metaFile(id))

  const meta = {
    id,
    name: input.name ?? previous?.name ?? id,
    sourceName: input.sourceName ?? previous?.sourceName ?? '',
    format: input.format ?? 'unknown',
    units: input.units ?? 'unit',
    stats,
    warnings: Array.isArray(input.warnings) ? input.warnings : [],
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    importedCount: (previous?.importedCount ?? 0) + 1,
    lastViewedAt: new Date().toISOString(),
  }

  const serialized = JSON.stringify(input.board)
  if (serialized.length > MAX_BOARD_JSON_BYTES) {
    throw new Error(`the parsed board is larger than the ${Math.round(MAX_BOARD_JSON_BYTES / 1024 / 1024)} MB library ceiling`)
  }

  writeAtomic(boardFile(id), serialized)
  writeAtomic(metaFile(id), JSON.stringify(meta, null, 2))
  return meta
}

/** Every stored board, most recently used first. */
export function listBoards() {
  let entries
  try {
    entries = fs.readdirSync(libraryRoot, { withFileTypes: true })
  } catch {
    return []
  }

  const boards = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!isBoardId(entry.name)) continue
    const meta = readJson(metaFile(entry.name))
    if (!meta) continue
    const schematic = readJson(schematicFile(entry.name))
    boards.push({
      ...meta,
      schematic: schematic
        ? { name: schematic.name, stats: schematic.stats, uploadedAt: schematic.uploadedAt }
        : null,
    })
  }

  boards.sort((a, b) => String(b.lastViewedAt ?? b.updatedAt).localeCompare(String(a.lastViewedAt ?? a.updatedAt)))
  return boards
}

/** One metadata record, or undefined when the id is unknown. */
export function readMeta(id) {
  if (!isBoardId(id)) return undefined
  return readJson(metaFile(id))
}

/**
 * The full stored board. Only `meta` is kept in memory for the library list;
 * the model itself is loaded on demand because a large board is many MB.
 *
 * @returns {{meta: object, board: object} | undefined}
 */
export function readBoard(id) {
  const meta = readMeta(id)
  if (!meta) return undefined
  const board = readJson(boardFile(id))
  if (!board) return undefined
  return { meta, board }
}

/** Touch the last-viewed stamp so the library list reflects bench reality. */
export function markViewed(id) {
  const meta = readMeta(id)
  if (!meta) return undefined
  const next = { ...meta, lastViewedAt: new Date().toISOString() }
  writeAtomic(metaFile(id), JSON.stringify(next, null, 2))
  return next
}

/**
 * Trash a board: move it out of the library, do not destroy it.
 *
 * A board carries labels, voltages, marks and the schematic — the only part of
 * the record that cannot be regenerated from a boardview. Deleting is therefore
 * reversible by default: the directory moves to `trash/` under its own name and
 * comes back whole, and the list of what is in the trash is what the panel's
 * undo offers.
 *
 * @param {string} id board id
 * @returns {string|false} the trash entry name, or false when nothing moved
 */
export function deleteBoard(id) {
  if (!isBoardId(id)) return false
  const source = boardDir(id)
  if (!fs.existsSync(source)) return false
  try {
    ensureDir(trashRoot)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const entry = `${id}__${stamp}`
    fs.renameSync(source, path.join(trashRoot, entry))
    const focus = readFocus()
    if (focus?.boardId === id) writeFocus({ boardId: null, refdes: null, net: null, pin: null, annotation: null })
    return entry
  } catch {
    return false
  }
}

/** What is in the trash, newest first: `{entry, id, name, trashedAt}`. */
export function listTrash() {
  let entries = []
  try {
    entries = fs.readdirSync(trashRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const rows = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const [id, stamp] = String(entry.name).split('__')
    if (!id) continue
    const meta = readJson(path.join(trashRoot, entry.name, 'meta.json'))
    rows.push({
      entry: entry.name,
      id,
      name: meta?.name ?? id,
      trashedAt: stamp ?? null,
      boards: meta?.stats?.pins ?? null,
    })
  }
  return rows.sort((a, b) => String(b.trashedAt).localeCompare(String(a.trashedAt)))
}

/**
 * Put a trashed board back.
 *
 * Refuses when a board with that id is already back in the library rather than
 * overwriting it: a restore must never destroy a newer copy.
 *
 * @param {string} entry the trash entry name from `listTrash`
 * @returns {{restored: boolean, id?: string, error?: string}}
 */
export function restoreBoard(entry) {
  const name = String(entry ?? '')
  if (!/^[a-z0-9][a-z0-9-]{0,80}__[0-9A-Za-z-]+$/.test(name)) return { restored: false, error: 'unknown trash entry' }
  const id = name.split('__')[0]
  if (!isBoardId(id)) return { restored: false, error: 'unknown trash entry' }
  const source = path.join(trashRoot, name)
  if (!fs.existsSync(source)) return { restored: false, error: 'that entry is no longer in the trash' }
  if (fs.existsSync(boardDir(id))) return { restored: false, error: 'a board with that id is already in the library' }
  try {
    fs.renameSync(source, boardDir(id))
    return { restored: true, id }
  } catch (error) {
    return { restored: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function readSchematic(id) {
  if (!isBoardId(id)) return undefined
  return readJson(schematicFile(id))
}

/**
 * Store an extracted schematic text layer for one board.
 *
 * @param {string} id board id
 * @param {object} extracted the result of `extractPdfText`
 */
export function saveSchematic(id, extracted) {
  if (!isBoardId(id)) throw new Error('unknown board')
  const record = {
    name: extracted.name,
    uploadedAt: new Date().toISOString(),
    bytes: extracted.bytes,
    stats: extracted.stats,
    pageNumbering: extracted.pageNumbering,
    warnings: extracted.warnings ?? [],
    tokens: extracted.tokens,
    pages: extracted.pages,
  }
  writeAtomic(schematicFile(id), JSON.stringify(record))
  return record
}

export function deleteSchematic(id) {
  if (!isBoardId(id)) return false
  try {
    fs.rmSync(schematicFile(id), { force: true })
    return true
  } catch {
    return false
  }
}

/**
 * The canvas focus the agent last asked for. The panel reads this so an agent
 * can point at a pad while the technician looks at the board.
 */
export function readFocus() {
  return readJson(focusFile) ?? { boardId: null, refdes: null, net: null, pin: null, annotation: null }
}

/** Merge a focus patch; `null` clears a field. */
export function writeFocus(patch) {
  const current = readFocus()
  const next = {
    boardId: patch.boardId === undefined ? current.boardId : patch.boardId,
    refdes: patch.refdes === undefined ? current.refdes : patch.refdes,
    net: patch.net === undefined ? current.net : patch.net,
    pin: patch.pin === undefined ? current.pin : patch.pin,
    annotation: patch.annotation === undefined ? current.annotation : patch.annotation,
    // Monotonic, so a panel can tell "the agent just re-pointed at the same
    // part" from "the agent has done nothing since I last looked". A timestamp
    // is not enough: two writes in the same millisecond compare equal.
    revision: (Number(current.revision) || 0) + 1,
    updatedAt: new Date().toISOString(),
  }
  writeAtomic(focusFile, JSON.stringify(next))
  return next
}

// ---------------------------------------------------------------------------
// Observations: what the technician has marked on this board
// ---------------------------------------------------------------------------

function observationsFile(id) {
  return path.join(boardDir(id), 'observations.json')
}

const OBSERVATION_KINDS = new Set(['short', 'short-to-ground', 'open', 'ok'])

/**
 * Every mark recorded against one board, oldest first.
 *
 * A mark is one of: `short` (a component or pad is shorted), `short-to-ground`
 * (shorted specifically to ground), `open` (no continuity), or `ok` (measured
 * good — this removes the part from the suspicion list).
 */
export function readObservations(id) {
  if (!isBoardId(id)) return []
  const stored = readJson(observationsFile(id))
  return Array.isArray(stored?.items) ? stored.items : []
}

function writeObservations(id, items) {
  writeAtomic(observationsFile(id), JSON.stringify({ items }, null, 2))
  return items
}

/**
 * Record one mark. A mark with the same kind, refdes, pin and net replaces the
 * previous one, so re-marking is idempotent rather than accumulating duplicates.
 *
 * @param {string} id board id
 * @param {{kind: string, refdes?: string, pin?: number, net?: string, note?: string}} observation
 * @returns {object[]} the resulting list
 */
export function addObservation(id, observation) {
  if (!isBoardId(id)) throw new Error('unknown board')
  const kind = String(observation.kind ?? '')
  if (!OBSERVATION_KINDS.has(kind)) {
    throw new Error(`kind must be one of ${[...OBSERVATION_KINDS].join(', ')}`)
  }
  const refdes = observation.refdes ? String(observation.refdes).toUpperCase() : null
  const net = observation.net ? String(observation.net) : null
  const pin = Number.isFinite(Number(observation.pin)) ? Number(observation.pin) : null
  if (!refdes && !net) throw new Error('a mark needs a refdes or a net')

  const items = readObservations(id).filter(
    (item) => !(item.kind === kind && item.refdes === refdes && item.net === net && item.pin === pin),
  )
  items.push({
    id: `${kind}:${refdes ?? ''}:${pin ?? ''}:${net ?? ''}`,
    kind,
    refdes,
    net,
    pin,
    note: observation.note ? String(observation.note).slice(0, 500) : null,
    at: new Date().toISOString(),
  })
  return writeObservations(id, items)
}

/**
 * Remove marks. With no filter every mark goes; with a filter only the marks
 * that match it.
 */
export function clearObservations(id, filter = {}) {
  if (!isBoardId(id)) return []
  const hasFilter = Boolean(filter.refdes || filter.net || filter.kind)
  if (!hasFilter) return writeObservations(id, [])
  const refdes = filter.refdes ? String(filter.refdes).toUpperCase() : null
  const net = filter.net ? String(filter.net) : null
  const items = readObservations(id).filter((item) => {
    if (refdes && item.refdes !== refdes) return true
    if (net && item.net !== net) return true
    if (filter.kind && item.kind !== filter.kind) return true
    return false
  })
  return writeObservations(id, items)
}

/**
 * Rail labels the technician (or the agent, from the schematic) has assigned.
 *
 * The PS5 boardview names its nets `Net72`, and its refdes do not line up with
 * the schematic's designators, so the voltage of a rail cannot be derived —
 * it has to be told. This is that memory, per board.
 *
 * @returns {Record<string, {label: string, voltage: number|null, at: string}>}
 */
export function readRailLabels(id) {
  if (!isBoardId(id)) return {}
  const stored = readJson(railLabelsFile(id))
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
}

/**
 * Set or clear one rail label.
 *
 * The label carries where it came from. A name typed at the bench is the
 * technician's own evidence and outranks anything inferred; a name matched from
 * the schematic keeps its confidence and the counts it was built from, so the
 * panel can show why it says `VDDCR_GFX` instead of `Net73`.
 *
 * @param {string} id board id
 * @param {string} net the real net name on the board
 * @param {string|null} label the display label; null or empty clears it
 * @param {object} [extra] provenance: `{source, confidence, evidence, at}`
 */
export function setRailLabel(id, net, label, extra = {}) {
  if (!isBoardId(id)) throw new Error('unknown board')
  const name = String(net ?? '').trim()
  if (name.length === 0) throw new Error('a net name is required')
  const labels = readRailLabels(id)
  const text = label === null || label === undefined ? '' : String(label).trim().slice(0, 48)
  if (text.length === 0) delete labels[name]
  else {
    labels[name] = {
      label: text,
      source: typeof extra.source === 'string' && extra.source.length > 0 ? extra.source : 'bench',
      confidence: typeof extra.confidence === 'string' ? extra.confidence : null,
      evidence: Array.isArray(extra.evidence) ? extra.evidence.slice(0, 6) : [],
      // Only a stated voltage is stored. Anything else would be an estimate on
      // a rail, which is exactly the number a technician must not guess.
      voltage: typeof extra.voltage === 'number' && Number.isFinite(extra.voltage) ? extra.voltage : null,
      at: new Date().toISOString(),
    }
  }
  writeAtomic(railLabelsFile(id), JSON.stringify(labels, null, 2))
  return labels
}

/**
 * The last schematic-to-board rail match, with its evidence and open choices.
 *
 * Stored next to the labels rather than inside them: a label is committed
 * knowledge, a map entry is an argument, and the ambiguous rows are questions.
 *
 * @returns {{assignments: object[], ambiguous: object[], parts: object[], rails: object[], unmatched: object[], warnings: string[], at: string}|null}
 */
export function readRailMap(id) {
  if (!isBoardId(id)) return null
  const stored = readJson(railMapFile(id))
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : null
}

/**
 * The repair thread this board's questions are asked in.
 *
 * Remembered per board so a bench conversation survives a restart. The session
 * itself lives outside the workspace, which is what keeps it out of the
 * workspace session list.
 *
 * @returns {{sessionId: string, name: string|null, at: string}|null}
 */
export function readRepairSession(id) {
  if (!isBoardId(id)) return null
  const stored = readJson(repairSessionFile(id))
  return stored && typeof stored === 'object' && typeof stored.sessionId === 'string' ? stored : null
}

/** Remember the repair thread for one board. */
export function writeRepairSession(id, value) {
  if (!isBoardId(id)) return null
  writeAtomic(repairSessionFile(id), JSON.stringify(value ?? {}, null, 2))
  return value
}

/** Replace the stored rail match for one board. */
export function writeRailMap(id, map) {
  if (!isBoardId(id)) return null
  writeAtomic(railMapFile(id), JSON.stringify(map ?? {}, null, 2))
  return map
}

/**
 * Names derived for parts the boardview could not label.
 *
 * Keyed by the boardview's own label (`N16136`), never replacing it: an alias
 * is an inference with a source and a confidence, and the raw label stays the
 * identity everywhere in the store.
 *
 * @returns {Record<string, {alias: string|null, source: string, confidence: string, evidence: string[], candidates: object[], at: string}>}
 */
export function readAliases(id) {
  if (!isBoardId(id)) return {}
  const stored = readJson(aliasesFile(id))
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
}

/**
 * Replace the alias table for one board.
 *
 * @param {string} id board id
 * @param {Record<string, object>} aliases
 */
export function writeAliases(id, aliases) {
  if (!isBoardId(id)) throw new Error('unknown board')
  writeAtomic(aliasesFile(id), JSON.stringify(aliases ?? {}, null, 2))
  return aliases
}

/**
 * Set or clear one alias.
 *
 * @param {string} id board id
 * @param {string} refdes the boardview's own label
 * @param {string|null} alias the name to display; empty clears it
 * @param {object} [extra] source/confidence/evidence to record with it
 */
export function setAlias(id, refdes, alias, extra = {}) {
  if (!isBoardId(id)) throw new Error('unknown board')
  const key = String(refdes ?? '').trim()
  if (key.length === 0) throw new Error('a component label is required')
  const aliases = readAliases(id)
  const text = alias === null || alias === undefined ? '' : String(alias).trim().slice(0, 40)
  if (text.length === 0) delete aliases[key]
  else {
    aliases[key] = {
      alias: text,
      source: extra.source ? String(extra.source) : 'bench',
      confidence: extra.confidence ? String(extra.confidence) : 'confirmed',
      evidence: Array.isArray(extra.evidence) ? extra.evidence.map(String).slice(0, 6) : [],
      candidates: Array.isArray(extra.candidates) ? extra.candidates.slice(0, 8) : [],
      at: new Date().toISOString(),
    }
  }
  writeAtomic(aliasesFile(id), JSON.stringify(aliases, null, 2))
  return aliases
}
