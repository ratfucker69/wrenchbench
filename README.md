# WrenchBench

A board-level repair workbench that lives in the DeepSeek Harness sidebar: boardview import and canvas, a per-board schematic, a persistent board library, and an agent that works the same board the canvas is showing.

Built as a feature-mimic of [wrenchboard.cloud](https://www.wrenchboard.cloud), reimplemented as a native DSH plugin — the parsing, the canvas, the schematic indexing, the naming, and the diagnostic agent are all local. No account, no cloud, no upload.

```
┌ sidebar ────────────┐ ┌ canvas ─────────────────────┐ ┌ bench ───────────────┐
│ board library      │ │ boardview, pan/zoom/rotate  │ │ rails, marks,        │
│  PS5 EDM-010   ●   │ │ click a pad to inspect it   │ │ ranked next checks   │
│  Switch HAD-CPU-10 │ │ rail colouring, net wiring  │ │ ask the agent        │
└────────────────────┘ └─────────────────────────────┘ └──────────────────────┘
```

## What it does

**Import anything.** The payload is sniffed, never the extension. Test_Link/OpenBoardView ASCII (`.brd .brd2 .tvw .bdv .fz .cad .asc .bv .bvr .gr .cst .f2b`), KiCad (`.kicad_pcb`), and the DES-encrypted **XZZPCB** container used by PS5/Apple/Switch vendor dumps (`.pcb`). A `.zip` of any of those is unpacked and the board member is found automatically.

**Schematic ingestion, honestly.** A PDF is parsed properly: indirect objects, the real page tree, and each subset font's `/ToUnicode` CMap, so labels come out as text rather than glyph mojibake. A page whose fonts cannot be decoded is left empty and reported, never indexed as noise. Plain-text schematics, CSV/BOM files and archives of those are indexed too; images are refused with a plain reason instead of silently producing garbage.

**Naming.** Vendor exports ship parts they cannot name (`N16136`). WrenchBench separates single-pad test points from real components, strips duplicate designator suffixes, and then tries to name what is left using the schematic: a device marking (`CXD90061GG`) that appears beside exactly one designator is a name; a generic value (`0.1u`) shared by hundreds of capacitors is only ever a list of candidates. The boardview's own label is never overwritten — a derived name lives beside it as an alias with its evidence, and a name confirmed at the bench always wins.

**Rail groups and colouring.** Nets are ranked by fan-out into rail groups and every component is assigned to the rail it draws from. Where the file names its rails (`+3V3`, `PP1V8_S0`) the voltage is read out of the name; where it does not (`Net72`), you label a rail once — from the panel legend or by asking the agent — and the colouring, the legend and the assignment follow.

**Bench reasoning.** Mark a part, pad or net as short / short-to-ground / open / OK and get a deterministic ranking of what to probe next, each suspect carrying the evidence it was ranked on and one concrete measurement to take. No model call, so it cannot invent a refdes.

**Describing instead of naming.** Say "the big chip near the CPU", "the coil by the VRM", "the 3V3 rail" or "shorted cap" and `wrenchbench_find` resolves it to real candidates with the reason each matched — a stated pad count, a marking, a schematic name, proximity — and refuses outright when nothing does. The agent offers the shortlist as options instead of guessing a refdes.

**Working by pointing.** Right-click any pad or part for mark / focus / label-rail / copy / isolate-net / ask-the-agent. The Triage tab walks the common case with buttons only: symptom, rail, what you measured — it marks the board and ranks the next probes without a single keystroke.

**A diagnostic agent, not a chatbot.** The plugin contributes a bench protocol to the agent's system prompt: one question per turn, always multiple choice with an escape option, measurement before replacement, a fault ladder, and the live bench state (rails, marks, focus, schematic) already in context. Tools hand it ready-made options, so the interview shape holds even when the prompt is under pressure.

## Install

Requires DeepSeek Harness with the Web GUI.

```bash
dsh plugin add /absolute/path/to/dsh-wrenchbench
```

Restart DSH (the Host half registers tools and routes), then refresh the Web GUI. A **WrenchBench** entry appears in the sidebar; the first run opens the new-project screen.

If your setup has no `dsh` CLI on `PATH`, add the package to your profile instead — the plugin is a normal Cordis bundle and its own `cordis.patch.yml` inserts the Host row:

```yaml
# ~/.dsh/profiles/<profile>/node_modules/  ← package linked here
# then the bundle patch is applied automatically on restart
```

## Usage

1. **New project** — drop the boardview, then (optionally) the schematic. Any file type; archives are unpacked.
2. **Board tab** — `↑` toggles rail colouring, the rail legend is click-to-label, the inspector shows the part, its marking, its pads, its rail, its bench marks, and the ranked next checks.
3. **Agent tab** — ask in plain language. The agent drives the canvas (`focus`), records marks, and answers with one question.
4. **Schematic tab** — search the text layer for a refdes, rail or page title; results cite page numbers.

Nothing leaves the machine. The library lives in `%APPDATA%/dsh-wrenchbench` (`~/.local/share/dsh-wrenchbench` on Linux).

## Naming rails from the schematic

A vendor boardview calls every net `Net72`, and its designators (`C00173`, `N16136`) share no namespace with the schematic's (`C1027`, `IC4001`). Name-matching and refdes-matching across the two files are therefore both impossible, and guessing a voltage from fan-out would put a technician on the wrong rail.

What survives the renumbering is arithmetic. A schematic prints a supply once per pin, and those labels carry the pin position — `VDDCR_GFX_A12`, `VDDCR_GFX_A14`, … Counting the distinct positions under one supply gives the number of pins that supply reaches *on that device*. The boardview then gives the number of that device's pads on one net. When a pin count is unique among the schematic's supplies **and** unique among that part's nets, the pairing is forced:

```
VDDCR_GFX 240 pins ── Net73  240 pads on N15900   high
VDDCR_CORE 104 pins ── Net108 104 pads on N15900   high
VMEMIO      80 pins ── Net72   80 pads on N15900   high
VMEMP       47 pins ── Net74   47 pads on N15900   high
VDDCR_SOC   32 pins ── Net75   32 pads on N15900   medium
```

Where the schematic also prints the voltage — `1.35V_G6_VMEMIO`, `0.85V_SOC_VMEMP`, `3.3V_VRM` — that becomes the name the bench uses, with the schematic's own label kept beside it:

```
1.35 V  (VMEMIO)       Net72   1276 pads
1.0 V   (VDDCR_GFX)    Net73    340 pads
1.0 V   (VDDCR_CORE)   Net108   149 pads
0.85 V  (VMEMP)        Net74     80 pads
VDDCR_SOC (voltage not printed)   Net75     48 pads
```

The voltage is read from the **last segment** of a voltage-named net (`1.35V_G6_VMEMIO` → `VMEMIO`), never from a word inside it: `1.8V_SOC_V18_S5` ends in the domain code `S5`, so it cannot claim `VDDCR_SOC`. When two different voltages reach one supply the rail is printed as "voltage not printed" — a wrong voltage on a rail is worse than none.

This runs by itself after every import and every schematic upload. The rules that keep it honest:

- **Under 20 pins nothing is written down.** Nineteen different parts on the EDM-010 own exactly one 5-pad net, so a small equality proves nothing. 8–19 pins is offered as a suggestion for the technician; 20 and up is applied.
- **Counts that collide stay unnamed.** Two nets with the same pad count, or two supplies with the same pin count, become a click-to-choose row in the rail legend — never a guess. Nothing is silently picked.
- **Ground and no-connect nets are never named**, and a supply can only be claimed once.
- **A bench label always wins.** `wrenchbench_label_rail` writes `source: bench` and enrichment will not overwrite it.

Every applied name stores its evidence (page, pin count, pad count, the uniqueness argument), which is what the `sch` badge in the legend shows on hover. If the schematic prints nothing position-tagged, the feature says so instead of inventing names.

## Agent tools

| Tool | Purpose |
|---|---|
| `wrenchbench_boards` / `wrenchbench_board` | library list, one-board summary with rails and components |
| `wrenchbench_import` | import from a Host path |
| `wrenchbench_component` | look up a part by boardview label **or** alias: pads, nets, neighbours, candidates |
| `wrenchbench_find` | resolve a plain-language description to ranked real candidates with reasons |
| `wrenchbench_net` / `wrenchbench_search` / `wrenchbench_measure` | trace a rail, find names, physical distance |
| `wrenchbench_schematic` | query the schematic text layer, cite pages |
| `wrenchbench_mark` | record short / short-to-ground / open / OK |
| `wrenchbench_checks` | deterministic ranked next suspects + a ready-to-ask question |
| `wrenchbench_focus` | move the canvas focus the technician is looking at |
| `wrenchbench_label_rail` | give an anonymous net its real rail name (overrides a schematic match) |
| `wrenchbench_rail_map` | show how each opaque net got its name, and which rails are still an open choice |
| `wrenchbench_name_part` / `wrenchbench_enrich` | confirm a part name, re-run the naming pass |

## Tests

No framework, no dependencies — each suite is a script, run in isolation. `smoke-live.mjs` is the end-to-end pass: it drives the routes of a running host exactly as the panel does and prints one line per feature.

```bash
node test/run-all.mjs
```

`des`, `xzz`, `parsers`, `pdf`, `formats`, `naming`, `rails`, `diagnose`, `labels`, `host`.

## Contributing

Pull requests are welcome. Before opening one, run the suite — it must pass:

```bash
node test/run-all.mjs
```

Because the parsing layer is built against real vendor files, a PR that changes a parser should either add a fixture or explain why the existing fixture already covers it.

CI is provided but not yet enabled on this repository. To turn it on, copy [`ci/tests.yml`](ci/tests.yml) to `.github/workflows/tests.yml` (needs a token with the `workflow` scope, or the GitHub web UI) and it will run the suite on Node 20/22 on Linux and Windows for every push and PR.

## Credit

Feature surface modelled on [WrenchBoard](https://github.com/Junkz3/wrench-board). The XZZ container layout was derived from its published format notes and verified against real boardview files. This is an independent implementation: no code was copied.

## License

MIT — see [LICENSE](LICENSE).
