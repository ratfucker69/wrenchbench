/**
 * Short-circuit reasoning for WrenchBench.
 *
 * `nextChecks` answers one question: given what the technician has marked, which
 * components should be probed next? It is deterministic graph work over the
 * board's own nets and pad positions — no model call, no guessing at a refdes
 * that is not in the file.
 *
 * The reasoning is deliberately textbook rather than clever:
 *
 *   - A short to ground on a rail is caused by a component that touches both
 *     that rail and ground. Decoupling capacitors are by far the most common
 *     culprit, so a two-terminal part outranks a 500-ball package.
 *   - A short between two nets is caused by a component touching both.
 *   - Proximity matters, because a short is usually local, and because a
 *     technician can reach a neighbouring part without moving the board.
 *   - A huge pin count is a reason to look *later*: an SoC bridges every rail
 *     to ground on every board, so presence alone proves nothing.
 *
 * Every suggestion carries the evidence it was ranked on, so the technician can
 * disagree with it.
 */

const GROUND_PATTERN = /^(GND|GROUND|VSS|AGND|DGND|PGND|GND_?[A-Z0-9]*)$/i
const NO_CONNECT_PATTERN = /^(NC|N\.?C\.?|DNC|NO_?CONNECT|RESERVED)$/i

/** Passive families, in the order a bench technician would suspect them. */
function familyBonus(refdes) {
  const prefix = String(refdes).replace(/[0-9].*$/, '').toUpperCase()
  if (prefix === 'C') return 26
  if (prefix === 'D') return 18
  if (prefix === 'Q') return 14
  if (prefix === 'L' || prefix === 'FB') return 10
  if (prefix === 'R') return 6
  return 0
}

function isGroundName(name) {
  return GROUND_PATTERN.test(String(name ?? ''))
}

function isNoConnectName(name) {
  return NO_CONNECT_PATTERN.test(String(name ?? ''))
}

function padCentre(part) {
  return {
    x: (part.bbox.x1 + part.bbox.x2) / 2,
    y: (part.bbox.y1 + part.bbox.y2) / 2,
  }
}

/**
 * Index the board once: nets to pads, pads to components, components to nets.
 */
function indexBoard(board) {
  const netNames = new Map()
  for (const net of board.nets ?? []) netNames.set(net.name, net)

  const netsByPart = new Map()
  const partsByNet = new Map()
  const partByRefdes = new Map()

  for (let partIndex = 0; partIndex < (board.parts?.length ?? 0); partIndex += 1) {
    partByRefdes.set(board.parts[partIndex].refdes.toUpperCase(), partIndex)
  }

  for (let pinIndex = 0; pinIndex < (board.pins?.length ?? 0); pinIndex += 1) {
    const pin = board.pins[pinIndex]
    if (!pin.net) continue
    let owned = netsByPart.get(pin.part)
    if (!owned) {
      owned = new Set()
      netsByPart.set(pin.part, owned)
    }
    if (owned.has(pin.net)) continue
    owned.add(pin.net)
    let holders = partsByNet.get(pin.net)
    if (!holders) {
      holders = new Set()
      partsByNet.set(pin.net, holders)
    }
    holders.add(pin.part)
  }

  return { netNames, netsByPart, partsByNet, partByRefdes }
}

/** The biggest ground net on the board, used as the "short to ground" target. */
function groundNet(board) {
  let best = null
  for (const net of board.nets ?? []) {
    if (!isGroundName(net.name) && !net.ground) continue
    if (!best || net.pins.length > best.pins.length) best = net
  }
  return best ? best.name : null
}

function toMillimetres(units, board, mmPerUnit) {
  if (board.units === 'mm') return units
  return units * mmPerUnit
}

/**
 * Rank the components worth probing next.
 *
 * @param {object} board the stored board model
 * @param {object[]} observations marked findings for this board
 * @param {object} [options]
 * @param {number} [options.limit] how many suspects to return (default 8)
 * @param {number} [options.mmPerUnit] scale for unit-scaled boards
 * @returns {{suspects: object[], notes: string[]}}
 */
export function nextChecks(board, observations, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 8, 1), 40)
  const mmPerUnit = Number.isFinite(options.mmPerUnit) && options.mmPerUnit > 0 ? options.mmPerUnit : 0.0254
  const notes = []
  const index = indexBoard(board)
  const ground = groundNet(board)
  const scores = new Map()

  const consider = (partIndex, score, evidence) => {
    const entry = scores.get(partIndex) ?? { partIndex, score: 0, evidence: [], seen: new Set(), bridges: new Set() }
    entry.score = Math.max(entry.score, score)
    if (!entry.seen.has(evidence.text)) {
      entry.seen.add(evidence.text)
      entry.evidence.push(evidence)
    }
    scores.set(partIndex, entry)
  }

  /** Record which suspect net a candidate is being blamed for. */
  const blameNet = (partIndex, netName) => {
    const entry = scores.get(partIndex)
    if (!entry) return
    if (!entry.bridges) entry.bridges = new Set()
    entry.bridges.add(netName)
  }

  const distanceScore = (markedPart, candidatePart) => {
    const a = padCentre(markedPart)
    const b = padCentre(candidatePart)
    const units = Math.hypot(a.x - b.x, a.y - b.y)
    const mm = toMillimetres(units, board, mmPerUnit)
    // Full credit under 5 mm, decaying to nothing at 40 mm.
    const credit = mm <= 5 ? 20 : Math.max(0, 20 - ((mm - 5) / 35) * 20)
    return { mm, credit }
  }

  const pinPenalty = (part) => (part.pins > 8 ? Math.min(34, (part.pins - 8) * 0.55) : 0)

  for (const observation of observations ?? []) {
    const kind = observation.kind
    const markedRefdes = observation.refdes ? String(observation.refdes).toUpperCase() : null
    const markedIndex = markedRefdes ? index.partByRefdes.get(markedRefdes) : undefined
    if (markedRefdes && markedIndex === undefined) {
      notes.push(`the marked component ${observation.refdes} is not on this board`)
      continue
    }

    // Which nets are suspect?
    let suspectNets = []
    if (observation.net) {
      suspectNets = [observation.net]
    } else if (markedIndex !== undefined) {
      const owned = [...(index.netsByPart.get(markedIndex) ?? [])]
      suspectNets = owned.filter((name) => !isGroundName(name) && !isNoConnectName(name))
    }
    suspectNets = suspectNets.filter((name) => typeof name === 'string' && name.length > 0)
    if (suspectNets.length === 0) {
      notes.push(`no suspect nets could be derived for ${observation.refdes ?? observation.net ?? 'that mark'}`)
      continue
    }

    if (kind === 'short-to-ground') {
      if (!ground) {
        notes.push('this board has no ground net, so a short to ground cannot be traced')
        continue
      }
      for (const netName of suspectNets) {
        const holders = index.partsByNet.get(netName)
        if (!holders) continue
        for (const partIndex of holders) {
          if (partIndex === markedIndex) continue
          const part = board.parts[partIndex]
          const owned = index.netsByPart.get(partIndex) ?? new Set()
          const touchesGround = [...owned].some((name) => isGroundName(name))
          if (!touchesGround) continue

          let score = 30
          const evidence = [
            { text: `bridges ${netName} to ${ground}`, weight: 30 },
          ]
          if (part.pins === 2) {
            score += 26
            evidence.push({ text: 'two-terminal part, the usual shunt on a rail', weight: 26 })
          }
          const family = familyBonus(part.refdes)
          if (family > 0) {
            score += family
            evidence.push({ text: `passive family ${String(part.refdes).replace(/[0-9].*$/, '')}`, weight: family })
          }
          if (markedIndex !== undefined) {
            const { mm, credit } = distanceScore(board.parts[markedIndex], part)
            if (credit > 0.5) {
              score += credit
              evidence.push({ text: `${mm.toFixed(1)} mm from ${board.parts[markedIndex].refdes}`, weight: Math.round(credit) })
            }
          }
          const penalty = pinPenalty(part)
          if (penalty > 0) {
            score -= penalty
            evidence.push({ text: `${part.pins} pads, so it bridges many nets`, weight: -Math.round(penalty) })
          }
          consider(partIndex, score, evidence[0])
          blameNet(partIndex, netName)
          for (const extra of evidence.slice(1)) {
            const entry = scores.get(partIndex)
            if (entry && !entry.seen.has(extra.text)) {
              entry.seen.add(extra.text)
              entry.evidence.push(extra)
            }
          }
        }
      }
    } else if (kind === 'short') {
      for (const netName of suspectNets) {
        const holders = index.partsByNet.get(netName)
        if (!holders) continue
        for (const partIndex of holders) {
          if (partIndex === markedIndex) continue
          const part = board.parts[partIndex]
          const shared = suspectNets.filter((name) => (index.netsByPart.get(partIndex) ?? new Set()).has(name))
          if (shared.length === 0) continue
          let score = 18 + shared.length * 6
          const evidence = [{ text: `shares ${shared.join(', ')}`, weight: 18 + shared.length * 6 }]
          if (part.pins === 2) {
            score += 20
            evidence.push({ text: 'two-terminal part', weight: 20 })
          }
          const family = familyBonus(part.refdes)
          if (family > 0) {
            score += family
            evidence.push({ text: `passive family ${String(part.refdes).replace(/[0-9].*$/, '')}`, weight: family })
          }
          if (markedIndex !== undefined) {
            const { mm, credit } = distanceScore(board.parts[markedIndex], part)
            if (credit > 0.5) {
              score += credit
              evidence.push({ text: `${mm.toFixed(1)} mm away`, weight: Math.round(credit) })
            }
          }
          const penalty = pinPenalty(part)
          if (penalty > 0) score -= penalty
          const entry = scores.get(partIndex) ?? { partIndex, score: 0, evidence: [], seen: new Set(), bridges: new Set() }
          entry.score = Math.max(entry.score, score)
          for (const item of evidence) {
            if (entry.seen.has(item.text)) continue
            entry.seen.add(item.text)
            entry.evidence.push(item)
          }
          scores.set(partIndex, entry)
          blameNet(partIndex, netName)
        }
      }
    } else if (kind === 'open') {
      // An open has no direction information in a boardview, so the honest
      // suggestion is the nearest components sharing a net.
      for (const netName of suspectNets) {
        const holders = index.partsByNet.get(netName)
        if (!holders) continue
        for (const partIndex of holders) {
          if (partIndex === markedIndex) continue
          const part = board.parts[partIndex]
          let score = 10
          const evidence = [{ text: `shares ${netName}`, weight: 10 }]
          if (markedIndex !== undefined) {
            const { mm, credit } = distanceScore(board.parts[markedIndex], part)
            score += credit
            if (credit > 0.5) evidence.push({ text: `${mm.toFixed(1)} mm away`, weight: Math.round(credit) })
          }
          const entry = scores.get(partIndex) ?? { partIndex, score: 0, evidence: [], seen: new Set(), bridges: new Set() }
          entry.score = Math.max(entry.score, score)
          for (const item of evidence) {
            if (entry.seen.has(item.text)) continue
            entry.seen.add(item.text)
            entry.evidence.push(item)
          }
          scores.set(partIndex, entry)
          blameNet(partIndex, netName)
        }
      }
    } else if (kind === 'ok') {
      // An "ok" mark removes a name from the suspect list rather than adding one.
      continue
    }
  }

  // A component the technician already cleared is not a suggestion.
  const cleared = new Set(
    (observations ?? [])
      .filter((observation) => observation.kind === 'ok' && observation.refdes)
      .map((observation) => String(observation.refdes).toUpperCase()),
  )

  const suspects = [...scores.values()]
    .filter((entry) => !cleared.has(board.parts[entry.partIndex].refdes.toUpperCase()))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      // Equal scores: a part that bridges fewer nets is the purer suspect — a
      // decoupling cap sits on the rail and ground and nothing else, while a
      // part tied on score but touching nine nets is a hub, not a shunt.
      const netsA = (index.netsByPart.get(a.partIndex) ?? new Set()).size
      const netsB = (index.netsByPart.get(b.partIndex) ?? new Set()).size
      if (netsA !== netsB) return netsA - netsB
      return board.parts[a.partIndex].refdes.localeCompare(board.parts[b.partIndex].refdes)
    })
    .slice(0, limit)
    .map((entry) => {
      const part = board.parts[entry.partIndex]
      const owned = [...(index.netsByPart.get(entry.partIndex) ?? [])]
      return {
        refdes: part.refdes,
        partIndex: entry.partIndex,
        pins: part.pins,
        layer: part.layer,
        smd: part.smd,
        score: Math.round(entry.score * 10) / 10,
        nets: owned.filter((name) => !isNoConnectName(name)).slice(0, 8),
        bridges: [...(entry.bridges ?? [])],
        evidence: entry.evidence.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).map((item) => item.text),
      }
    })

  if (suspects.length >= 5) {
    const shared = suspects.filter((suspect) => suspect.score === suspects[0].score).length
    if (shared >= 5) {
      notes.push(
        `${shared} suspects rank equally, so geometry cannot separate them. Injecting from a current-limited supply and looking for the warm part localises this faster than probing them one by one.`,
      )
    }
  }

  if (suspects.length === 0 && (observations ?? []).length > 0) {
    notes.push('no component bridges the suspect nets; the short may be a plane defect or an unlisted part')
  }

  return { suspects, notes }
}
