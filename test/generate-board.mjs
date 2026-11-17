import fs from 'node:fs'
// Build a realistic Test_Link boardview fixture: 500 parts spread over a
// 1650x900 bench outline, thousands of pads, rail and ground nets, and probe
// points. Deterministic, so the canvas can be compared across runs.
// Usage: node test/generate-board.mjs [output-path]
const rand = (seed) => { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 }
const r = rand(42)
const RAILS = ['+3V3','+5V','+1V8','+1V2','VBUS','VDD_ARM','NVCC_DRAM','PP5V7_LCM','+12V']
const prefixes = ['U','R','C','L','Q','D','J','Y','F','SW','TP','SH']
const parts = []; const pins = []; const nails = []
let pinCursor = 0
const cols = 26, rows = 20, gapx = 62, gapy = 44
for (let i = 0; i < 500; i++) {
  const col = i % cols, row = Math.floor(i / cols)
  const baseX = 40 + col * gapx + r() * 8
  const baseY = 30 + row * gapy + r() * 8
  const prefix = prefixes[Math.floor(r() * prefixes.length)]
  const big = r() < 0.08
  const count = big ? 8 + Math.floor(r() * 40) : 2 + Math.floor(r() * 5)
  const layerBits = (r() < 0.25 ? 2 : 0) | (r() < 0.8 ? 4 : 0)
  pinCursor += count
  parts.push(`${prefix}${i + 1} ${layerBits} ${pinCursor}`)
  const spanX = big ? 18 : 6, spanY = big ? 18 : 5
  const n = Math.ceil(Math.sqrt(count))
  for (let p = 0; p < count; p++) {
    const px = Math.round(baseX + (p % n) * (spanX / Math.max(n - 1, 1)))
    const py = Math.round(baseY + Math.floor(p / n) * (spanY / Math.max(n - 1, 1)))
    let net
    if (p === 0) net = 'GND'
    else if (r() < 0.35) net = RAILS[Math.floor(r() * RAILS.length)]
    else net = `${['HDMI','USB','DSI','PCIE','AUD','CAM','WLAN','BT'][Math.floor(r()*8)]}_${Math.floor(r()*647)}`
    pins.push(`${px} ${py} ${p < 3 ? pins.length : -99} ${i + 1} ${net}`)
    if (p < 3) nails.push(`${pins.length - 1} ${px} ${py} ${layerBits & 2 ? -1 : 1} ${net}`)
  }
}
const outline = ['0 0','1650 0','1650 900','0 900']
const text = [
  `var_data: ${outline.length} ${parts.length} ${pins.length} ${nails.length}`,
  'Format:', ...outline,
  'Parts:', ...parts,
  'Pins:', ...pins,
  'Nails:', ...nails,
].join('\n')
const destination = process.argv[2] ?? new URL('./bench-board.brd', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
fs.writeFileSync(destination, text, 'latin1')
const nets = new Set(pins.map(l => l.split(' ')[4]))
console.log('parts', parts.length, 'pins', pins.length, 'nets', nets.size, 'bytes', text.length)
