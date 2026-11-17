/**
 * Smoke test for the WrenchBench parsers: a Test_Link-shaped board, a
 * zlib-packed board, and a KiCad .kicad_pcb. Run with `node test/parsers.test.mjs`.
 */
import zlib from 'node:zlib'
import { parseBoard } from '../parsers.js'

const testLink = `var_data: 4 3 6 2
Format:
0 0
100 0
100 50
0 50
Parts:
U1 1 3
R1 5 5
C1 1 6
Pins:
10 10 1 1 GND
20 10 2 1 +3V3
30 10 3 1 +3V3
40 10 4 2 GND
50 10 5 2 +5V
60 10 6 3 GND
Nails:
1 10 10 1 GND
2 20 10 1 +3V3
`

const kicad = `(kicad_pcb (version 20221018) (generator pcbnew)
  (gr_line (start 0 0) (end 50 0) (layer "Edge.Cuts"))
  (gr_line (start 50 0) (end 50 40) (layer "Edge.Cuts"))
  (footprint "Package_SO:SOIC-8" (layer "F.Cu") (at 10 10)
    (fp_text reference "U1" (at 0 -3) (layer "F.SilkS"))
    (pad "1" smd rect (at -1.5 0) (size 1 1) (layers "F.Cu") (net 1 "GND"))
    (pad "2" smd rect (at -0.5 0) (size 1 1) (layers "F.Cu") (net 2 "+3V3"))
    (pad "3" smd rect (at 0.5 0) (size 1 1) (layers "F.Cu") (net 2 "+3V3"))
    (pad "4" smd rect (at 1.5 0) (size 1 1) (layers "F.Cu") (net 1 "GND"))
  )
  (footprint "Resistor_SMD:R_0402" (layer "B.Cu") (at 30 20)
    (fp_text reference "R1" (at 0 0) (layer "B.SilkS"))
    (pad "1" smd rect (at -0.5 0) (size 1 1) (layers "B.Cu") (net 3 "+5V"))
    (pad "2" smd rect (at 0.5 0) (size 1 1) (layers "B.Cu") (net 1 "GND"))
  )
)
`

function report(label, board) {
  console.log(`\n=== ${label} ===`)
  console.log('format', board.format, '| units', board.units)
  console.log('parts', board.stats.parts, 'pins', board.stats.pins, 'nets', board.stats.nets, 'probes', board.stats.probes)
  console.log('bounds', JSON.stringify(board.bounds))
  console.log('outline pts', board.outline.length, 'edges', board.edges.length)
  console.log('refdes', board.parts.map((p) => `${p.refdes}/${p.layer}/${p.pins}`).join(' '))
  console.log('nets', board.nets.map((n) => `${n.name}(${n.pins.length}${n.power ? ',P' : ''}${n.ground ? ',G' : ''})`).join(' '))
  console.log('warnings', board.warnings)
}

report('test-link ascii', parseBoard(Buffer.from(testLink), 'demo.brd'))
report('test-link zlib packed', parseBoard(zlib.deflateSync(Buffer.from(testLink)), 'demo.tvw'))
report('kicad pcb', parseBoard(Buffer.from(kicad), 'board.kicad_pcb'))

// Guard rails: a text file that is not a boardview must fail loudly.
for (const [label, payload, file] of [
  ['plain text', Buffer.from('hello world, this is not a board'), 'notes.txt'],
  ['binary noise', Buffer.from([0x00, 0xff, 0x91, 0x02, 0x7f, 0x00, 0xab, 0xcd, 0xef, 0x11]), 'junk.bdv'],
]) {
  try {
    parseBoard(payload, file)
    console.log(`\n!! ${label} was accepted, which it should not be`)
  } catch (error) {
    console.log(`\n${label} rejected as expected: ${error.message}`)
  }
}
