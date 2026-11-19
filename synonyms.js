/**
 * Plain-language search over a boardview.
 *
 * A vendor export labels its parts `N14142` and its nets `Net537`, so searching
 * it for "mosfet" finds nothing: the words a technician uses at the bench are
 * not in the file. What *is* in the file is structure — pad counts, which net a
 * pad sits on, how wide those nets are, where the part is — and that is enough
 * to answer most colloquial questions honestly.
 *
 * This module resolves a query into two things:
 *
 *   - `terms`: what the query was understood to mean, so the panel can show its
 *     working instead of pretending it knew;
 *   - ranked `parts` and `nets` with a reason each.
 *
 * It never invents a part: when the board has no such family (this export has no
 * `J` connectors, no `F` fuses, no `L` chokes in its own labels) it says so, and
 * only proposes structural matches that a measurement could confirm.
 */

/** How many pads a net needs before it is treated as a supply rather than a signal. */
const RAIL_PADS = 40

/** How wide a net can be and still plausibly be a switch node. */
const SWITCH_PADS = 24

/**
 * Roles a technician asks for, with the shape that answers them.
 *
 * Each entry returns candidates plus a reason. Ordering inside a role is by
 * whatever makes the candidate most likely first, never alphabetically.
 */
const ROLES = [
  {
    id: 'processor',
    terms: ['cpu', 'apu', 'soc', 'processor', 'main chip', 'the big chip', 'core chip'],
    resolve: (ctx) => {
      const ranked = [...ctx.parts].sort((a, b) => b.pads - a.pads).slice(0, 3)
      return ranked.map((part, index) => ({
        refdes: part.refdes,
        score: 100 - index * 5,
        reason: `largest pad count on the board (${part.pads} pads) — the processor sits on it`,
      }))
    },
  },
  {
    id: 'gpu',
    terms: ['gpu', 'graphics', 'graphics chip', 'radeon'],
    resolve: (ctx) => {
      const ranked = [...ctx.parts].sort((a, b) => b.pads - a.pads).slice(1, 4)
      return ranked.map((part, index) => ({
        refdes: part.refdes,
        score: 90 - index * 5,
        reason: `${part.pads} pads, the next largest package after the processor`,
      }))
    },
  },
  {
    id: 'power-stage',
    terms: ['mosfet', 'mosfets', 'fet', 'fets', 'drmos', 'power stage', 'phase', 'phases', 'vr'],
    resolve: (ctx) =>
      ctx.parts
        .filter((part) => part.pads >= 5 && part.pads <= 40)
        .filter((part) => ctx.netSizes(part, 'rail') >= 1 && ctx.netSizes(part, 'switch') >= 1)
        .sort((a, b) => b.pads - a.pads)
        .slice(0, 8)
        .map((part) => ({
          refdes: part.refdes,
          score: 80,
          reason: `${part.pads} pads, bridging a supply net and a narrow switch node — a power stage`,
        })),
  },
  {
    id: 'coil',
    terms: ['coil', 'coils', 'inductor', 'inductors', 'choke', 'chokes'],
    resolve: (ctx) =>
      ctx.parts
        .filter((part) => part.pads === 2)
        .filter((part) => ctx.netSizes(part, 'rail') === 1 && ctx.netSizes(part, 'switch') === 1)
        .slice(0, 8)
        .map((part) => ({
          refdes: part.refdes,
          score: 78,
          reason: 'two pads, one on a supply and one on a narrow net — an output choke',
        })),
  },
  {
    id: 'capacitor',
    terms: ['cap', 'caps', 'capacitor', 'capacitors', 'ceramic', 'mlcc', 'decoupling'],
    resolve: (ctx) => ctx.byFamily(['C'], 80, 'family C in the boardview label'),
  },
  {
    id: 'resistor',
    terms: ['resistor', 'resistors', 'res', 'shunt', 'sense resistor'],
    resolve: (ctx) => ctx.byFamily(['R'], 75, 'family R in the boardview label'),
  },
  {
    id: 'diode',
    terms: ['diode', 'diodes', 'tvs', 'esd', 'zener', 'schottky'],
    resolve: (ctx) => ctx.byFamily(['D'], 72, 'family D in the boardview label'),
  },
  {
    id: 'connector',
    terms: ['connector', 'jack', 'header', 'socket', 'psu', 'power supply', 'dc in', 'dc-in', 'power input'],
    resolve: (ctx) => {
      const named = ctx.byFamily(['J', 'CN', 'P'], 85, 'connector family in the boardview label')
      // No connector family means no connector answer: this export renames them,
      // and offering capacitors as a guess would cost the technician a probe.
      return named
    },
  },
  {
    id: 'fuse',
    terms: ['fuse', 'fusible'],
    resolve: (ctx) => ctx.byFamily(['F'], 70, 'family F in the boardview label'),
  },
  {
    id: 'crystal',
    terms: ['crystal', 'oscillator', 'xo', 'clock'],
    resolve: (ctx) => ctx.byFamily(['Y', 'X', 'XTAL'], 70, 'crystal family in the boardview label'),
  },
  {
    id: 'led',
    terms: ['led', 'leds', 'light', 'indicator'],
    resolve: (ctx) => ctx.byFamily(['LED'], 70, 'LED family in the boardview label'),
  },
  {
    id: 'rail',
    terms: ['rail', 'rails', 'supply', 'supplies', 'power rail', 'voltage rail', 'vcore', 'vddcr', 'power'],
    resolve: (ctx) => {
      const wanted = ctx.subject ?? ''
      const named = (rail) => {
        const label = String(rail.label ?? '').toLowerCase()
        if (label.length === 0) return false
        const tokens = label.split(/[^a-z0-9]+/).filter((token) => token.length >= 3)
        return tokens.some((token) => wanted.includes(token)) || wanted.includes(label)
      }
      return [...ctx.rails]
        .map((rail) => ({ rail, named: named(rail) }))
        .sort((a, b) => Number(b.named) - Number(a.named) || b.rail.pads - a.rail.pads)
        .slice(0, 10)
        .map(({ rail, named: matched }) => ({
          net: rail.name,
          score: matched ? 98 : 85,
          reason: `${rail.pads} pads${rail.label ? ` — ${rail.label}` : ''}${typeof rail.voltage === 'number' ? ` at ${rail.voltage} V` : ''}${matched ? ' (name matches the query)' : ''}`,
        }))
    },
  },
  {
    id: 'ground',
    terms: ['ground', 'gnd', 'earth', 'ground plane'],
    resolve: (ctx) =>
      ctx.board.nets
        .filter((net) => net.ground)
        .slice(0, 5)
        .map((net) => ({ net: net.name, score: 95, reason: `${net.pins?.length ?? 0} pads — the ground plane` })),
  },
  {
    id: 'largest',
    terms: ['biggest', 'largest', 'big parts', 'big chips', 'biggest parts'],
    resolve: (ctx) =>
      [...ctx.parts]
        .sort((a, b) => b.pads - a.pads)
        .slice(0, 6)
        .map((part) => ({ refdes: part.refdes, score: 70, reason: `${part.pads} pads` })),
  },
  {
    id: 'smallest',
    terms: ['smallest', 'tiny', 'small parts', 'two pad parts'],
    resolve: (ctx) =>
      [...ctx.parts]
        .filter((part) => part.pads > 0)
        .sort((a, b) => a.pads - b.pads)
        .slice(0, 6)
        .map((part) => ({ refdes: part.refdes, score: 60, reason: `${part.pads} pads` })),
  },
  {
    id: 'suspects',
    terms: ['suspect', 'suspects', 'shorted', 'short', 'bad', 'faulty', 'failed'],
    resolve: (ctx) =>
      ctx.marks
        .filter((mark) => mark.kind === 'short' || mark.kind === 'short-to-ground')
        .slice(0, 10)
        .map((mark) => ({
          ...(mark.refdes ? { refdes: mark.refdes } : {}),
          ...(mark.net ? { net: mark.net } : {}),
          score: 95,
          reason: `already marked ${mark.kind}${mark.note ? ` — ${mark.note}` : ''}`,
        })),
  },
]

/**
 * Resolve one plain-language query against a board.
 *
 * @param {string} query what the technician typed
 * @param {object} context { board, rails, marks, aliases, distance }
 * @returns {{terms: string[], roles: string[], parts: object[], nets: object[], notes: string[], understood: boolean}}
 */
export function resolveColloquial(query, context) {
  const text = String(query ?? '').trim().toLowerCase()
  const empty = { terms: [], roles: [], parts: [], nets: [], notes: [], understood: false }
  if (text.length === 0) return empty

  const board = context.board
  if (!board) return { ...empty, notes: ['no board is loaded'] }

  const aliases = context.aliases ?? {}
  const netsByPart = new Map()
  const netPadCount = new Map()
  for (const net of board.nets ?? []) netPadCount.set(net.name, net.pins?.length ?? 0)
  for (const pin of board.pins ?? []) {
    if (typeof pin.part !== 'number') continue
    let list = netsByPart.get(pin.part)
    if (!list) {
      list = new Set()
      netsByPart.set(pin.part, list)
    }
    if (pin.net) list.add(pin.net)
  }

  const displayOf = (part) => aliases[part.refdes]?.alias ?? part.refdes
  // A part's pad count arrives as "pins" on the board payload and as "pads" from
  // some tools; both are read so a structural heuristic cannot silently see zero
  // pads and conclude the board has no power stages.
  const parts = (board.parts ?? []).map((part, index) => ({
    ...part,
    index,
    label: displayOf(part),
    pads: part.pins ?? part.pads ?? 0,
  }))

  const netSizes = (part, kind) => {
    const nets = netsByPart.get(part.index)
    if (!nets) return 0
    let count = 0
    for (const name of nets) {
      const pads = netPadCount.get(name) ?? 0
      if (kind === 'rail' && pads >= RAIL_PADS) count += 1
      if (kind === 'switch' && pads >= 2 && pads <= SWITCH_PADS) count += 1
    }
    return count
  }

  const byFamily = (prefixes, score, reason) => {
    const upper = prefixes.map((prefix) => prefix.toUpperCase())
    const hits = parts
      .filter((part) => upper.some((prefix) => String(part.refdes).toUpperCase().startsWith(prefix)))
      .sort((a, b) => b.pads - a.pads)
      .map((part) => ({ refdes: part.refdes, score, reason: `${reason}, ${part.pads} pads` }))
    return hits
  }

  /** "mosfet for Net73" / "caps on the 3V3 rail" / "parts near N14143" */
  const raw = String(query ?? '').trim()
  const rawTarget = /(?:for|on|near|around|at)\s+(.+)$/i.exec(raw)
  const target = /(?:for|on|near|around|at)\s+(.+)$/.exec(text)
  const subject = target ? text.slice(0, target.index).trim() : text
  const targetText = target ? target[1].trim() : null
  const targetLabel = rawTarget ? rawTarget[1].trim() : targetText

  const ctx = {
    board,
    parts,
    subject,
    rails: context.rails ?? [],
    marks: context.marks ?? [],
    netSizes,
    byFamily,
  }

  const matchedRoles = []
  let hits = []
  for (const role of ROLES) {
    const exact = role.terms.some((term) => subject === term || subject === `${term}s`)
    const loose = role.terms.some((term) => term.length >= 3 && (subject.includes(term) || term.includes(subject)))
    if (!exact && !loose) continue
    matchedRoles.push(role.id)
    hits = hits.concat(role.resolve(ctx))
    if (exact) break
  }

  const notes = []
  // A role that is understood but finds nothing must still say so: an empty list
  // with no explanation reads like a broken search.
  if (matchedRoles.length > 0 && hits.length === 0) {
    notes.push(
      `this export has nothing that matches "${subject}" by structure — give a refdes, or describe the job another way`,
    )
  }
  const parts_out = []
  const nets_out = []
  for (const hit of hits) {
    if (hit.refdes) parts_out.push(hit)
    if (hit.net) nets_out.push(hit)
  }

  // A named target narrows the answer instead of replacing it.
  if (targetText) {
    const wanted = targetText.replace(/^(the|a|an)\s+/, '').trim()
    const netMatch = (board.nets ?? []).find((net) => net.name.toLowerCase() === wanted)
    const partMatch = parts.find(
      (part) => String(part.refdes).toLowerCase() === wanted || String(part.label).toLowerCase() === wanted,
    )
    if (netMatch) {
      notes.push(`restricted to ${netMatch.name}`)
      const onNet = new Set(
        (board.pins ?? []).filter((pin) => pin.net === netMatch.name && typeof pin.part === 'number').map((pin) => pin.part),
      )
      const filtered = parts_out.filter((hit) => {
        const part = parts.find((candidate) => candidate.refdes === hit.refdes)
        return part && onNet.has(part.index)
      })
      parts_out.length = 0
      parts_out.push(...filtered)
      if (filtered.length === 0 && parts_out.length === 0) {
        notes.push(`nothing in that role sits on ${netMatch.name}`)
      }
    } else if (partMatch) {
      notes.push(`restricted to parts near ${partMatch.refdes}`)
      const nearby = []
      for (const hit of parts_out) {
        const part = parts.find((candidate) => candidate.refdes === hit.refdes)
        if (!part || part.index === partMatch.index) continue
        const distance = context.distance?.(partMatch.index, part.index)
        if (typeof distance === 'number' && distance <= 12) nearby.push({ ...hit, reason: `${hit.reason}; ${distance.toFixed(1)} mm away` })
      }
      if (nearby.length > 0) {
        parts_out.length = 0
        parts_out.push(...nearby)
      }
    } else {
      notes.push(`"${targetLabel}" is not a net or part on this board`)
    }
  }

  // Substring fallback: whatever the technician typed may simply be a label.
  const understood = matchedRoles.length > 0
  if (!understood) {
    const needle = text
    const directParts = parts
      .filter(
        (part) =>
          String(part.refdes).toLowerCase().includes(needle) || String(part.label).toLowerCase().includes(needle),
      )
      .slice(0, 20)
      .map((part) => ({ refdes: part.refdes, score: 60, reason: 'the label contains that text' }))
    const directNets = (board.nets ?? [])
      .filter((net) => net.name.toLowerCase().includes(needle))
      .slice(0, 20)
      .map((net) => ({ net: net.name, score: 60, reason: `${net.pins?.length ?? 0} pads` }))
    parts_out.push(...directParts)
    nets_out.push(...directNets)
    if (directParts.length === 0 && directNets.length === 0) {
      notes.push(
        'no part or net label contains that text — this export renames everything, so describe the job instead (mosfet, coil, cpu, rail, cap)',
      )
    }
  }

  const seen = new Set()
  const uniqueParts = parts_out
    .filter((hit) => {
      const key = `p:${hit.refdes}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 12)
  const uniqueNets = nets_out
    .filter((hit) => {
      const key = `n:${hit.net}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 12)

  return {
    terms: subject.length > 0 ? [subject] : [],
    roles: matchedRoles,
    parts: uniqueParts,
    nets: uniqueNets,
    notes,
    understood,
  }
}

/** The vocabulary this module understands, for help text and tests. */
export function colloquialVocabulary() {
  return ROLES.map((role) => ({ id: role.id, terms: [...role.terms] }))
}
