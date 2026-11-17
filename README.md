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

## Agent tools

| Tool | Purpose |
|---|---|
| `wrenchbench_boards` / `wrenchbench_board` | library list, one-board summary with rails and components |
| `wrenchbench_import` | import from a Host path |
| `wrenchbench_component` | look up a part by boardview label **or** alias: pads, nets, neighbours, candidates |
| `wrenchbench_net` / `wrenchbench_search` / `wrenchbench_measure` | trace a rail, find names, physical distance |
| `wrenchbench_schematic` | query the schematic text layer, cite pages |
| `wrenchbench_mark` | record short / short-to-ground / open / OK |
| `wrenchbench_checks` | deterministic ranked next suspects + a ready-to-ask question |
| `wrenchbench_focus` | move the canvas focus the technician is looking at |
| `wrenchbench_label_rail` | give an anonymous net its real rail name |
| `wrenchbench_name_part` / `wrenchbench_enrich` | confirm a part name, re-run the naming pass |

## Tests

No framework, no dependencies — each suite is a script, run in isolation:

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
