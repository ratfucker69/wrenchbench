import fs from "node:fs"
let src = fs.readFileSync("client.js", "utf8")
let n = 0
const swap = (from, to, label) => { if (!src.includes(from)) { console.log("MISS:", label); return } src = src.replace(from, to); n += 1; console.log("ok:", label) }

// 1. the helper, at module scope next to the other panel helpers
swap(
`    function WrenchBenchPanel() {`,
`    /**
     * Identity of one agent focus command.
     *
     * \`updatedAt\` changes on every /focus write, so re-issuing the same target
     * counts as a new command; an unchanged file means the agent did nothing and
     * the technician's own selection must be left alone.
     */
    function focusSignature(focus) {
      if (!focus) return ''
      return [
        focus.updatedAt ?? '',
        focus.boardId ?? '',
        focus.refdes ?? '',
        focus.net ?? '',
        focus.pin ?? '',
        focus.annotation ?? '',
      ].join('|')
    }

    function selectionFromFocus(focus) {
      const hasTarget = Boolean(focus && (focus.refdes || focus.net || focus.pin))
      if (!hasTarget) return { refdes: null, net: null, pin: null, annotation: null }
      return {
        refdes: focus.refdes ?? null,
        net: focus.net ?? null,
        pin: focus.pin ?? null,
        annotation: focus.annotation ?? null,
      }
    }

    function WrenchBenchPanel() {`,
"focus helpers",
)

// 2. the ref
swap(
`          const panelRef = React.useRef(null)`,
`          const panelRef = React.useRef(null)
          // Which agent focus command this panel has already applied. Without
          // it, the 2s poll re-applies "no focus" forever and wipes the
          // technician's own click after a couple of seconds.
          const appliedFocusRef = React.useRef(null)`,
"applied focus ref",
)

fs.writeFileSync("client.js", src)
console.log("edits:", n)
