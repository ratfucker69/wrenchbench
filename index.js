/**
 * WrenchBench — Host half.
 *
 * Owns three things that the Client half and the agent both read:
 *
 *   1. the boardview parsers (see parsers.js) and the on-disk library (store.js);
 *   2. the HTTP surface under /api/dsh-wrenchbench that the sidebar panel calls;
 *   3. the `wrenchbench_*` tools, which answer from exactly the board the
 *      canvas is showing, so an agent never invents a refdes or a net.
 *
 * One rule drives the design: there is a single source of truth per board.
 * The panel does not keep its own copy of the model and the tools do not
 * re-parse anything — both read the library record, which is why the agent
 * can say "pin 12 of U7 sits on +3V3" and the canvas can light that pin.
 */

import fs from 'node:fs'
import path from 'node:path'

import { BoardParseError, parseBoard, SUPPORTED_EXTENSIONS } from './parsers.js'
import { pagesForToken, searchSchematic } from './pdf-text.js'
import { extractSchematic } from './schematic.js'
import { assignComponentRails, classifyRails, deriveRailAliases, ensureLabelledRails, formatVoltage, voltageOf } from './rails.js'
import { matchSchematicRails } from './schematic-rails.js'
import { netSignature, planRailNames, labelEntriesFor, railVocabulary } from './rail-naming.js'
import { createRailLibrary } from './rail-library.js'
import { createRepairThread } from './repair-session.js'
import { classifyParts, displayRefdes, isPlaceholderRefdes, planNaming } from './naming.js'
import { resolveQuery } from './resolve.js'
import { nextChecks } from './diagnose.js'
import * as store from './store.js'

export const name = 'dsh-wrenchbench'
export const inject = ['webServer', 'tools']

const ROUTE = '/api/dsh-wrenchbench'
const DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_PDF_BYTES = 64 * 1024 * 1024
const DEFAULT_MM_PER_UNIT = 0.0254

const TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'Human-readable answer from the board library' },
    isError: { type: 'boolean', description: 'Whether the request could not be answered' },
  },
  required: ['text'],
}

function renderToolOutput(_args, value) {
  if (value && typeof value === 'object' && typeof value.text === 'string') {
    return [{ type: 'text', text: value.text }]
  }
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendText(res, status, type, value) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'content-length': Buffer.byteLength(value) })
  res.end(value)
}

function fail(res, status, message, extra = {}) {
  sendJson(res, status, { error: message, ...extra })
}

/** Read a request body with an explicit ceiling, streamed rather than buffered blind. */
function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number.parseInt(String(req.headers['content-length'] ?? ''), 10)
    if (Number.isFinite(declared) && declared > limitBytes) {
      reject(Object.assign(new Error(`the upload is larger than the ${Math.round(limitBytes / 1024 / 1024)} MB ceiling`), { statusCode: 413 }))
      return
    }

    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > limitBytes) {
        reject(Object.assign(new Error(`the upload is larger than the ${Math.round(limitBytes / 1024 / 1024)} MB ceiling`), { statusCode: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJsonBody(req, limitBytes) {
  const bytes = await readBody(req, limitBytes)
  if (bytes.length === 0) return {}
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('the request body is not valid JSON')
  }
}

// ---------------------------------------------------------------------------
// Board resolution shared by the routes and the tools
// ---------------------------------------------------------------------------

/**
 * Resolve the board a request is talking about.
 *
 * Precedence: an explicit id or name, then the canvas focus the agent last
 * set, then the most recently used entry in the library. Anything else is an
 * explicit failure listing what does exist, never a guess.
 */
function resolveBoard(reference) {
  const boards = store.listBoards()
  if (boards.length === 0) {
    return { error: 'the board library is empty: import a boardview first' }
  }

  if (reference && String(reference).trim().length > 0) {
    const needle = String(reference).trim()
    const byId = boards.find((board) => board.id === needle)
    if (byId) return { meta: byId }
    const byName = boards.find((board) => board.name.toLowerCase() === needle.toLowerCase())
    if (byName) return { meta: byName }
    const loose = boards.find(
      (board) =>
        board.name.toLowerCase().includes(needle.toLowerCase()) ||
        String(board.sourceName).toLowerCase().includes(needle.toLowerCase()),
    )
    if (loose) return { meta: loose }
    return {
      error: `no board matches "${needle}"`,
      available: boards.map((board) => board.name),
    }
  }

  const focus = store.readFocus()
  if (focus?.boardId) {
    const focused = boards.find((board) => board.id === focus.boardId)
    if (focused) return { meta: focused }
  }

  return { meta: boards[0] }
}

function loadBoard(reference) {
  const resolved = resolveBoard(reference)
  if (resolved.error) return { error: resolved.error, available: resolved.available }
  const loaded = store.readBoard(resolved.meta.id)
  if (!loaded) return { error: `the record for "${resolved.meta.name}" could not be read` }
  return loaded
}

/** Levenshtein distance, bounded by `max`, used for closest-match suggestions. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const previous = new Array(b.length + 1)
  const current = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j += 1) previous[j] = j
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    let best = current[0]
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      if (current[j] < best) best = current[j]
    }
    if (best > max) return max + 1
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j]
  }
  return previous[b.length]
}

function closestMatches(needle, candidates, limit = 6) {
  const upper = needle.toUpperCase()
  const scored = []
  for (const candidate of candidates) {
    const candidateUpper = candidate.toUpperCase()
    if (candidateUpper === upper) continue
    // A shared prefix is the strongest signal ("U70" -> "U7000").
    const prefix = candidateUpper.startsWith(upper) || upper.startsWith(candidateUpper)
    const edit = distance(upper, candidateUpper, 3)
    const score = prefix ? 0 : edit
    if (prefix || edit <= 3) scored.push({ candidate, score })
  }
  scored.sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
  return scored.slice(0, limit).map((entry) => entry.candidate)
}

function partByRefdes(board, needle) {
  const upper = String(needle).trim().toUpperCase()
  if (!upper) return undefined
  return board.parts.find((part) => part.refdes.toUpperCase() === upper)
}

function pinsOfPart(board, part) {
  return board.pins.filter((pin) => pin.part === board.parts.indexOf(part))
}

function mmPerUnit(config, board) {
  if (board.units === 'mm') return 1
  const configured = Number(config?.mmPerUnit)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MM_PER_UNIT
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1') : '—'
}

function boardSummaryLine(meta, board) {
  const stats = board.stats ?? {}
  const components = Number.isFinite(stats.components) ? stats.components : stats.parts
  const padEntries = Number.isFinite(stats.padEntries) ? stats.padEntries : 0
  const unnamed = Number.isFinite(stats.unnamedParts) ? stats.unnamedParts : 0
  const extras = [
    padEntries > 0 ? `${padEntries} pad/test-point entries` : null,
    unnamed > 0 ? `${unnamed} without a boardview label` : null,
  ].filter(Boolean)
  return `${meta.name} — ${components} components, ${stats.pins} pads, ${stats.nets} nets (${meta.format})${
    extras.length ? ` · ${extras.join(' · ')}` : ''
  }`
}

/**
 * What the bench has learned about rails on every board it has seen.
 *
 * Module-level because enrichment (and therefore naming) runs outside the
 * plugin's activation scope, and the library is a property of the bench, not of
 * one route.
 */
const railLibrary = createRailLibrary(store.dataRoot)

/** Cache of schematic-derived rail aliases, keyed by what they were built from. */
const aliasCache = new Map()

/**
 * Rail aliases derived from the schematic, cached per board revision.
 *
 * This only produces anything when the boardview's refdes match the
 * schematic's: a vendor export that renumbers its parts cannot be joined to a
 * schematic at all, and the honest result there is no alias, not a guess.
 */
function railAliasesFor(id, board, schematic) {
  if (!schematic) return undefined
  const key = `${id}:${schematic.uploadedAt ?? ''}:${board.stats?.pads ?? ''}`
  if (aliasCache.has(key)) return aliasCache.get(key)
  let aliases
  try {
    aliases = deriveRailAliases(board, schematic)
  } catch {
    aliases = undefined
  }
  if (aliases && aliases.size === 0) aliases = undefined
  if (aliasCache.size > 12) aliasCache.clear()
  aliasCache.set(key, aliases)
  return aliases
}

/**
 * Apply the technician's own rail labels over whatever could be derived.
 *
 * A label typed at the bench is first-hand evidence, so it wins over an
 * inference from the schematic and over the bare net name.
 */
function applyRailLabels(rails, labels) {
  for (const rail of rails) {
    const owned = labels?.[rail.name]
    if (owned?.label) {
      rail.label = owned.label
      rail.labelSource = owned.source ?? 'bench'
      rail.labelConfidence = owned.confidence ?? (rail.labelSource === 'bench' ? 'confirmed' : null)
      rail.labelEvidence = owned.evidence ?? []
      // A stated voltage beats one decoded from the name, which beats nothing.
      const stated = typeof owned.voltage === 'number' ? owned.voltage : null
      const volts = stated ?? voltageOf(owned.label)
      if (volts !== null) rail.voltage = volts
    } else if (rail.alias) {
      rail.labelSource = 'schematic'
    } else {
      rail.labelSource = null
    }
  }
  return rails
}

/**
 * Resolve a name the technician might use to a part.
 *
 * Both names have to work everywhere: the boardview's own label (`N16136`) and
 * any alias the schematic or the bench supplied (`IC5006`). Marks, focus and
 * lookups all go through here so an alias cannot become a second, disconnected
 * namespace.
 *
 * @returns {{refdes: string, part: object, via: 'refdes'|'alias'}|null}
 */
function resolvePartName(board, aliases, needle) {
  const text = String(needle ?? '').trim()
  if (text.length === 0) return null
  const direct = partByRefdes(board, text)
  if (direct) return { refdes: direct.refdes, part: direct, via: 'refdes' }
  const wanted = text.toUpperCase()
  const hit = Object.entries(aliases ?? {}).find(
    ([, entry]) => entry?.alias && String(entry.alias).toUpperCase() === wanted,
  )
  if (!hit) return null
  const part = partByRefdes(board, hit[0])
  return part ? { refdes: hit[0], part, via: 'alias' } : null
}

/**
 * The enrichment every project gets, automatically.
 *
 * Run after an import and again whenever a schematic is attached, because that
 * is the moment new evidence arrives. It reclassifies pads versus components
 * and tries to name the parts the boardview could not label, using the
 * schematic when one is supplied. A name already confirmed at the bench is
 * never overwritten by an inference.
 */
function enrichBoard(id) {
  const loaded = store.readBoard(id)
  if (!loaded) return null
  const schematic = store.readSchematic(id)
  const roles = classifyParts(loaded.board.parts)
  const plan = planNaming(loaded.board, schematic)
  const existing = store.readAliases(id)
  const next = { ...existing }
  let proposed = 0
  let kept = 0

  for (const [partIndex, entry] of plan.assignments) {
    const part = loaded.board.parts[partIndex]
    if (!part) continue
    const key = part.refdes
    const prior = existing[key]
    if (prior && (prior.source === 'bench' || prior.confidence === 'confirmed')) {
      kept += 1
      continue
    }
    next[key] = {
      alias: entry.alias ?? null,
      source: entry.source,
      confidence: entry.confidence,
      evidence: entry.evidence ?? [],
      candidates: entry.candidates ?? [],
      at: new Date().toISOString(),
    }
    proposed += 1
  }

  store.writeAliases(id, next)
  const named = Object.values(next).filter((entry) => entry.alias).length
  const ambiguous = Object.values(next).filter((entry) => !entry.alias && (entry.candidates ?? []).length > 0).length
  const rails = schematic ? nameRailsFromSchematic(id, loaded.board, schematic) : null
  return {
    id,
    name: loaded.meta.name,
    roles,
    proposed,
    kept,
    named,
    ambiguous,
    unnamed: plan.unnamedCount,
    rails,
    schematic: schematic ? { name: schematic.name, pages: schematic.stats.pages } : null,
  }
}

/**
 * Name the board's opaque rails from the schematic, automatically.
 *
 * Called from the enrichment that runs after every import and after every
 * schematic upload, so a new project is labelled without anyone asking. A
 * schematic pins a supply once per pin (`VDDCR_GFX_A12`, …), which gives the
 * number of pins that supply reaches on one device; the boardview gives the
 * number of that device's pads on a net. Those are the same count, so a unique
 * pair forces the naming — see schematic-rails.js.
 *
 * A label the technician already typed is never touched. Anything the counts
 * cannot separate is written down as an open choice, not as a name.
 */
function nameRailsFromSchematic(id, board, schematic, boardName) {
  const labels = store.readRailLabels(id)
  let plan
  try {
    plan = planRailNames({ board, schematic, labels, library: railLibrary.all() })
  } catch (error) {
    return { applied: 0, kept: 0, ambiguous: 0, error: String(error?.message ?? error) }
  }

  let applied = 0
  let kept = 0
  for (const entry of labelEntriesFor(plan.applied)) {
    const prior = labels[entry.net]
    // A bench label is first-hand evidence and is never overwritten; the same
    // is true of a name the technician already confirmed from a suggestion.
    if (prior?.label && prior.source !== 'schematic') {
      kept += 1
      continue
    }
    store.setRailLabel(id, entry.net, entry.label, {
      source: entry.source,
      confidence: entry.confidence,
      evidence: entry.evidence,
      voltage: entry.voltage,
    })
    applied += 1
    // Every name the bench now knows goes into the cross-board library, which is
    // what makes the next board easier than this one.
    const signature = netSignature(board, entry.net)
    if (signature) {
      railLibrary.learn({
        name: entry.label,
        voltage: entry.voltage,
        signature,
        boardId: id,
        boardName,
        net: entry.net,
        source: entry.source,
      })
    }
  }

  const pinsOf = new Map((board.nets ?? []).map((net) => [net.name, net.pins.length]))
  const map = {
    at: new Date().toISOString(),
    schematic: schematic?.name ?? null,
    assignments: plan.applied.map((entry) => ({
      net: entry.net,
      rail: entry.rail,
      voltage: entry.voltage ?? null,
      confidence: entry.confidence,
      source: entry.source,
      evidence: entry.evidence ?? [],
      pins: pinsOf.get(entry.net) ?? 0,
    })),
    // Questions the bench can answer with one click: a name the schematic
    // proves but the counts could not, a shape another board recognises, or the
    // schematic's own rail vocabulary.
    suggestions: plan.suggestions,
    vocabulary: plan.vocabulary.slice(0, 12),
    unmatched: plan.unmatched,
    warnings: plan.notes,
  }
  store.writeRailMap(id, map)
  return {
    applied,
    kept,
    ambiguous: plan.suggestions.length,
    learned: railLibrary.all().length,
    error: plan.notes[0] ?? null,
  }
}

/** Human-readable enrichment report, shared by the route and the tool. */
function enrichmentReport(report) {
  if (!report) return 'that board is not in the library'
  const lines = [
    `Enrichment for "${report.name}":`,
    `  ${report.roles.components} components, ${report.roles.pads} pad/test-point entries, ${report.roles.unnamed} without a label from the boardview.`,
  ]
  if (!report.schematic) {
    lines.push(
      '  No schematic attached, so nothing could be named from one. Attach the schematic and enrichment runs again automatically.',
    )
  } else {
    lines.push(
      `  Against "${report.schematic.name}" (${report.schematic.pages} text pages): ${report.named} part(s) now named from the schematic, ${report.ambiguous} match more than one designator.`,
    )
    if (report.ambiguous > 0) {
      lines.push(
        '  Those are not guesses: ask the technician which one it is (ask_user_question with the candidates), then record it with wrenchbench_name_part.',
      )
    }
  }
  if (report.kept > 0) lines.push(`  ${report.kept} name(s) already confirmed at the bench were left alone.`)
  const rails = report.rails
  if (rails) {
    if (rails.error && rails.applied === 0) {
      lines.push(`  Rail names: nothing could be matched — ${rails.error}`)
    } else {
      lines.push(
        `  Rail names: ${rails.applied} net(s) named from the schematic by pin-count fingerprint${rails.kept > 0 ? `, ${rails.kept} kept as labelled at the bench` : ''}.`,
      )
      if (rails.ambiguous > 0) {
        lines.push(
          `  ${rails.ambiguous} rail(s) are an open choice between candidate names; ask which one it is, then record it with wrenchbench_label_rail.`,
        )
      }
    }
  } else if (report.schematic) {
    lines.push('  Rail names: the schematic carried no pin-positioned supply nets to fingerprint.')
  }
  return lines.join('\n')
}

/**
 * The measurement to ask for on one suspect.
 *
 * A technician cannot act on "check C1234". They can act on "diode mode across
 * C1234, red on the rail pad, and tell me the drop". This turns a ranked
 * suspect into one concrete probe in one mode with a pass/fail band, which is
 * also what makes the follow-up question answerable as multiple choice.
 */
function measurementHint(suspect, observations) {
  const kind = (observations ?? []).find(
    (item) => item.kind !== 'ok' && String(item.refdes ?? '').toUpperCase() === String(suspect.refdes).toUpperCase(),
  )?.kind
  // The net the component is actually blamed for, not just the first net it
  // touches: on a 290-pad package those are very different pads.
  const blamed = (suspect.bridges ?? []).find(Boolean)
  const rail =
    blamed ?? suspect.nets.find((name) => !/^(GND|GROUND|VSS|AGND|DGND|PGND)$/i.test(name)) ?? suspect.nets[0]
  const target = rail ? `${rail} to ground` : 'the suspect net'

  if (kind === 'open') {
    return `continuity / resistance across ${suspect.refdes} (${target}). A healthy two-terminal part reads under a few ohms; an open reads out of range.`
  }
  if (suspect.pins <= 3) {
    return `diode mode across ${suspect.refdes} (${target}), both polarities. Expect roughly 0.3–0.6 V one way and open the other; a short reads under 0.05 V both ways.`
  }
  return `resistance from ${suspect.refdes} (${target}), board unpowered. A rail-to-ground short reads under 2 Ω; above 20 Ω the part is probably not the fault. Do not lift it on this reading alone.`
}

// ---------------------------------------------------------------------------
// Agent tools
// ---------------------------------------------------------------------------

function buildTools(ctx, config) {
  const maxFileBytes = Number(config?.maxFileBytes) > 0 ? Number(config.maxFileBytes) : DEFAULT_MAX_FILE_BYTES
  const maxPdfBytes = Number(config?.maxPdfBytes) > 0 ? Number(config.maxPdfBytes) : DEFAULT_MAX_PDF_BYTES

  const tools = []

  tools.push({
    name: 'wrenchbench_boards',
    description:
      'List the WrenchBench board library: every boardview imported or previously viewed, with component/pad/net counts, the source format, and whether a schematic PDF is attached. Use it when the technician names a board, or to check what is already on the bench.',
    parameters: { type: 'object', properties: {}, required: [] },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolOutput },
    execute: () => {
      const boards = store.listBoards()
      if (boards.length === 0) {
        return { text: 'The board library is empty. Import a boardview in the WrenchBench panel or with wrenchbench_import.' }
      }
      const focus = store.readFocus()
      const lines = boards.map((board) => {
        const marks = []
        if (board.id === focus?.boardId) marks.push('ON THE CANVAS')
        if (board.schematic) marks.push(`schematic: ${board.schematic.stats.pages}p`)
        const stats = board.stats ?? {}
        const parts = stats.components ?? stats.parts ?? 0
        const padEntries = stats.padEntries ?? 0
        const unnamed = stats.unnamedParts ?? 0
        const detail = [
          `${parts} comp`,
          padEntries > 0 ? `${padEntries} pad entries` : null,
          unnamed > 0 ? `${unnamed} unnamed` : null,
          `${stats.pins ?? 0} pads`,
          `${stats.nets ?? 0} nets`,
        ]
          .filter(Boolean)
          .join(' / ')
        return `- ${board.name} [${board.id}] ${detail}, ${board.format}${marks.length ? ` · ${marks.join(' · ')}` : ''}`
      })
      return { text: `Board library (${boards.length}):\n${lines.join('\n')}` }
    },
  })

  tools.push({
    name: 'wrenchbench_board',
    description:
      'Summarize one board from the library: formats, layer coverage, bounds, the largest nets, the power rails, the biggest components, and whether a schematic is attached. Omit `board` to use the board currently on the canvas.',
    parameters: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board id or name. Defaults to the board on the canvas.' },
      },
      required: [],
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolOutput },
    execute: (args) => {
      const loaded = loadBoard(args?.board)
      if (loaded.error) return { text: loaded.error, isError: true }
      const { meta, board } = loaded
      const railGroups = classifyRails(board)
      const railLabels = store.readRailLabels(meta.id)
      applyRailLabels(railGroups.rails, railLabels)
      ensureLabelledRails(board, railGroups.rails, railLabels)
      const grounds = board.nets.filter((net) => net.ground).slice(0, 6)
      const largest = [...board.parts].sort((a, b) => b.pins - a.pins).slice(0, 12)
      const schematic = store.readSchematic(meta.id)

      const lines = [
        boardSummaryLine(meta, board),
        `units: ${board.units}${board.units === 'mm' ? '' : ` (1 unit ≈ ${formatNumber(mmPerUnit(config, board), 4)} mm)`}`,
        `layers: ${board.stats.layers === 2 ? 'top and bottom' : 'top only'} · probe points: ${board.stats.probes}`,
        `bounds: x ${formatNumber(board.bounds.minX)}…${formatNumber(board.bounds.maxX)}, y ${formatNumber(board.bounds.minY)}…${formatNumber(board.bounds.maxY)}`,
        '',
        `Rail groups (${railGroups.rails.length}, ≥${railGroups.threshold} pads or a named voltage):`,
        ...railGroups.rails.map((rail) => {
          const volts = formatVoltage(rail.voltage)
          const named = rail.label && rail.label !== rail.name ? rail.label : null
          // "1.35 V (VMEMIO)" is how the bench talks about a rail; the raw net
          // name stays in brackets so the record and the boardview still agree.
          const head = volts
            ? `${volts}${named ? ` (${named})` : ''}`
            : named
              ? `${named} (voltage not printed)`
              : rail.name
          return `  ${head} — ${rail.name}, ${rail.pads} pads (${rail.reach}% of the board)`
        }),
        railGroups.rails.length > 0 && Object.keys(railLabels).length === 0
          ? 'None of these rails is labelled. The schematic names its own rails (VDDCR_SOC, PP1V8_S0, +3V3…); find one with wrenchbench_schematic, ask the technician which net it lands on, and record it with wrenchbench_label_rail. The legend, the canvas colouring and the per-component rail assignment all follow the label.'
          : '',
        grounds.length ? `Ground planes: ${grounds.map((net) => `${net.name} (${net.pins.length})`).join(', ')}` : '',
        '',
        'Largest components:',
        ...largest.map((part) => `  ${part.refdes} — ${part.pins} pads, ${part.layer}${part.smd ? ', smd' : ''}`),
        '',
        schematic
          ? `Schematic attached: ${schematic.name}, ${schematic.stats.pages} pages, ${schematic.stats.chars} characters of text layer.`
          : 'No schematic PDF attached to this board.',
        meta.warnings?.length ? `\nParse warnings: ${meta.warnings.join('; ')}` : '',
      ].filter((line) => line !== '')

      return { text: lines.join('\n') }
    },
  })

  tools.push({
    name: 'wrenchbench_component',
    description:
      'Look up one component on the board by refdes: its layer, package style, pad count, every pad with the net it sits on, the nets it bridges, and the nearest neighbouring components. Returns found:false with closest matches when the refdes does not exist — never invent one.',
    parameters: {
      type: 'object',
      properties: {
        refdes: { type: 'string', description: 'Reference designator, e.g. U7, C29, J3100' },
        board: { type: 'string', description: 'Board id or name. Defaults to the board on the canvas.' },
      },
      required: ['refdes'],
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolOutput },
    execute: (args) => {
      const loaded = loadBoard(args?.board)
      if (loaded.error) return { text: loaded.error, isError: true }
      const { board, meta } = loaded
      const aliases = store.readAliases(meta.id)
      const needle = String(args?.refdes ?? '').trim()

      // Accept a name the schematic supplied as well as the boardview's own
      // label, so the technician can use whichever they are looking at.
      let part = partByRefdes(board, needle)
      let matchedViaAlias = null
      if (!part) {
        const wanted = needle.toUpperCase()
        const hit = Object.entries(aliases).find(
          ([, entry]) => entry?.alias && String(entry.alias).toUpperCase() === wanted,
        )
        if (hit) {
          part = partByRefdes(board, hit[0])
          if (part) matchedViaAlias = hit[0]
        }
      }

      if (!part) {
        const named = Object.entries(aliases).map(([refdes, entry]) => ({ refdes, entry }))
        const matches = closestMatches(needle, board.parts.map((entry) => entry.refdes))
        const aliasMatches = named
          .filter(({ entry }) => entry?.alias && String(entry.alias).toUpperCase().includes(needle.toUpperCase()))
          .slice(0, 5)
          .map(({ entry }) => entry.alias)
        const suggestions = [...new Set([...aliasMatches, ...matches])]
        return {
          text: `found: false. No component "${needle}" on this board.${
            suggestions.length
              ? ` Closest matches: ${suggestions.join(', ')}. Pick one of these or ask which board the technician means.`
              : ''
          }`,
          isError: true,
        }
      }

      const partIndex = board.parts.indexOf(part)
      const pins = board.pins.filter((pin) => pin.part === partIndex)
      const nets = new Map()
      for (const pin of pins) {
        if (!pin.net) continue
        const bucket = nets.get(pin.net) ?? []
        bucket.push(pin.index)
        nets.set(pin.net, bucket)
      }

      const centre = {
        x: (part.bbox.x1 + part.bbox.x2) / 2,
        y: (part.bbox.y1 + part.bbox.y2) / 2,
      }
      const neighbours = board.parts
        .filter((other) => other !== part && (other.pins > 0 || other.bbox.x1 !== 0))
        .map((other) => {
          const dx = (other.bbox.x1 + other.bbox.x2) / 2 - centre.x
          const dy = (other.bbox.y1 + other.bbox.y2) / 2 - centre.y
          const alias = aliases[other.refdes]?.alias
          return { refdes: other.refdes, label: alias ?? other.refdes, d: Math.hypot(dx, dy) }
        })
        .sort((a, b) => a.d - b.d)
        .slice(0, 6)

      const aliasEntry = aliases[part.refdes]
      const heading = aliasEntry?.alias
        ? `${aliasEntry.alias} — boardview label ${part.refdes}${
            matchedViaAlias ? ` (matched by name)` : ''
          } (${aliasEntry.source}, ${aliasEntry.confidence})`
        : `${part.refdes}${isPlaceholderRefdes(part.refdes) ? ' — unnamed in the boardview' : ''}${
            aliasEntry?.candidates?.length ? ` (${aliasEntry.candidates.length} schematic candidates)` : ''
          }`

      const scale = mmPerUnit(config, board)
      const lines = [
        heading,
        `  ${pins.length} pads, ${part.layer} layer, ${part.smd ? 'SMD' : 'through-hole'}${part.value ? `, marking ${part.value}` : ''}`,
        `position: x ${formatNumber(centre.x)} y ${formatNumber(centre.y)} (${board.units === 'mm' ? 'mm' : 'board units'})`,
        `nets (${nets.size}):`,
        ...[...nets.entries()].map(
          ([net, indices]) => `  ${net} — pads ${indices.join(', ')}${/^(GND|VSS|AGND|DGND|PGND|GROUND)$/i.test(net) ? ' [ground]' : ''}`,
        ),
        '',
        `pads: ${pins.map((pin) => `${pin.index}${pin.net ? `=${pin.net}` : ''}`).join(', ')}`,
        '',
        `nearest components (mm): ${neighbours.map((other) => `${other.label} ${formatNumber(other.d * scale, 1)}`).join(', ')}`,
      ]
      if (aliasEntry?.candidates?.length && !aliasEntry.alias) {
        lines.push(
          '',
          `This part is unnamed and the schematic matches more than one designator: ${aliasEntry.candidates
            .map((candidate) => `${candidate.refdes}${candidate.votes ? ` (${candidate.votes})` : ''}`)
            .join(', ')}.`,
          'Ask the technician which one it is, then record it with wrenchbench_name_part.',
        )
      }

      return { text: lines.join('\n') }
    },
  })

  tools.push({
    name: 'wrenchbench_net',
    description:
      'Every pad on one net: which components it touches, how many pads, and whether it is a power rail or a ground plane. Use it to trace a rail across the board before picking a probe point.',
    parameters: {
      type: 'object',
      properties: {
        net: { type: 'string', description: 'Exact net name, e.g. +3V3, PP5V7_LCM, GND' },
        board: { type: 'string', description: 'Board id or name. Defaults to the board on the canvas.' },
        limit: { type: 'integer', description: 'Maximum pads to list (default 60).' },
      },
      required: ['net'],
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolOutput },
    execute: (args) => {
      const loaded = loadBoard(args?.board)
      if (loaded.error) return { text: loaded.error, isError: true }
      const { board } = loaded
      const needle = String(args?.net ?? '').trim()
      const upper = needle.toUpperCase()
      const net =
        board.nets.find((entry) => entry.name.toUpperCase() === upper) ??
        board.nets.find((entry) => entry.name.toUpperCase().includes(upper) && upper.length >= 3)

      if (!net) {
        const matches = closestMatches(needle, board.nets.map((entry) => entry.name))
        return {
          text: `found: false. No net "${needle}" on this board.${
            matches.length ? ` Closest matches: ${matches.join(', ')}.` : ''
          }`,
          isError: true,
        }
      }

      const limit = Math.min(Math.max(Number(args?.limit) || 60, 1), 400)
      const touches = new Map()
      for (const pinIndex of net.pins) {
        const pin = board.pins[pinIndex]
        const part = board.parts[pin.part]
        if (!part) continue
        const bucket = touches.get(part.refdes) ?? []
        bucket.push(pin.index)
        touches.set(part.refdes, bucket)
      }

      const entries = [...touches.entries()]
      const lines = [
        `${net.name} — ${net.pins.length} pads across ${entries.length} components${net.power ? ' [power rail]' : ''}${net.ground ? ' [ground]' : ''}`,
        '',
        ...entries.slice(0, limit).map(([refdes, indices]) => `  ${refdes} — pads ${indices.join(', ')}`),
        entries.length > limit ? `  … ${entries.length - limit} more components` : '',
      ].filter((line) => line !== '')

      return { text: lines.join('\n') }
    },
  })

  tools.push({
    name: 'wrenchbench_search',
    description:
      'Search the loaded board for refdes and net names matching a substring. Use it when the technician describes something loosely ("the backlight coil", "the 3V3 rail") and you need the real names before quoting any.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring to match against refdes and net names' },
        board: { type: 'string', description: 'Board id or name. Defaults to the board on the canvas.' },
        limit: { type: 'integer', description: 'Maximum hits per category (default 20).' },
      },
      required: ['query'],
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolOutput },
    execute: (args) => {
      const loaded = loadBoard(args?.board)
      if (loaded.error) return { text: loaded.error, isError: true }
      const { board, meta } = loaded
      const aliases = store.readAliases(meta.id)
      const needle = String(args?.query ?? '').trim().toLowerCase()
      if (needle.length === 0) return { text: 'Provide a query to search for.', isError: true }
      const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 200)

      // A part matches on either name: the boardview's label or the alias the
      // schematic supplied, so the technician can search for whichever they know.
      const labelOf = (part) => aliases[part.refdes]?.alias ?? part.refdes
      const parts = board.parts
        .filter(
          (part) =>
            part.refdes.toLowerCase().includes(needle) ||
            String(labelOf(part)).toLowerCase().includes(needle) ||
            String(part.value ?? '').toLowerCase().includes(needle),
        )
        .slice(0, limit)
      const nets = board.nets.filter((net) => net.name.toLowerCase().includes(needle)).slice(0, limit)

      const lines = []
      lines.push(`Components matching "${args?.query}" (${parts.length}):`)
      lines.push(
        ...(parts.length
          ? parts.map((part) => {
              const label = labelOf(part)
              const shown = label !== part.refdes ? `${label} [${part.refdes}]` : part.refdes
              return `  ${shown} — ${part.pins} pads, ${part.layer}${part.value ? `, marking ${part.value}` : ''}`
            })
          : ['  none']),
      )
      lines.push('')
      lines.push(`Nets matching "${args?.query}" (${nets.length}):`)
      lines.push(
        ...(nets.length
          ? nets.map((net) => `  ${net.name} — ${net.pins.length} pads${net.power ? ' [power]' : ''}${net.ground ? ' [ground]' : ''}`)
          : ['  none']),
      )
      return { text: lines.join('\n') }
    },
  })

  tools.push({
    name: 'wrenchbench_find',
    description:
      'Resolve a plain-language description of a part or a rail to real candidates on this board. Use this whenever the technician describes something instead of naming it — "the big chip near the CPU", "the coil by the VRM", "the 3V3 rail", "the HDMI transmitter", "shorted cap" — and before naming any component yourself. Returns ranked candidates, each with the reason it matched, plus a warning when nothing matches. It never invents a part: confirm with the technician, then point at it with wrenchbench_focus.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'The description in the technician\'s own words, e.g. "the big chip near U12", "3V3 supply", "coils", "the HDMI chip"',
        },
        limit: { type: 'integer', description: 'Candidates per kind (default 6, max 20)' },
        board: { type: 'string', description: 'Board id or name. Defaults to the board on the canvas.' },
      },
      required: ['query'],
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolOutput },
    execute: (args) => {
      const loaded = loadBoard(args?.board)
      if (loaded.error) return { text: loaded.error, isError: true }
      const { board, meta } = loaded
      const query = String(args?.query ?? '').trim()
      if (query.length === 0) return { text: 'Provide the description to resolve.', isError: true }

      const resolved = resolveQuery(board, {
        query,
        aliases: store.readAliases(meta.id),
        railLabels: store.readRailLabels(meta.id),
        limit: args?.limit,
      })

      const interpreted = resolved.interpreted ?? {}
      const hints = [
        interpreted.families?.length ? `families=${interpreted.families.join('/')}` : null,
        interpreted.near ? `near=${interpreted.near}` : null,
        interpreted.wantsBig ? 'wants=large' : null,
        interpreted.wantsSmall ? 'wants=small' : null,
        interpreted.wantsSupply ? 'wants=supply' : null,
        interpreted.wantsGround ? 'wants=ground' : null,
      ].filter(Boolean)

      const lines = [`Matches for "${query}" on "${meta.name}"${hints.length ? ` (${hints.join(', ')})` : ''}:`]

      if (resolved.parts.length > 0) {
        lines.push('', `Components (${resolved.parts.length}):`)
        resolved.parts.forEach((part, index) => {
          const name = part.label !== part.refdes ? `${part.label} [${part.refdes}]` : part.refdes
          lines.push(
            `${index + 1}. ${name} — ${part.pins} pads${part.value ? `, marking ${part.value}` : ''}, ${part.layer}`,
          )
          lines.push(`   because: ${part.reasons.join('; ')}`)
        })
      }

      if (resolved.nets.length > 0) {
        lines.push('', `Nets (${resolved.nets.length}):`)
        resolved.nets.forEach((net, index) => {
          const name = net.label !== net.name ? `${net.label} [${net.name}]` : net.name
          lines.push(`${index + 1}. ${name} — ${net.pins} pads, ${net.kind}`)
          lines.push(`   because: ${net.reasons.join('; ')}`)
        })
      }

      for (const note of resolved.notes) lines.push('', `note: ${note}`)

      if (resolved.parts.length > 0 || resolved.nets.length > 0) {
        lines.push(
          '',
          'Confirm the choice with the technician (ask_user_question with the top candidates as options), then:',
          '  - point at it with wrenchbench_focus so the panel highlights it;',
          '  - record any measurement with wrenchbench_mark;',
          '  - for a rail, call wrenchbench_name_part on components or wrenchbench_checks for next probes.',
        )
      }

      return { text: lines.join('\n') }
    },
  })

  tools.push({
    name: 'wrenchbench_measure',
    description:
      'Physical distance between two components on the board, in millimetres (and board units). Useful when deciding whether a probe can reach a pad without moving the board.',
    parameters: {
      type: 'object',
      properties: {
        refdes_a: { type: 'string', description: 'First refdes' },
        refdes_b: { type: 'string', description: 'Second refdes' },
        board: { type: 'string', description: 'Board id or name. Defaults to the board on the canvas.' },
      },
      required: ['refdes_a', 'refdes_b'],
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolOutput },
    execute: (args) => {
      const loaded = loadBoard(args?.board)
      if (loaded.error) return { text: loaded.error, isError: true }
      const { board } = loaded
      const a = partByRefdes(board, args?.refdes_a)
      const b = partByRefdes(board, args?.refdes_b)
      if (!a || !b) {
        const missing = !a ? args?.refdes_a : args?.refdes_b
        const matches = closestMatches(String(missing ?? ''), board.parts.map((part) => part.refdes))
        return {
          text: `found: false. No component "${missing}" on this board.${matches.length ? ` Closest matches: ${matches.join(', ')}.` : ''}`,
          isError: true,
        }
      }
      const dx = (a.bbox.x1 + a.bbox.x2) / 2 - (b.bbox.x1 + b.bbox.x2) / 2
      const dy = (a.bbox.y1 + a.bbox.y2) / 2 - (b.bbox.y1 + b.bbox.y2) / 2
      const raw = Math.hypot(dx, dy)
      const scale = mmPerUnit(config, board)
      return {
        text: `${a.refdes} ↔ ${b.refdes}: ${formatNumber(raw * scale, 2)} mm (${formatNumber(raw, 1)} board units, Δx ${formatNumber(dx)}, Δy ${formatNumber(dy)}).${
          board.units === 'mm' ? '' : ' Millimetres assume 1 unit = ' + formatNumber(scale, 4) + ' mm.'
        }`,
      }
    },
  })

  tools.push({
    name: 'wrenchbench_schematic',
    description:
      'Query the schematic PDF attached to a board. Without `query` it lists the attached schematic and the refdes/rail tokens it mentions. With `query` it returns matching pages with quoted context. Use it to cite a page instead of describing the schematic from memory.',
    parameters: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board id or name. Defaults to the board on the canvas.' },
        query: { type: 'string', description: 'Text, refdes or rail to search for in the schematic text layer' },
        pages: { type: 'integer', description: 'How many of the best pages to list for a refdes/rail (default 5).' },
        limit: { type: 'integer', description: 'Maximum snippet hits (default 8).' },
      },
      required: [],
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolOutput },
    execute: (args) => {
      const loaded = loadBoard(args?.board)
      if (loaded.error) return { text: loaded.error, isError: true }
      const { meta } = loaded
      const schematic = store.readSchematic(meta.id)
      if (!schematic) {
        return {
          text: `No schematic PDF is attached to "${meta.name}". Attach one in the WrenchBench panel (Schematic tab) and this tool can cite pages.`,
          isError: true,
        }
      }

      const query = String(args?.query ?? '').trim()
      if (query.length === 0) {
        const topRefdes = (schematic.tokens?.refdes ?? []).slice(0, 24)
        const topNets = (schematic.tokens?.nets ?? []).slice(0, 24)
        return {
          text: [
            `Schematic for "${meta.name}": ${schematic.name}`,
            `${schematic.stats.pages} pages, ${schematic.stats.chars} characters of text layer (page numbers are content-stream order).`,
            schematic.warnings?.length ? `Warnings: ${schematic.warnings.join('; ')}` : '',
            topRefdes.length ? `Refdes seen: ${topRefdes.map((token) => token.name).join(', ')}` : '',
            topNets.length ? `Rails/nets seen: ${topNets.map((token) => token.name).join(', ')}` : '',
            'Pass `query` to get matching pages with quoted context.',
          ]
            .filter((line) => line !== '')
            .join('\n'),
        }
      }

      const hits = searchSchematic(schematic, query, Math.min(Math.max(Number(args?.limit) || 8, 1), 30))
      const pages = pagesForToken(schematic, query, Math.min(Math.max(Number(args?.pages) || 5, 1), 20))
      if (hits.length === 0) {
        return { text: `found: false. "${query}" does not appear in the schematic text layer.` , isError: true }
      }
      const lines = [`"${query}" in ${schematic.name}:`]
      if (pages.length) lines.push(`pages by density: ${pages.map((entry) => `p${entry.page} (${entry.count}×)`).join(', ')}`)
      lines.push('')
      lines.push(...hits.map((hit) => `p${hit.page}: …${hit.snippet}…`))
      return { text: lines.join('\n') }
    },
  })

  tools.push({
    name: 'wrenchbench_focus',
    description:
      'Point the technician at something on the canvas: highlight a component, light every pad on a net, or target one pad. The WrenchBench panel reflects the change within a couple of seconds, so the technician sees what you are describing.',
    parameters: {
      type: 'object',
      properties: {
        refdes: { type: 'string', description: 'Component to highlight and focus' },
        net: { type: 'string', description: 'Net whose pads should all light up' },
        pin: { type: 'integer', description: 'Pin number of `refdes` to target precisely' },
        annotation: { type: 'string', description: 'Short label to show next to the focused component' },
        clear: { type: 'boolean', description: 'Clear the previous focus before applying this one' },
        board: { type: 'string', description: 'Board id or name. Defaults to the board on the canvas.' },
      },
      required: [],
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolOutput },
    execute: (args) => {
      const loaded = loadBoard(args?.board)
      if (loaded.error) return { text: loaded.error, isError: true }
      const { meta, board } = loaded

      if (args?.clear) {
        store.writeFocus({ boardId: meta.id, refdes: null, net: null, pin: null, annotation: null })
        return { text: `Cleared the canvas focus on "${meta.name}".` }
      }

      const errors = []
      const aliases = store.readAliases(meta.id)
      let focusRefdes = args?.refdes ? String(args.refdes).trim() : null
      if (focusRefdes) {
        const resolved = resolvePartName(board, aliases, focusRefdes)
        if (!resolved) {
          const matches = closestMatches(focusRefdes, board.parts.map((entry) => entry.refdes))
          const aliasMatches = Object.values(aliases)
            .map((entry) => entry?.alias)
            .filter((alias) => alias && String(alias).toUpperCase().includes(focusRefdes.toUpperCase()))
            .slice(0, 5)
          const suggestions = [...new Set([...aliasMatches, ...matches])]
          errors.push(`No component "${focusRefdes}".${suggestions.length ? ` Closest matches: ${suggestions.join(', ')}.` : ''}`)
        } else {
          focusRefdes = resolved.refdes
        }
      }
      if (args?.net && !board.nets.some((net) => net.name.toUpperCase() === String(args.net).toUpperCase())) {
        const matches = closestMatches(String(args.net), board.nets.map((net) => net.name))
        errors.push(`No net "${args.net}".${matches.length ? ` Closest matches: ${matches.join(', ')}.` : ''}`)
      }
      if (errors.length > 0) return { text: errors.join(' '), isError: true }

      const focus = store.writeFocus({
        boardId: meta.id,
        refdes: focusRefdes ? focusRefdes.toUpperCase() : null,
        net: args?.net ? String(args.net) : null,
        pin: Number.isFinite(Number(args?.pin)) ? Number(args.pin) : null,
        annotation: args?.annotation ? String(args.annotation) : null,
      })

      const described = [focus.refdes, focus.net ? `net ${focus.net}` : null, focus.pin ? `pin ${focus.pin}` : null]
        .filter(Boolean)
        .join(', ')
      return {
        text: `Canvas focus on "${meta.name}" set to ${described || 'nothing'}.${focus.annotation ? ` Annotation: ${focus.annotation}.` : ''} The panel shows it within a couple of seconds.`,
      }
    },
  })

  tools.push({
    name: 'wrenchbench_import',
    description:
      'Import a boardview file that already exists on this machine into the board library. Supported extensions: .brd .brd2 .fz .tvw .cad .pcb .bdv .asc .bv .bvr .gr .cst .f2b .kicad_pcb. Use it when the technician points at a file path instead of dropping one into the panel.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the boardview file' },
        name: { type: 'string', description: 'Display name for the board. Defaults to the filename.' },
      },
      required: ['path'],
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolOutput },
    execute: (args) => {
      const target = String(args?.path ?? '').trim()
      if (target.length === 0) return { text: 'Provide the path of a boardview file.', isError: true }
      try {
        const stat = fs.statSync(target)
        if (!stat.isFile()) return { text: `${target} is not a file.`, isError: true }
        if (stat.size > maxFileBytes) {
          return { text: `${path.basename(target)} is ${Math.round(stat.size / 1024 / 1024)} MB, over the ${Math.round(maxFileBytes / 1024 / 1024)} MB ceiling.`, isError: true }
        }
        const bytes = fs.readFileSync(target)
        const parsed = parseBoard(bytes, path.basename(target))
        const id = store.boardIdFor(bytes, path.basename(target))
        const meta = store.saveBoard({
          id,
          name: args?.name ? String(args.name) : path.basename(target).replace(/\.[^.]+$/, ''),
          sourceName: path.basename(target),
          format: parsed.format,
          units: parsed.units,
          board: parsed,
          warnings: parsed.warnings,
        })
        return {
          text: `Imported "${meta.name}" [${meta.id}] from ${target}: ${parsed.stats.parts} components, ${parsed.stats.pins} pads, ${parsed.stats.nets} nets.`,
        }
      } catch (error) {
        const message = error instanceof BoardParseError ? `${error.message}${error.hint ? ` (${error.hint})` : ''}` : error instanceof Error ? error.message : String(error)
        return { text: `Import failed: ${message}`, isError: true }
      }
    },
  })

  tools.push({
    name: 'wrenchbench_mark',
    description:
      'Record what the technician reports on the bench: a component or pad is SHORTED, SHORTED TO GROUND, OPEN, or measured OK. Pass `clear` to wipe this board\'s marks. Marking is what makes wrenchbench_checks precise, so call it as soon as the technician says a part is bad — do not keep it in your head.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['short', 'short-to-ground', 'open', 'ok'],
          description:
            'short = shorted between its nets; short-to-ground = shorted to ground; open = no continuity; ok = measured good (removes it from the suspect list).',
        },
        refdes: { type: 'string', description: 'Component the technician is pointing at, e.g. C29' },
        pin: { type: 'integer', description: 'Specific pad number when the technician probed one pad' },
        net: { type: 'string', description: 'Net that is shorted, when the technician names a rail instead of a part' },
        note: { type: 'string', description: 'Short free-text note, e.g. "0.4 Ω to GND"' },
        clear: { type: 'boolean', description: 'Remove every mark on this board before anything else' },
        board: { type: 'string', description: 'Board id or name. Defaults to the board on the canvas.' },
      },
      required: [],
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolOutput },
    execute: (args) => {
      const loaded = loadBoard(args?.board)
      if (loaded.error) return { text: loaded.error, isError: true }
      const { meta, board } = loaded

      if (args?.clear) {
        store.clearObservations(meta.id)
        return { text: `Cleared every mark on "${meta.name}".` }
      }

      const kind = String(args?.kind ?? '').trim()
      if (kind.length === 0) {
        return { text: 'Provide a kind: short, short-to-ground, open or ok.', isError: true }
      }
      // The technician may say either name; a mark is stored against the
      // boardview label so it stays attached if an alias is renamed later.
      let markedRefdes = args?.refdes ? String(args.refdes).trim() : null
      if (markedRefdes) {
        const aliases = store.readAliases(meta.id)
        const resolved = resolvePartName(board, aliases, markedRefdes)
        if (!resolved) {
          const matches = closestMatches(markedRefdes, board.parts.map((entry) => entry.refdes))
          const aliasMatches = Object.values(aliases)
            .map((entry) => entry?.alias)
            .filter((alias) => alias && String(alias).toUpperCase().includes(markedRefdes.toUpperCase()))
            .slice(0, 5)
          const suggestions = [...new Set([...aliasMatches, ...matches])]
          return {
            text: `found: false. No component "${markedRefdes}" on this board.${
              suggestions.length ? ` Closest matches: ${suggestions.join(', ')}.` : ''
            }`,
            isError: true,
          }
        }
        markedRefdes = resolved.refdes
      }

      try {
        const items = store.addObservation(meta.id, {
          kind,
          refdes: markedRefdes ?? undefined,
          pin: args?.pin,
          net: args?.net,
          note: args?.note,
        })
        const target = args?.refdes ? String(args.refdes).toUpperCase() : String(args?.net ?? '')
        const marks = items.map((item) => `${item.kind} ${item.refdes ?? ''}${item.pin ? ` pin ${item.pin}` : ''}${item.net ? ` net ${item.net}` : ''}`.trim())
        return {
          text: [
            `Marked ${kind} on ${target}. ${items.length} mark(s) on "${meta.name}":`,
            ...marks.map((mark) => `  - ${mark}`),
            '',
            'Call wrenchbench_checks now to get the ranked suspects, then offer the top few as options with ask_user_question.',
          ].join('\n'),
        }
      } catch (error) {
        return { text: error instanceof Error ? error.message : String(error), isError: true }
      }
    },
  })

  tools.push({
    name: 'wrenchbench_label_rail',
    description:
      'Give one of a board\'s nets its real rail name, e.g. set net "Net72" to "VDDCR_SOC". Vendor exports name every net NetNNN and their part numbers often do not match the schematic, so the voltage of a rail usually cannot be derived — it has to be established at the bench or read from the schematic. Record it here once and the panel legend, the rail colouring and the component rail assignment all use it. Pass an empty label to clear one. Only label a net when the technician or the schematic actually says so; never invent a voltage.',
    parameters: {
      type: 'object',
      properties: {
        net: { type: 'string', description: 'Exact net name on the board, e.g. Net72' },
        label: {
          type: 'string',
          description: 'The real rail name, e.g. VDDCR_SOC, PP1V8_S0 or 3V3_STBY. Empty clears the label.',
        },
        board: { type: 'string', description: 'Board id or name. Defaults to the board on the canvas.' },
      },
      required: ['net'],
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolOutput },
    execute: (args) => {
      const loaded = loadBoard(args?.board)
      if (loaded.error) return { text: loaded.error, isError: true }
      const { meta, board } = loaded
      const net = String(args?.net ?? '').trim()
      if (!net) return { text: 'a net name is required', isError: true }
      const known = (board.nets ?? []).find((entry) => entry.name === net)
      if (!known) {
        const matches = closestMatches(net, (board.nets ?? []).map((entry) => entry.name))
        return {
          text: `found: false. No net "${net}" on this board.${matches.length ? ` Closest: ${matches.join(', ')}.` : ''}`,
          isError: true,
        }
      }

      try {
        store.setRailLabel(meta.id, net, args?.label ?? null)
      } catch (error) {
        return { text: error instanceof Error ? error.message : String(error), isError: true }
      }

      const labels = store.readRailLabels(meta.id)
      const railGroups = classifyRails(board)
      applyRailLabels(railGroups.rails, labels)
      const labelled = railGroups.rails.filter((rail) => rail.label !== rail.name)
      const volts = voltageOf(args?.label ?? '')
      return {
        text: [
          args?.label
            ? `Labelled ${net} as "${args.label}"${volts === null ? '' : ` (${volts} V)`} on "${meta.name}".`
            : `Cleared the label on ${net} for "${meta.name}".`,
          labelled.length > 0
            ? `Rails now known: ${labelled.map((rail) => `${rail.name} = ${rail.label}${rail.voltage === null ? '' : ` (${rail.voltage} V)`}`).join(', ')}`
            : 'No rails carry a label yet.',
        ].join('\n'),
      }
    },
  })

  tools.push({
    name: 'wrenchbench_rail_map',
    description:
      "Show how a board's opaque nets were named from the schematic, and what is still an open choice. A boardview that calls every net Net72 cannot say which is 1.8 V, but a schematic prints a supply once per pin (VDDCR_GFX_A12, …) so the count of pins under one supply equals the count of that device's pads on the net in the boardview. Unique counts on both sides name the rail; counts that collide are returned as choices for the technician, never as a name. This runs automatically after every import and schematic upload, so call it to see the current state, or after replacing either file.",
    parameters: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board id or name. Defaults to the board on the canvas.' },
      },
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolOutput },
    execute: (args) => {
      const loaded = loadBoard(args?.board)
      if (loaded.error) return { text: loaded.error, isError: true }
      const { meta, board } = loaded
      const schematic = store.readSchematic(meta.id)
      const labels = store.readRailLabels(meta.id)
      const map = store.readRailMap(meta.id)

      const lines = [`Rail map for "${meta.name}"${schematic ? ` against "${schematic.name}"` : ' (no schematic attached)'}:`]

      const named = Object.entries(labels).filter(([, entry]) => entry?.label)
      if (named.length === 0) {
        lines.push('  No rail is named yet.')
      } else {
        lines.push('  Named rails:')
        for (const [net, entry] of named) {
          const volts = formatVoltage(entry.voltage)
          const pads = (board.nets ?? []).find((candidate) => candidate.name === net)?.pins.length ?? 0
          const via = entry.source === 'bench' ? 'named at the bench' : `from ${entry.source === 'prior-board' ? 'another board' : 'the schematic'}`
          lines.push(`    ${net} = ${entry.label}${volts ? ` at ${volts}` : ' (voltage not printed)'} — ${pads} pads, ${via}${entry.confidence ? `, ${entry.confidence}` : ''}`)
          for (const line of (entry.evidence ?? []).slice(0, 2)) lines.push(`      · ${line}`)
        }
      }

      const suggestions = map?.suggestions ?? []
      if (suggestions.length > 0) {
        lines.push('  Open questions — one click each, never guessed:')
        for (const entry of suggestions.slice(0, 6)) {
          const choices = entry.choices ?? entry.supplies ?? []
          lines.push(
            `    ${entry.net}${entry.pins ? ` (${entry.pins} pads)` : ''}: ${choices.join(' / ')} — ${entry.reason ?? 'counts collide'}`,
          )
        }
      }

      const vocabulary = (map?.vocabulary ?? []).map((word) => word.name)
      if (vocabulary.length > 0) {
        lines.push(`  Rail names this schematic prints: ${vocabulary.slice(0, 14).join(', ')}`)
      }
      const unmatched = map?.unmatched ?? []
      if (unmatched.length > 0) {
        lines.push(
          `  Supplies that matched no net: ${unmatched.map((rail) => `${rail.name} (${rail.pins} pins)`).join(', ')}`,
        )
      }
      const learned = railLibrary.knownNames(6)
      if (learned.length > 0) {
        lines.push(
          `  Learned from boards on this bench: ${learned.map((row) => `${row.name}${row.voltage === null ? '' : ` (${row.voltage} V)`}`).join(', ')}`,
        )
      }
      for (const warning of map?.warnings ?? []) lines.push(`  ${warning}`)

      const first = suggestions.find((entry) => (entry.choices ?? entry.supplies ?? []).length > 0)
      if (first) {
        const options = (first.choices ?? first.supplies).slice(0, 4).map((name) => ({ label: name, description: 'from the schematic' }))
        options.push({ label: 'not sure yet', description: 'leave it unnamed' })
        lines.push('')
        lines.push(
          `ask_user_question: { question: "Which rail is ${first.net}?", header: "Rail", options: ${JSON.stringify(options)} }`,
        )
      }
      return { text: lines.join('\n') }
    },
  })

  tools.push({
    name: 'wrenchbench_enrich',
    description:
      'Re-run the automatic project enrichment on a board: separate pad/test-point entries from real components, and try to name the parts the boardview could not label using the attached schematic. It already runs after every import and every schematic upload, so call this only after something changed outside the panel (a file replaced on disk), or to see the current naming report.',
    parameters: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board id or name. Defaults to the board on the canvas.' },
      },
      required: [],
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolOutput },
    execute: (args) => {
      const loaded = loadBoard(args?.board)
      if (loaded.error) return { text: loaded.error, isError: true }
      try {
        const report = enrichBoard(loaded.meta.id)
        if (!report) return { text: 'that board is not in the library', isError: true }
        return { text: enrichmentReport(report) }
      } catch (error) {
        return { text: error instanceof Error ? error.message : String(error), isError: true }
      }
    },
  })

  tools.push({
    name: 'wrenchbench_name_part',
    description:
      'Give an unnamed component its real name, or confirm one the schematic proposed. The boardview label (N16136) stays the identity; the name you record is an alias that the panel, the canvas labels and every other tool then use. Use the schematic candidates that wrenchbench_component reports, or ask the technician. Pass an empty name to clear an alias.',
    parameters: {
      type: 'object',
      properties: {
        refdes: { type: 'string', description: 'The boardview label of the part, e.g. N16136' },
        name: { type: 'string', description: 'The designator to display, e.g. IC5006. Empty clears the alias.' },
        board: { type: 'string', description: 'Board id or name. Defaults to the board on the canvas.' },
      },
      required: ['refdes'],
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolOutput },
    execute: (args) => {
      const loaded = loadBoard(args?.board)
      if (loaded.error) return { text: loaded.error, isError: true }
      const { board, meta } = loaded
      const label = String(args?.refdes ?? '').trim()
      if (!label) return { text: 'the boardview label is required', isError: true }

      // Accept either the boardview label or an existing alias as the target.
      let target = partByRefdes(board, label)
      let raw = target ? target.refdes : null
      if (!target) {
        const aliases = store.readAliases(meta.id)
        const hit = Object.entries(aliases).find(
          ([, entry]) => entry?.alias && String(entry.alias).toUpperCase() === label.toUpperCase(),
        )
        if (hit) {
          target = partByRefdes(board, hit[0])
          raw = hit[0]
        }
      }
      if (!target || !raw) {
        const matches = closestMatches(label, board.parts.map((entry) => entry.refdes))
        return {
          text: `found: false. No component "${label}" on this board.${matches.length ? ` Closest: ${matches.join(', ')}.` : ''}`,
          isError: true,
        }
      }

      try {
        store.setAlias(meta.id, raw, args?.name ?? null, { source: 'bench', confidence: 'confirmed' })
      } catch (error) {
        return { text: error instanceof Error ? error.message : String(error), isError: true }
      }

      const aliases = store.readAliases(meta.id)
      const now = aliases[raw]
      return {
        text: now?.alias
          ? `${raw} is now shown as ${now.alias} on "${meta.name}"${target.value ? ` (marking ${target.value})` : ''}.`
          : `Cleared the name on ${raw} for "${meta.name}".`,
      }
    },
  })

  tools.push({
    name: 'wrenchbench_checks',
    description:
      'Rank the components the technician should probe next, from the marks recorded with wrenchbench_mark. Deterministic: it walks the board nets and pad positions, so every suggestion carries the evidence it was ranked on. Returns nothing useful until something is marked. Present the top entries as multiple-choice options rather than a paragraph.',
    parameters: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board id or name. Defaults to the board on the canvas.' },
        limit: { type: 'integer', description: 'How many suspects to return (default 8, max 40)' },
      },
      required: [],
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolOutput },
    execute: (args) => {
      const loaded = loadBoard(args?.board)
      if (loaded.error) return { text: loaded.error, isError: true }
      const { meta, board } = loaded
      const observations = store.readObservations(meta.id)
      if (observations.length === 0) {
        return {
          text: `Nothing is marked on "${meta.name}" yet. Record what the technician found with wrenchbench_mark (short, short-to-ground, open, ok) and ask again.`,
          isError: true,
        }
      }

      const { suspects, notes } = nextChecks(board, observations, {
        limit: args?.limit,
        mmPerUnit: mmPerUnit(config, board),
      })

      const marks = observations.map(
        (item) => `  ${item.kind} ${item.refdes ?? ''}${item.pin ? ` pin ${item.pin}` : ''}${item.net ? ` net ${item.net}` : ''}${item.note ? ` — ${item.note}` : ''}`.trim(),
      )

      if (suspects.length === 0) {
        return {
          text: [
            `Marks on "${meta.name}":`,
            ...marks,
            '',
            'No component bridges those nets, so the ranking found nothing.',
            ...notes.map((note) => `note: ${note}`),
          ].join('\n'),
        }
      }

      const lines = [`Marks on "${meta.name}":`, ...marks, '', `Ranked suspects (${suspects.length}):`]
      suspects.forEach((suspect, index) => {
        lines.push(
          `${index + 1}. ${suspect.refdes} — score ${suspect.score}, ${suspect.pins} pads, ${suspect.layer}${suspect.smd ? ', smd' : ''}`,
        )
        lines.push(`   because: ${suspect.evidence.join('; ')}`)
        if (suspect.nets.length > 0) lines.push(`   nets: ${suspect.nets.join(', ')}`)
        const hint = measurementHint(suspect, observations)
        if (hint) lines.push(`   measure: ${hint}`)
      })
      for (const note of notes) lines.push(`note: ${note}`)

      // A ready-made multiple-choice question, so the agent interviews the
      // technician instead of narrating a parts list. It may reword the
      // options, but it should not replace them with an open prompt.
      // Only real contenders become options: a hub ranked far below the top
      // suspect is noise on a probe menu.
      const floor = Math.max(suspects[0].score * 0.35, 10)
      const offered = suspects.filter((suspect) => suspect.score >= floor).slice(0, 3)
      lines.push('', 'Ask exactly one question next. Suggested shape for ask_user_question:')
      lines.push('  question: "Which of these can you reach with a probe right now?"')
      for (const suspect of offered.length > 0 ? offered : suspects.slice(0, 1)) {
        lines.push(`  option: "${suspect.refdes} — ${suspect.evidence[0]}"`)
      }
      lines.push('  option: "None of these are reachable"')
      lines.push(
        '',
        'Point at the top suspect with wrenchbench_focus first. Then wait for the measurement, record it with',
        'wrenchbench_mark, and call wrenchbench_checks again. Do not describe more than one suspect per turn.',
      )

      return { text: lines.join('\n') }
    },
  })

  void ctx
  return tools
}

// ---------------------------------------------------------------------------
// HTTP surface
// ---------------------------------------------------------------------------

function createRoutes(ctx, config) {
  const maxFileBytes = Number(config?.maxFileBytes) > 0 ? Number(config.maxFileBytes) : DEFAULT_MAX_FILE_BYTES
  const maxPdfBytes = Number(config?.maxPdfBytes) > 0 ? Number(config.maxPdfBytes) : DEFAULT_MAX_PDF_BYTES
  const routes = []
  // One repair thread per board, owned here and drawn by the panel.
  const repairThread = createRepairThread({ ctx, root: store.dataRoot, store })
  // Threads for boards that no longer exist are dropped here, so a bench that
  // has deleted a hundred projects does not carry a hundred sessions.
  repairThread.sweep(store.listBoards().map((board) => board.id))

  // --- library listing -----------------------------------------------------
  routes.push({
    kind: 'exact',
    path: `${ROUTE}/boards`,
    handler: (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'method not allowed')
      try {
        return sendJson(res, 200, {
          boards: store.listBoards(),
          focus: store.readFocus(),
          formats: SUPPORTED_EXTENSIONS,
          dataRoot: store.dataRoot,
        })
      } catch (error) {
        return fail(res, 500, error instanceof Error ? error.message : String(error))
      }
    },
  })

  // --- import --------------------------------------------------------------
  routes.push({
    kind: 'exact',
    path: `${ROUTE}/import`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method not allowed')
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const sourceName = url.searchParams.get('name') ?? 'boardview'
        const display = url.searchParams.get('display') ?? sourceName.replace(/\.[^.]+$/, '')
        const bytes = await readBody(req, maxFileBytes)
        if (bytes.length === 0) return fail(res, 400, 'the upload was empty')

        const parsed = parseBoard(bytes, sourceName)
        const id = store.boardIdFor(bytes, sourceName)
        const meta = store.saveBoard({
          id,
          name: display,
          sourceName,
          format: parsed.format,
          units: parsed.units,
          board: parsed,
          warnings: parsed.warnings,
        })
        // Every new project is enriched immediately: pads are separated from
        // components and anything the schematic can name is named, before the
        // technician sees the board.
        const enrichment = enrichBoard(id)
        return sendJson(res, 200, { meta, board: parsed, enrichment })
      } catch (error) {
        if (error instanceof BoardParseError) {
          return fail(res, 422, error.message, { reason: error.reason, hint: error.hint })
        }
        return fail(res, error?.statusCode ?? 400, error instanceof Error ? error.message : String(error))
      }
    },
  })

  // --- import from a Host path --------------------------------------------
  routes.push({
    kind: 'exact',
    path: `${ROUTE}/import-path`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method not allowed')
      try {
        const body = await readJsonBody(req, 256 * 1024)
        const target = String(body.path ?? '').trim()
        if (target.length === 0) return fail(res, 400, 'path is required')
        const stat = fs.statSync(target)
        if (!stat.isFile()) return fail(res, 400, 'that path is not a file')
        if (stat.size > maxFileBytes) return fail(res, 413, 'that file is larger than the import ceiling')
        const bytes = fs.readFileSync(target)
        const parsed = parseBoard(bytes, path.basename(target))
        const id = store.boardIdFor(bytes, path.basename(target))
        const meta = store.saveBoard({
          id,
          name: body.name ? String(body.name) : path.basename(target).replace(/\.[^.]+$/, ''),
          sourceName: path.basename(target),
          format: parsed.format,
          units: parsed.units,
          board: parsed,
          warnings: parsed.warnings,
        })
        return sendJson(res, 200, { meta, board: parsed })
      } catch (error) {
        return fail(res, error?.statusCode ?? 400, error instanceof Error ? error.message : String(error))
      }
    },
  })

  // --- one board -----------------------------------------------------------
  routes.push({
    kind: 'exact',
    path: `${ROUTE}/board`,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const id = url.searchParams.get('id') ?? ''

      if (req.method === 'DELETE') {
        // The bench thread belongs to the board: a deleted board must not leave
        // a session and a repair directory behind.
        const threadId = store.readRepairSession(id)
        const removed = store.deleteBoard(id)
        if (removed) await repairThread.forget(id)
        return sendJson(
          res,
          removed ? 200 : 404,
          removed ? { removed: true, thread: threadId ? 'removed' : null } : { error: 'no such board' },
        )
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'method not allowed')
      if (!store.isBoardId(id)) return fail(res, 400, 'a valid board id is required')

      const loaded = store.readBoard(id)
      if (!loaded) return fail(res, 404, 'that board is not in the library')

      store.markViewed(id)
      const schematic = store.readSchematic(id)
      // Rail grouping and the bench marks travel with the board so the canvas
      // and the agent describe the same electrical picture.
      const railModel = assignComponentRails(loaded.board, {
        aliases: railAliasesFor(id, loaded.board, schematic),
      })
      const labels = store.readRailLabels(id)
      applyRailLabels(railModel.rails, labels)
      // A rail named from the schematic must appear even when its pad count is
      // too small to have been grouped: otherwise it is in the record and
      // missing from the legend and the triage choices.
      ensureLabelledRails(loaded.board, railModel.rails, labels)
      const observations = store.readObservations(id)
      return sendJson(res, 200, {
        meta: loaded.meta,
        board: loaded.board,
        schematic: schematic
          ? { name: schematic.name, stats: schematic.stats, uploadedAt: schematic.uploadedAt, warnings: schematic.warnings }
          : null,
        rails: railModel.rails,
        railThreshold: railModel.threshold,
        railMap: store.readRailMap(id),
        railOfPart: [...railModel.assignment.entries()].map(([partIndex, net]) => [partIndex, net]),
        aliases: store.readAliases(id),
        observations,
        checks: nextChecks(loaded.board, observations, {
          limit: 8,
          mmPerUnit: mmPerUnit(config, loaded.board),
        }),
        focus: store.readFocus(),
      })
    },
  })

  // --- bench marks ---------------------------------------------------------
  routes.push({
    kind: 'exact',
    path: `${ROUTE}/observe`,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const id = url.searchParams.get('id') ?? ''
      if (!store.isBoardId(id)) return fail(res, 400, 'a valid board id is required')
      const loaded = store.readBoard(id)
      if (!loaded) return fail(res, 404, 'that board is not in the library')

      const respond = () => {
        const observations = store.readObservations(id)
        return sendJson(res, 200, {
          observations,
          checks: nextChecks(loaded.board, observations, {
            limit: 8,
            mmPerUnit: mmPerUnit(config, loaded.board),
          }),
        })
      }

      if (req.method === 'GET' || req.method === 'HEAD') return respond()

      if (req.method === 'DELETE') {
        try {
          // A filter lets the panel clear one component rather than the board.
          const refdes = url.searchParams.get('refdes')
          const net = url.searchParams.get('net')
          const kind = url.searchParams.get('kind')
          store.clearObservations(id, {
            refdes: refdes || undefined,
            net: net || undefined,
            kind: kind || undefined,
          })
          return respond()
        } catch (error) {
          return fail(res, error?.statusCode ?? 400, error instanceof Error ? error.message : String(error))
        }
      }

      if (req.method !== 'POST') return fail(res, 405, 'method not allowed')
      try {
        const body = await readJsonBody(req, 64 * 1024)
        if (body.clear) {
          store.clearObservations(id, body.filter ?? {})
        } else {
          if (body.refdes && !partByRefdes(loaded.board, body.refdes)) {
            const matches = closestMatches(String(body.refdes), loaded.board.parts.map((entry) => entry.refdes))
            return fail(res, 422, `no component "${body.refdes}" on this board`, { closest: matches })
          }
          store.addObservation(id, {
            kind: body.kind,
            refdes: body.refdes,
            pin: body.pin,
            net: body.net,
            note: body.note,
          })
        }
        return respond()
      } catch (error) {
        return fail(res, error?.statusCode ?? 400, error instanceof Error ? error.message : String(error))
      }
    },
  })

  // --- part aliases --------------------------------------------------------
  routes.push({
    kind: 'exact',
    path: `${ROUTE}/alias`,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const id = url.searchParams.get('id') ?? ''
      if (!store.isBoardId(id)) return fail(res, 400, 'a valid board id is required')
      const loaded = store.readBoard(id)
      if (!loaded) return fail(res, 404, 'that board is not in the library')

      if (req.method === 'GET' || req.method === 'HEAD') {
        return sendJson(res, 200, { aliases: store.readAliases(id) })
      }
      if (req.method !== 'POST') return fail(res, 405, 'method not allowed')

      let body
      try {
        body = await readJsonBody(req, 16 * 1024)
      } catch (error) {
        return fail(res, error?.statusCode ?? 400, error instanceof Error ? error.message : String(error))
      }
      const refdes = String(body?.refdes ?? '').trim()
      if (refdes.length === 0) return fail(res, 400, 'the boardview label (refdes) is required')
      if (!partByRefdes(loaded.board, refdes)) {
        const matches = closestMatches(refdes, loaded.board.parts.map((entry) => entry.refdes))
        return fail(res, 422, `no component "${refdes}" on this board`, { closest: matches })
      }
      try {
        // The tool calls this field `name` (it is a part's name to a
        // technician); the route grew up calling it `alias`. Accept either, so
        // a caller cannot silently write an empty name.
        store.setAlias(id, refdes, body?.alias ?? body?.name ?? null, {
          source: body?.source,
          confidence: body?.confidence,
          evidence: body?.evidence,
          candidates: body?.candidates,
        })
      } catch (error) {
        return fail(res, error?.statusCode ?? 400, error instanceof Error ? error.message : String(error))
      }
      return sendJson(res, 200, { aliases: store.readAliases(id) })
    },
  })

  // --- enrichment ----------------------------------------------------------
  routes.push({
    kind: 'exact',
    path: `${ROUTE}/enrich`,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const id = url.searchParams.get('id') ?? ''
      if (!store.isBoardId(id)) return fail(res, 400, 'a valid board id is required')
      if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'HEAD') {
        return fail(res, 405, 'method not allowed')
      }
      try {
        const report = enrichBoard(id)
        if (!report) return fail(res, 404, 'that board is not in the library')
        return sendJson(res, 200, { report, text: enrichmentReport(report), aliases: store.readAliases(id) })
      } catch (error) {
        return fail(res, 500, error instanceof Error ? error.message : String(error))
      }
    },
  })

  // --- rail labels ---------------------------------------------------------
  routes.push({
    kind: 'exact',
    path: `${ROUTE}/rail-label`,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const id = url.searchParams.get('id') ?? ''
      if (!store.isBoardId(id)) return fail(res, 400, 'a valid board id is required')
      const loaded = store.readBoard(id)
      if (!loaded) return fail(res, 404, 'that board is not in the library')
      if (req.method !== 'POST') return fail(res, 405, 'method not allowed')

      let body
      try {
        body = await readJsonBody(req, 8 * 1024)
      } catch (error) {
        return fail(res, error?.statusCode ?? 400, error instanceof Error ? error.message : String(error))
      }
      const net = String(body?.net ?? '').trim()
      if (net.length === 0) return fail(res, 400, 'a net name is required')
      const known = (loaded.board.nets ?? []).some((entry) => entry.name === net)
      if (!known) return fail(res, 422, `the board has no net named "${net}"`)

      try {
        // A label typed at the bench overrides a schematic-derived one, so it
        // is recorded with its own provenance and wins from here on.
        store.setRailLabel(id, net, body?.label ?? null, {
          source: 'bench',
          confidence: 'confirmed',
        })
      } catch (error) {
        return fail(res, error?.statusCode ?? 400, error instanceof Error ? error.message : String(error))
      }

      const schematic = store.readSchematic(id)
      const railModel = assignComponentRails(loaded.board, {
        aliases: railAliasesFor(id, loaded.board, schematic),
      })
      const labelsAfter = store.readRailLabels(id)
      applyRailLabels(railModel.rails, labelsAfter)
      ensureLabelledRails(loaded.board, railModel.rails, labelsAfter)
      // An entry the technician has now answered stops being an open question.
      const map = store.readRailMap(id)
      if (map && Array.isArray(map.ambiguous)) {
        const answered = String(body?.label ?? '').trim().length > 0 ? net : null
        if (answered) {
          const next = { ...map, ambiguous: map.ambiguous.filter((entry) => !entry.nets.includes(answered)) }
          store.writeRailMap(id, next)
        }
      }
      return sendJson(res, 200, {
        rails: railModel.rails,
        railOfPart: [...railModel.assignment.entries()],
        railMap: store.readRailMap(id),
      })
    },
  })

  // --- schematic -----------------------------------------------------------
  routes.push({
    kind: 'exact',
    path: `${ROUTE}/schematic`,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const id = url.searchParams.get('id') ?? ''

      if (req.method === 'DELETE') {
        const removed = store.deleteSchematic(id)
        return sendJson(res, removed ? 200 : 404, removed ? { removed: true } : { error: 'no schematic stored' })
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const schematic = store.readSchematic(id)
        if (!schematic) return fail(res, 404, 'no schematic is attached to that board')
        const query = url.searchParams.get('q') ?? ''
        return sendJson(res, 200, {
          name: schematic.name,
          stats: schematic.stats,
          uploadedAt: schematic.uploadedAt,
          tokens: schematic.tokens,
          pageNumbering: schematic.pageNumbering,
          warnings: schematic.warnings,
          hits: query ? searchSchematic(schematic, query, 12) : [],
          pages: query ? [] : schematic.pages.map((page) => ({ page: page.page, preview: page.text.slice(0, 240) })),
        })
      }
      if (req.method !== 'POST') return fail(res, 405, 'method not allowed')
      if (!store.isBoardId(id)) return fail(res, 400, 'a valid board id is required')
      if (!store.readMeta(id)) return fail(res, 404, 'that board is not in the library')

      try {
        const sourceName = url.searchParams.get('name') ?? 'schematic.pdf'
        const bytes = await readBody(req, maxPdfBytes)
        if (bytes.length === 0) return fail(res, 400, 'the upload was empty')
        const extracted = extractSchematic(bytes, sourceName)
        const record = store.saveSchematic(id, extracted)
        // New evidence: re-run the naming pass now rather than waiting.
        const enrichment = enrichBoard(id)
        return sendJson(res, 200, {
          name: record.name,
          stats: record.stats,
          uploadedAt: record.uploadedAt,
          tokens: record.tokens,
          pageNumbering: record.pageNumbering,
          warnings: record.warnings,
          hits: [],
          pages: record.pages.map((page) => ({ page: page.page, preview: page.text.slice(0, 240) })),
          enrichment,
        })
      } catch (error) {
        return fail(res, 422, error instanceof Error ? error.message : String(error))
      }
    },
  })

  // --- canvas focus --------------------------------------------------------
  routes.push({
    kind: 'exact',
    path: `${ROUTE}/focus`,
    handler: async (req, res) => {
      if (req.method === 'GET' || req.method === 'HEAD') return sendJson(res, 200, store.readFocus())
      if (req.method === 'DELETE') {
        const focus = store.readFocus()
        return sendJson(res, 200, store.writeFocus({ boardId: focus?.boardId ?? null, refdes: null, net: null, pin: null, annotation: null }))
      }
      if (req.method !== 'POST') return fail(res, 405, 'method not allowed')
      try {
        const body = await readJsonBody(req, 64 * 1024)
        return sendJson(res, 200, store.writeFocus({
          boardId: body.boardId === undefined ? undefined : body.boardId,
          refdes: body.refdes === undefined ? undefined : body.refdes,
          net: body.net === undefined ? undefined : body.net,
          pin: body.pin === undefined ? undefined : body.pin,
          annotation: body.annotation === undefined ? undefined : body.annotation,
        }))
      } catch (error) {
        return fail(res, error?.statusCode ?? 400, error instanceof Error ? error.message : String(error))
      }
    },
  })

  // --- the repair conversation --------------------------------------------
  //
  // WrenchBench owns its own session per board. The panel draws that thread
  // itself, so a bench conversation never turns up in the workspace session
  // list — the technician sees one program with an Ask box, and the agent is
  // still the same agent, tools and model as anywhere else.
  routes.push({
    kind: 'exact',
    path: `${ROUTE}/ask`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method not allowed')
      try {
        const body = await readJsonBody(req, 128 * 1024)
        const question = String(body.question ?? '').trim()
        if (question.length === 0) return fail(res, 400, 'a question is required')

        const loaded = loadBoard(body.board)
        if (loaded.error) return fail(res, 404, loaded.error)
        const { meta } = loaded

        const answer = await repairThread.ask(meta.id, meta.name, question)
        if (!answer.accepted) {
          return sendJson(res, 200, {
            accepted: false,
            reason: answer.reason,
            detail: answer.detail ?? null,
            sessionId: answer.sessionId ?? null,
          })
        }
        return sendJson(res, 200, { accepted: true, sessionId: answer.sessionId })
      } catch (error) {
        return fail(res, 500, error instanceof Error ? error.message : String(error))
      }
    },
  })

  routes.push({
    kind: 'exact',
    path: `${ROUTE}/conversation`,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const id = url.searchParams.get('id') ?? ''
      if (!store.isBoardId(id)) return fail(res, 400, 'a valid board id is required')
      const meta = store.readMeta(id)
      if (!meta) return fail(res, 404, 'that board is not in the library')
      try {
        const thread = await repairThread.conversation(id, meta.name)
        return sendJson(res, 200, thread)
      } catch (error) {
        return fail(res, 500, error instanceof Error ? error.message : String(error))
      }
    },
  })

  routes.push({
    kind: 'exact',
    path: `${ROUTE}/conversation/new`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return fail(res, 405, 'method not allowed')
      const url = new URL(req.url ?? '/', 'http://localhost')
      const id = url.searchParams.get('id') ?? ''
      if (!store.isBoardId(id)) return fail(res, 400, 'a valid board id is required')
      const meta = store.readMeta(id)
      if (!meta) return fail(res, 404, 'that board is not in the library')
      const made = await repairThread.reset(id, meta.name)
      if (made.error) return sendJson(res, 200, { reset: false, reason: made.error, detail: made.detail ?? null })
      return sendJson(res, 200, { reset: true, sessionId: made.sessionId, messages: [] })
    },
  })

  return routes
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/**
 * Register the browser routes and the agent tools.
 *
 * @param ctx Harness Host context carrying `webServer` and `tools`
 * @param config the row config from cordis.patch.yml
 */
export function apply(ctx, config = {}) {
  ctx.effect(() => {
    const disposers = createRoutes(ctx, config).map((route) => {
      try {
        return ctx.webServer.register(route)
      } catch {
        return () => {}
      }
    })
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // The carrier is shutting down; nothing to recover.
        }
      }
    }
  }, 'dsh-wrenchbench: routes')

  ctx.effect(() => {
    const disposers = buildTools(ctx, config).map((tool) => ctx.tools.register(tool))
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // Ignore disposal races during unload.
        }
      }
    }
  }, 'dsh-wrenchbench: tools')

  ctx.effect(() => {
    const systemPrompt = ctx.get('systemPrompt')
    if (!systemPrompt || typeof systemPrompt.section !== 'function') return () => {}
    return systemPrompt.section({
      name: 'wrenchbench-bench-protocol',
      order: 640,
      // Rebuilt per assembly so the bench state in the prompt is the bench
      // state on the canvas. Cached against the record's revision, because a
      // large board must not be re-read on every model step.
      text: () => benchProtocolText(config),
    })
  }, 'dsh-wrenchbench: system prompt')
}

/** Cache of the rendered bench block, keyed by what it was derived from. */
const protocolCache = new Map()

/**
 * The bench-protocol prompt contribution.
 *
 * This is the "training" the agent gets: a diagnostic interview discipline plus
 * the live bench state, so it opens with the rail groups and the marks already
 * on screen instead of asking the technician to restate them. It returns an
 * empty string when no board is loaded, and never throws — an exception here
 * would fail prompt assembly for the whole step.
 */
function benchProtocolText(config) {
  try {
    const boards = store.listBoards()
    if (boards.length === 0) return ''

    const focus = store.readFocus()
    const active = boards.find((board) => board.id === focus?.boardId) ?? boards[0]
    const observations = store.readObservations(active.id)
    const revision = `${active.id}:${active.updatedAt}:${observations.length}:${observations.at(-1)?.at ?? ''}`
    const cached = protocolCache.get(revision)
    if (cached !== undefined) return cached

    const loaded = store.readBoard(active.id)
    if (!loaded) return ''
    const { board } = loaded
    const railGroups = classifyRails(board, { limit: 8 })
    const liveLabels = store.readRailLabels(active.id)
    applyRailLabels(railGroups.rails, liveLabels)
    ensureLabelledRails(board, railGroups.rails, liveLabels)
    const schematic = store.readSchematic(active.id)
    const { suspects } = nextChecks(board, observations, { limit: 3, mmPerUnit: mmPerUnit(config, board) })

    const railLine =
      railGroups.rails.length > 0
        ? railGroups.rails
            .map(
              (rail) =>
                `${rail.label && rail.label !== rail.name ? `${rail.label}[${rail.name}]` : rail.name}${
                  rail.voltage === null ? '' : ` (${rail.voltage} V)`
                } ${rail.pads}p`,
            )
            .join(', ')
        : 'none identified'

    const markLines = observations.length
      ? observations
          .slice(-6)
          .map((item) => `  ${item.kind} ${item.refdes ?? ''}${item.pin ? ` pin ${item.pin}` : ''}${item.net ? ` net ${item.net}` : ''}${item.note ? ` — ${item.note}` : ''}`.trim())
      : []

    const suspectLines = suspects.map(
      (suspect, index) => `  ${index + 1}. ${suspect.refdes} (score ${suspect.score}) — ${suspect.evidence.slice(0, 2).join('; ')}`,
    )

    const lines = [
      'The technician is working a board in the WrenchBench panel. The',
      '`wrenchbench_*` tools read the same record the panel is drawing.',
      '',
      `Bench: ${active.name} — ${board.stats.parts} components, ${board.stats.pins} pads, ${board.stats.nets} nets (${active.format}).`,
      `Rail groups: ${railLine}.`,
      focus?.refdes || focus?.net
        ? `Canvas focus: ${[focus.refdes, focus.net ? `net ${focus.net}` : null, focus.pin ? `pin ${focus.pin}` : null].filter(Boolean).join(', ')}.`
        : 'Canvas focus: none.',
      ...(markLines.length > 0 ? ['Marks already recorded:', ...markLines] : []),
      ...(suspectLines.length > 0 ? ['Current ranked suspects:', ...suspectLines] : []),
      schematic
        ? `Schematic: ${schematic.name}, ${schematic.stats.pages} text pages — query it with wrenchbench_schematic (rail names, BOM values, page citations).`
        : 'Schematic: none attached; do not cite one.',
      '',
      'Work the fault as a repair interview, not a lecture.',
      '',
      'Turn shape — every turn, without exception:',
      '  1. one line of state: what is established so far (rail, part, reading);',
      '  2. one question, as multiple choice;',
      '  3. nothing else. No plan, no ranked list, no "we could also".',
      '',
      'Questioning rules:',
      '- Exactly one question per turn. Never bundle two.',
      '- Call `ask_user_question` with 2–4 options at every fork. Options must be',
      '  things the technician can answer from where they sit: a measured value, a',
      '  rail present or absent, a pad they can or cannot reach, a symptom they can',
      '  see. "What do you see?" is not a question; "0 V / 3.3 V / no access to that',
      '  pad" is.',
      '- Always include an escape option: "not reachable", "no meter here", "not',
      '  sure yet". A forced choice with no exit is how a technician stalls.',
      '- Never ask an open question you could turn into options.',
      '- Never re-ask what the panel already knows. The rail groups, marks and',
      '  canvas focus above are ground truth.',
      '- On the opening complaint, do not theorise: ask the one symptom question',
      '  that splits the tree widest (for "no power": dead / standby LED only /',
      '  spins then shuts down / boots then reboots).',
      '',
      'Fault ladder — take the cheapest step that answers the current question:',
      '  1. visual and mechanical: burn, crack, corrosion, cold joint, missing shield;',
      '  2. is the rail there at all? probe the rail, not the part;',
      '  3. diode or resistance from that rail to ground;',
      '  4. isolate per component (lift one leg, or compare against a known-good pad);',
      '  5. current-limited injection plus thermal when geometry cannot separate suspects.',
      'Never propose a replacement before a measurement rules the part in.',
      '',
      'Resolving what the technician describes:',
      '- When they describe rather than name something — "the big chip near the CPU",',
      '  "the coil by the VRM", "the 3V3 rail", "shorted cap" — call',
      '  `wrenchbench_find` FIRST. It returns real candidates with the reason each',
      '  one matched, and an explicit refusal when nothing does.',
      '- Never turn a description into a refdes on your own authority. Offer the',
      '  top candidates from `wrenchbench_find` as multiple-choice options, then',
      '  act on the one the technician picks.',
      '- Once the target is agreed, `wrenchbench_focus` it so the panel highlights',
      '  it, and use `wrenchbench_mark` for anything they measured.',
      '',
      'The panel does the same work without you: the Triage tab walks symptom →',
      'rail → measurement and marks the board itself, and right-clicking a pad',
      'offers mark, focus and rail labelling. Those write the same record your',
      'tools read, so read the marks and canvas focus above before asking.',
      '',
      'Evidence rules:',
      '- Look up every refdes with `wrenchbench_component` before typing it. Never',
      '  name a part you have not looked up; the tool returns found:false with',
      '  closest matches — pick from those or ask.',
      '- A boardview and its schematic often use different part numbers (a vendor',
      '  export renumbers everything). Never say "page 6 shows this part" unless',
      '  the schematic search actually returned that refdes. Use the schematic for',
      '  rail names, typical values and topology, and say so when it only gives a',
      '  typical value.',
      '- Name one exact pad and one meter mode per probe, and state the expected',
      '  reading with what each result would mean.',
      '- Record every finding the technician reports with `wrenchbench_mark` the',
      '  moment they say it. Do not hold it in the conversation instead.',
      '- Then call `wrenchbench_checks`. It returns the ranked suspects plus a',
      '  ready-made question block; point at the top suspect with',
      '  `wrenchbench_focus` and offer the rest as options.',
      '- If five or more suspects tie, say so in one line and offer injection',
      '  instead of five separate probes.',
      '',
      'Voice: bench-short, pro jargon fine, no emoji, no preamble, no restating the',
      'question back. Never a paragraph where a question fits. Never invent a part,',
      'net or voltage — if the boardview names no voltage, call the rail unnamed.',
    ]

    const text = lines.join('\n')
    if (protocolCache.size > 8) protocolCache.clear()
    protocolCache.set(revision, text)
    return text
  } catch {
    return ''
  }
}
