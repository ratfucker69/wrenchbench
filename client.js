// WrenchBench — Client half.
//
// A sidebar entry beside Plugins plus the matching main panel: the board
// library on the left, a boardview canvas in the middle, and the inspector /
// agent / schematic rail on the right. Every number drawn here comes from the
// Host record, which is the same record the wrenchbench_* tools answer from.
window.__ModuleLoader__.load({
  id: 'dsh-wrenchbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const ROUTE = '/api/dsh-wrenchbench'
    const NS = 'dsh-wrenchbench'

    // Dictionaries mirror locale/en.json and locale/zh.json so display text
    // follows the active locale without a second source of truth.
    const en = {
      'nav.label': 'WrenchBench',
      'nav.aria': 'WrenchBench board workbench',
      'panel.subtitle': 'Boardview · nets · schematic · agent',
      'panel.refresh': 'Refresh',
      'panel.import': 'Import boardview',
      'panel.importing': 'Parsing…',
      'panel.library': 'Boards',
      'panel.library.empty': 'No boards yet.',
      'panel.library.remove': 'Remove this board',
      'panel.empty.title': 'Open any boardview.',
      'panel.empty.accent': 'Instantly.',
      'panel.empty.body':
        'Drop a boardview file anywhere on this panel, or choose one. It is parsed on this machine and kept in your board library.',
      'panel.empty.choose': 'Choose a file',
      'panel.empty.example': 'No board at hand? Load a sample board',
      'panel.empty.formats': 'Formats read natively',
      'panel.drop': 'Drop the file to import it',
      'panel.error': 'Could not read that board',
      'panel.parseWarning': 'Parsed with warnings',
      'toolbar.search': 'Search refdes or net',
      'toolbar.searchPlaceholder': 'U7, +3V3, HDMI…',
      'toolbar.top': 'Top',
      'toolbar.both': 'Both',
      'toolbar.bottom': 'Bottom',
      'toolbar.rotateLeft': 'Rotate left (-90°)',
      'toolbar.rotateRight': 'Rotate right (+90°)',
      'toolbar.fit': 'Fit to view',
      'toolbar.showComponents': 'Show components',
      'toolbar.showPads': 'Show pads',
      'toolbar.showProbes': 'Show probe points',
      'toolbar.showNetWiring': 'Show net wiring',
      'toolbar.dim': 'Dim unrelated',
      'status.parts': 'Comp',
      'status.pins': 'Pins',
      'status.nets': 'Nets',
      'status.hover': "over a pad to read its net",
      'inspector.title': 'Selection',
      'inspector.none': 'Click a pad or search a refdes to inspect it.',
      'inspector.otherPins': 'Other pins on this net',
      'inspector.net': 'Net',
      'inspector.pins': 'Pins',
      'inspector.layer': 'Layer',
      'inspector.position': 'Position',
      'inspector.smd': 'SMD',
      'inspector.throughHole': 'Through-hole',
      'inspector.askAbout': 'Ask the agent about this',
      'agent.title': 'Agent',
      'agent.hint':
        'The question is sent to this session with the loaded board attached, so the agent answers with real refdes and nets from the canvas.',
      'agent.placeholder': 'Why would +3V3 be dead when VBUS is present?',
      'agent.send': 'Ask',
      'agent.sending': 'Sending…',
      'agent.sent': 'Sent to the agent. Open the conversation to read the answer.',
      'agent.openConversation': 'Open the conversation',
      'agent.noSession': 'There is no live session to send to yet. Start a conversation first.',
      'schematic.title': 'Schematic',
      'schematic.empty': 'Attach the schematic PDF for this board, and the agent can cite pages and nets from it.',
      'schematic.upload': 'Upload PDF',
      'schematic.uploading': 'Reading PDF…',
      'schematic.replace': 'Replace PDF',
      'schematic.search': 'Search the schematic',
      'schematic.searchPlaceholder': 'U7000, PP5V7_LCM…',
      'schematic.pages': 'pages',
      'schematic.chars': 'characters',
      'schematic.noMatches': 'No matches.',
      'schematic.page': 'Page',
      'tab.board': 'Board',
      'tab.agent': 'Agent',
      'tab.schematic': 'Schematic',
      'toolbar.rail': 'Colour by rail',
      'rail.title': 'Rail groups',
      'rail.none': 'This file names no rails and no net reaches enough pads to group one.',
      'rail.noVoltage': 'voltage not in the name',
      'rail.pads': 'pads',
      'rail.unassigned': 'no rail',
      'mark.title': 'Bench marks',
      'mark.short': 'Short',
      'mark.shortToGround': 'Short → GND',
      'mark.open': 'Open',
      'mark.ok': 'OK',
      'mark.clear': 'Clear marks',
      'mark.none': 'Nothing marked yet. Select a component, then mark what you measured.',
      'mark.needsSelection': 'Select a component or a net first.',
      'mark.marked': 'Marked',
      'rail.labelPlaceholder': 'PP1V8_S0',
      'rail.labelHint': 'click to label this rail',
      'startup.title': "New project",
      'startup.subtitle': "Point WrenchBench at the files for this board. Any file type is accepted — the payload is sniffed, and archives are unpacked.",
      'startup.boardTitle': "Boardview file",
      'startup.boardHint': "Drop it here, or click to choose. .pcb .brd .tvw .bdv .fz .cad .kicad_pcb .zip — or anything else; the format is read from the bytes, not the name.",
      'startup.boardHint2': "No boardview yet? You can still open the panel and import later.",
      'startup.schematicTitle': "Schematic or BOM (optional)",
      'startup.schematicHint': "PDF with a text layer, plain text, CSV/BOM, or a zip of those. Used to name parts the boardview left unnamed, and to cite pages.",
      'startup.skip': "Skip for now",
      'startup.later': "You can attach it any time from the Schematic tab.",
      'startup.open': "Open the board",
      'startup.another': "Import another",
      'startup.close': "Close",
      'startup.newProject': "New project",
      'startup.imported': "Imported",
      'startup.components': "components",
      'startup.padEntries': "pad entries",
      'startup.namedFromSchematic': "named from the schematic",
      'startup.needReview': "need a decision",
      'tab.triage': "Triage",
      'triage.title': "Guided triage",
      'triage.hint': "Pick the symptom, the rail, and what you measured. The panel marks it and ranks what to probe next — no typing, and it still works with the agent offline.",
      'triage.step.symptom': "What is the fault?",
      'triage.step.rail': "Which rail?",
      'triage.step.finding': "What did you measure on it?",
      'triage.symptom.noPower': "No power",
      'triage.symptom.noDisplay': "No display",
      'triage.symptom.shutdown': "Shuts down",
      'triage.symptom.liquid': "Liquid damage",
      'triage.finding.shortToGround': "Shorted to GND",
      'triage.finding.short': "Shorted between nets",
      'triage.finding.open': "Open",
      'triage.finding.unknown': "Not measured",
      'triage.apply': "Mark it",
      'triage.ask': "Ask the agent",
      'triage.focus': "Focus",
      'menu.emptySpace': "Board",
      'menu.focus': "Focus and zoom",
      'menu.clearHere': "Clear marks here",
      'menu.copyNet': "Copy net name",
      'menu.copyRefdes': "Copy refdes",
      'menu.copied': "Copied",
      'menu.onlyNet': "Isolate this net",
      'rail.labelThis': "Label this rail",
      'pinout.power': "Power",
      'pinout.ground': "GND",
      'pinout.signal': "Signals",
      'pinout.nc': "NC",
      'probe.title': "Where to probe",
      'probe.more': "more, easiest first",
      'checks.title': 'Check next',
      'checks.none': 'Mark a part or a rail to get ranked suspects.',
      'checks.asking': 'Ranking…',
      'checks.score': 'score',
      'checks.why': 'because',
    }

    const zh = {
      'nav.label': 'WrenchBench',
      'nav.aria': 'WrenchBench 主板工作台',
      'panel.subtitle': 'Boardview · 网络 · 原理图 · 智能体',
      'panel.refresh': '刷新',
      'panel.import': '导入 boardview',
      'panel.importing': '正在解析…',
      'panel.library': '主板',
      'panel.library.empty': '还没有主板。',
      'panel.library.remove': '移除此主板',
      'panel.empty.title': '打开任意 boardview。',
      'panel.empty.accent': '即刻完成。',
      'panel.empty.body': '将 boardview 文件拖到此面板任意位置，或选择文件。文件在本机解析，并保存在你的主板库中。',
      'panel.empty.choose': '选择文件',
      'panel.empty.example': '手头没有主板？载入示例主板',
      'panel.empty.formats': '原生支持的格式',
      'panel.drop': '松开即可导入',
      'panel.error': '无法读取此主板',
      'panel.parseWarning': '解析完成，但有警告',
      'toolbar.search': '搜索位号或网络',
      'toolbar.searchPlaceholder': 'U7、+3V3、HDMI…',
      'toolbar.top': '顶层',
      'toolbar.both': '双面',
      'toolbar.bottom': '底层',
      'toolbar.rotateLeft': '向左旋转（-90°）',
      'toolbar.rotateRight': '向右旋转（+90°）',
      'toolbar.fit': '适应视图',
      'toolbar.showComponents': '显示元件',
      'toolbar.showPads': '显示焊盘',
      'toolbar.showProbes': '显示测试点',
      'toolbar.showNetWiring': '显示网络连线',
      'toolbar.dim': '淡化无关项',
      'status.parts': '元件',
      'status.pins': '引脚',
      'status.nets': '网络',
      'status.hover': "悬停焊盘查看网络",
      'inspector.title': '选中项',
      'inspector.none': '点击焊盘或搜索位号以查看详情。',
      'inspector.otherPins': '同一网络上的其他引脚',
      'inspector.net': '网络',
      'inspector.pins': '引脚',
      'inspector.layer': '层',
      'inspector.position': '坐标',
      'inspector.smd': '贴片',
      'inspector.throughHole': '通孔',
      'inspector.askAbout': '就此询问智能体',
      'agent.title': '智能体',
      'agent.hint': '问题会连同当前主板一起发送到本会话，智能体将基于画布中真实的位号和网络作答。',
      'agent.placeholder': '为什么 VBUS 正常时 +3V3 却无输出？',
      'agent.send': '提问',
      'agent.sending': '发送中…',
      'agent.sent': '已发送给智能体。打开会话查看回答。',
      'agent.openConversation': '打开会话',
      'agent.noSession': '尚无可发送的活动会话。请先开始一个对话。',
      'schematic.title': '原理图',
      'schematic.empty': '为该主板附加原理图 PDF，智能体便能引用其中的页码与网络。',
      'schematic.upload': '上传 PDF',
      'schematic.uploading': '正在读取 PDF…',
      'schematic.replace': '替换 PDF',
      'schematic.search': '搜索原理图',
      'schematic.searchPlaceholder': 'U7000、PP5V7_LCM…',
      'schematic.pages': '页',
      'schematic.chars': '字符',
      'schematic.noMatches': '没有匹配项。',
      'schematic.page': '第',
      'tab.board': '主板',
      'tab.agent': '智能体',
      'tab.schematic': '原理图',
      'toolbar.rail': '按电源轨着色',
      'rail.title': '电源轨分组',
      'rail.none': '该文件未命名电源轨，也没有网络的焊盘数量足以分组。',
      'rail.noVoltage': '名称中无电压',
      'rail.pads': '焊盘',
      'rail.unassigned': '无电源轨',
      'mark.title': '工位标记',
      'mark.short': '短路',
      'mark.shortToGround': '短路→地',
      'mark.open': '断路',
      'mark.ok': '正常',
      'mark.clear': '清除标记',
      'mark.none': '尚无标记。选中一个元件，然后标记你的测量结果。',
      'mark.needsSelection': '请先选中元件或网络。',
      'mark.marked': '已标记',
      'rail.labelPlaceholder': 'PP1V8_S0',
      'rail.labelHint': '点击为该电源轨命名',
      'startup.title': "新建项目",
      'startup.subtitle': "把这块主板的文件交给 WrenchBench。任何文件类型都接受——按内容识别格式，压缩包会自动解包。",
      'startup.boardTitle': "点位图文件",
      'startup.boardHint': "拖到此处，或点击选择。.pcb .brd .tvw .bdv .fz .cad .kicad_pcb .zip——或其他任意文件；格式按字节判断，不看扩展名。",
      'startup.boardHint2': "暂时没有点位图？也可以先打开面板，稍后再导入。",
      'startup.schematicTitle': "原理图或物料表（可选）",
      'startup.schematicHint': "带文字层的 PDF、纯文本、CSV/物料表，或它们的压缩包。用于为点位图中未命名的元件命名，并引用页码。",
      'startup.skip': "暂时跳过",
      'startup.later': "随时可以在“原理图”标签页中附加。",
      'startup.open': "打开主板",
      'startup.another': "继续导入",
      'startup.close': "关闭",
      'startup.newProject': "新建项目",
      'startup.imported': "已导入",
      'startup.components': "元件",
      'startup.padEntries': "焊盘条目",
      'startup.namedFromSchematic': "已按原理图命名",
      'startup.needReview': "待确认",
      'tab.triage': "排查",
      'triage.title': "引导排查",
      'triage.hint': "选择故障现象、电源轨和实测结果。面板会记录并排序下一步要探的位置——无需输入，离线也可用。",
      'triage.step.symptom': "故障现象",
      'triage.step.rail': "哪条电源轨",
      'triage.step.finding': "实测结果",
      'triage.symptom.noPower': "不上电",
      'triage.symptom.noDisplay': "无显示",
      'triage.symptom.shutdown': "自动关机",
      'triage.symptom.liquid': "进液",
      'triage.finding.shortToGround': "对地短路",
      'triage.finding.short': "网络间短路",
      'triage.finding.open': "开路",
      'triage.finding.unknown': "未测量",
      'triage.apply': "记录",
      'triage.ask': "询问智能体",
      'triage.focus': "定位",
      'menu.emptySpace': "主板",
      'menu.focus': "定位并缩放",
      'menu.clearHere': "清除此处标记",
      'menu.copyNet': "复制网络名",
      'menu.copyRefdes': "复制位号",
      'menu.copied': "已复制",
      'menu.onlyNet': "只看此网络",
      'rail.labelThis': "为该电源轨命名",
      'pinout.power': "供电",
      'pinout.ground': "地",
      'pinout.signal': "信号",
      'pinout.nc': "空脚",
      'probe.title': "探针位置",
      'probe.more': "更多，优先易探点",
      'checks.title': '下一步检查',
      'checks.none': '标记元件或电源轨以获得排序后的嫌疑列表。',
      'checks.asking': '排序中…',
      'checks.score': '评分',
      'checks.why': '理由',
    }

    // ---------------------------------------------------------------------
    // Style tokens — aliases only, so a renamed token degrades appearance but
    // never breaks rendering.
    // ---------------------------------------------------------------------

    const T = {
      border: '1px solid var(--dsw-alias-border-l1, color-mix(in srgb, currentColor 16%, transparent))',
      borderStrong: '1px solid var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 26%, transparent))',
      muted: 'var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 62%, transparent))',
      layer1: 'var(--dsw-alias-bg-layer-1, color-mix(in srgb, currentColor 6%, transparent))',
      layer2: 'var(--dsw-alias-bg-layer-2, color-mix(in srgb, currentColor 10%, transparent))',
      brand: 'var(--dsw-alias-brand-primary, #3f8fa8)',
      danger: 'var(--dsw-alias-state-error-primary, #c25b52)',
      mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    }

    const BUTTON = {
      appearance: 'none',
      border: T.border,
      borderRadius: 8,
      background: 'transparent',
      color: 'inherit',
      fontSize: 12,
      padding: '5px 10px',
      cursor: 'pointer',
      fontFamily: 'inherit',
    }

    const INPUT = {
      appearance: 'none',
      border: T.border,
      borderRadius: 8,
      background: 'transparent',
      color: 'inherit',
      fontSize: 12,
      padding: '5px 8px',
      fontFamily: 'inherit',
      outline: 'none',
    }

    const PANEL_CSS = `
[data-wrenchbench] ::-webkit-scrollbar { width: 8px; height: 8px }
[data-wrenchbench] ::-webkit-scrollbar-thumb { background: color-mix(in srgb, currentColor 22%, transparent); border-radius: 999px }
[data-wrenchbench] ::-webkit-scrollbar-track { background: transparent }
[data-wrenchbench] button:hover:not(:disabled) { background: color-mix(in srgb, currentColor 8%, transparent) }
[data-wrenchbench] button:disabled { opacity: .45; cursor: default }
[data-wrenchbench] input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #3f8fa8); outline-offset: 1px }
[data-wrenchbench] .wb-canvas { cursor: grab; touch-action: none }
[data-wrenchbench] .wb-canvas[data-panning="1"] { cursor: grabbing }
[data-wrenchbench] .wb-row:hover { background: color-mix(in srgb, currentColor 7%, transparent) }
[data-wrenchbench] .wb-chip { flex: none; border-radius: 999px; padding: 1px 7px; font-size: 10px;
  border: 1px solid var(--dsw-alias-border-l1, color-mix(in srgb, currentColor 16%, transparent));
  color: var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 62%, transparent)) }
`

    /** Sidebar icon: a chip on a board, with a probe pad in each corner. */
    function Icon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 18
      const active = Boolean(props && props.active)
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block', opacity: active ? 1 : 0.85 },
        },
        h('rect', { x: 2.6, y: 2.6, width: 18.8, height: 18.8, rx: 3.1 }),
        h('rect', { x: 8.6, y: 8.6, width: 6.8, height: 6.8, rx: 1.2 }),
        h('path', { d: 'M8.6 10.5H6.7M8.6 13.2H6.7M15.4 10.5h1.9M15.4 13.2h1.9' }),
        h('path', { d: 'M10.5 8.6V6.7M13.2 8.6V6.7M10.5 15.4v1.9M13.2 15.4v1.9' }),
        h('circle', { cx: 4.7, cy: 4.7, r: 0.9, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 19.3, cy: 19.3, r: 0.9, fill: 'currentColor', stroke: 'none' }),
      )
    }

    // ---------------------------------------------------------------------
    // Host access
    // ---------------------------------------------------------------------

    async function getJson(url) {
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error((body && (body.error || body.hint)) || `${url} ${response.status}`)
      return body
    }

    async function sendJson(url, method, payload) {
      const response = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error((body && (body.error || body.hint)) || `${url} ${response.status}`)
      return body
    }

    async function postFile(url, file) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: file,
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error((body && (body.error || body.hint)) || `${url} ${response.status}`)
      return body
    }

    // ---------------------------------------------------------------------
    // Canvas maths
    // ---------------------------------------------------------------------

    const clamp = (value, low, high) => Math.min(Math.max(value, low), high)

    function boundsOf(board) {
      const bounds = board.bounds ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 }
      return bounds
    }

    function fitZoom(board, width, height, rotation) {
      const bounds = boundsOf(board)
      const boardWidth = Math.max(bounds.maxX - bounds.minX, 1e-6)
      const boardHeight = Math.max(bounds.maxY - bounds.minY, 1e-6)
      const turn = Math.abs(Math.round(rotation / (Math.PI / 2))) % 2 === 1
      const effectiveWidth = turn ? boardHeight : boardWidth
      const effectiveHeight = turn ? boardWidth : boardHeight
      if (width <= 0 || height <= 0) return 1
      return Math.min(width / effectiveWidth, height / effectiveHeight) * 0.92
    }

    function projectPoint(board, view, width, height, x, y) {
      const bounds = boundsOf(board)
      const centreX = (bounds.minX + bounds.maxX) / 2
      const centreY = (bounds.minY + bounds.maxY) / 2
      const flip = view.side === 'bottom' ? -1 : 1
      const dx = x - centreX
      const dy = (y - centreY) * flip
      const cos = Math.cos(view.rotation)
      const sin = Math.sin(view.rotation)
      return {
        x: width / 2 + view.panX + (dx * cos - dy * sin) * view.zoom,
        y: height / 2 + view.panY + (dx * sin + dy * cos) * view.zoom,
      }
    }

    function unprojectPoint(board, view, width, height, screenX, screenY) {
      const bounds = boundsOf(board)
      const centreX = (bounds.minX + bounds.maxX) / 2
      const centreY = (bounds.minY + bounds.maxY) / 2
      const flip = view.side === 'bottom' ? -1 : 1
      const dx = (screenX - width / 2 - view.panX) / view.zoom
      const dy = (screenY - height / 2 - view.panY) / view.zoom
      const cos = Math.cos(-view.rotation)
      const sin = Math.sin(-view.rotation)
      return { x: centreX + dx * cos - dy * sin, y: centreY + (dx * sin + dy * cos) * flip }
    }

    function themeColors(element) {
      let style
      try {
        style = window.getComputedStyle(element)
      } catch {
        style = null
      }
      const read = (name, fallback) => {
        const value = style ? style.getPropertyValue(name).trim() : ''
        return value.length > 0 ? value : fallback
      }
      return {
        background: read('--dsw-alias-bg-base', '#f4f7f9'),
        boardFill: read('--dsw-alias-bg-layer-2', 'rgba(120,150,170,0.07)'),
        border: read('--dsw-alias-border-l2', 'rgba(90,120,140,0.45)'),
        borderSoft: read('--dsw-alias-border-l1', 'rgba(90,120,140,0.22)'),
        label: read('--dsw-alias-label-primary', '#243038'),
        labelMuted: read('--dsw-alias-label-secondary', 'rgba(60,80,92,0.62)'),
        brand: read('--dsw-alias-brand-primary', '#3f8fa8'),
        accent: read('--dsw-alias-state-warn-primary', '#d19a3c'),
        good: read('--dsw-alias-state-success-primary', '#3f9e6b'),
        bad: read('--dsw-alias-state-error-primary', '#c25b52'),
        padTop: read('--dsw-alias-brand-primary', '#c9a227'),
        padBottom: read('--dsw-alias-label-secondary', 'rgba(120,140,160,0.75)'),
        // Component symbol surfaces. The body is a wash so the pads and the
        // refdes stay the loudest things on the canvas, and the terminal bars
        // read as metal rather than as another outline.
        partBody: read('--dsw-alias-bg-layer-1', 'rgba(255,255,255,0.55)'),
        partTerminal: read('--dsw-alias-label-secondary', 'rgba(90,110,128,0.55)'),
        partBand: read('--dsw-alias-state-error-primary', '#c25b52'),
      }
    }

    // ---------------------------------------------------------------------
    // The canvas renderer
    // ---------------------------------------------------------------------

    // ---------------------------------------------------------------------
    // Component symbols
    // ---------------------------------------------------------------------

    /**
     * Footprint family from a refdes.
     *
     * A boardview stores a rectangle per part and nothing about the body, so
     * the only honest way to draw something recognisable is to use the
     * designator prefix — which on every schematic convention already encodes
     * the family. This is presentation only: nothing downstream reads it.
     */
    function familyOfRefdes(refdes, pins) {
      const prefix = (String(refdes ?? '').toUpperCase().match(/^[A-Z]+/) ?? [''])[0]
      if (prefix === 'FB' || prefix === 'F' || prefix === 'R' || prefix === 'PR' || prefix === 'VR') return 'resistor'
      if (prefix === 'C' || prefix === 'PC' || prefix === 'TC' || prefix === 'EC') return 'capacitor'
      if (prefix === 'L' || prefix === 'PL' || prefix === 'FL' || prefix === 'CH') return 'inductor'
      if (prefix === 'D' || prefix === 'LED' || prefix === 'ZD' || prefix === 'VD') return 'diode'
      if (prefix === 'Q' || prefix === 'T' || prefix === 'TR') return 'transistor'
      if (prefix === 'Y' || prefix === 'X' || prefix === 'XTAL') return 'crystal'
      if (prefix === 'J' || prefix === 'CN' || prefix === 'CON' || prefix === 'P' || prefix === 'SH') return 'connector'
      if (prefix === 'SW' || prefix === 'S' || prefix === 'BT' || prefix === 'BZ') return 'switch'
      if (prefix === 'U' || prefix === 'IC' || prefix === 'PU' || prefix === 'SOC') return 'ic'
      // An unnamed multi-pad body is a chip; an unnamed two-pad body is not
      // worth guessing about, so it stays a plain block.
      if (prefix === 'N') return Number(pins) > 3 ? 'ic' : 'generic'
      return 'generic'
    }

    /** A rounded rectangle path in the current transform. */
    function roundedRect(context, x, y, w, h, radius, onePx) {
      const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2))
      if (r < onePx * 1.5) {
        context.rect(x, y, w, h)
        return
      }
      context.moveTo(x + r, y)
      context.lineTo(x + w - r, y)
      context.quadraticCurveTo(x + w, y, x + w, y + r)
      context.lineTo(x + w, y + h - r)
      context.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
      context.lineTo(x + r, y + h)
      context.quadraticCurveTo(x, y + h, x, y + h - r)
      context.lineTo(x, y + r)
      context.quadraticCurveTo(x, y, x + r, y)
    }

    /**
     * Draw one component as something a technician recognises.
     *
     * These are footprint symbols, not schematic symbols: a ceramic capacitor is
     * a body with two metal end caps, a resistor the same with a flat body, an
     * inductor gets its coil, a diode its cathode band, and a chip its pin-1
     * dot and pin fingers. That is what the physical part looks like from
     * above, which is what the technician is comparing against.
     *
     * Everything is drawn inside the part's own bounding box, so a symbol can
     * never claim space the board says the part does not occupy.
     */
    function paintPartSymbol(context, box, family, style, onePx) {
      const { body, stroke, terminal, band, pinned } = style
      const w = box.x2 - box.x1
      const h = box.y2 - box.y1
      const horizontal = w >= h
      const long = horizontal ? w : h
      const short = horizontal ? h : w

      // A two-terminal body: metal caps at each end, body between them.
      const capThickness = Math.max(short * 0.16, onePx * 1.2)
      const bodyStart = horizontal ? box.x1 + capThickness : box.y1 + capThickness
      const bodyEnd = horizontal ? box.x2 - capThickness : box.y2 - capThickness

      context.beginPath()
      if (family === 'resistor' || family === 'capacitor' || family === 'inductor' || family === 'diode') {
        // Body.
        roundedRect(
          context,
          horizontal ? bodyStart : box.x1,
          horizontal ? box.y1 : bodyStart,
          horizontal ? bodyEnd - bodyStart : w,
          horizontal ? h : bodyEnd - bodyStart,
          Math.min(short * 0.22, onePx * 3),
          onePx,
        )
        context.fillStyle = body
        context.fill()
        context.strokeStyle = stroke
        context.lineWidth = onePx
        context.stroke()

        // End caps.
        context.beginPath()
        if (horizontal) {
          context.rect(box.x1, box.y1, capThickness * 0.85, h)
          context.rect(box.x2 - capThickness * 0.85, box.y1, capThickness * 0.85, h)
        } else {
          context.rect(box.x1, box.y1, w, capThickness * 0.85)
          context.rect(box.x1, box.y2 - capThickness * 0.85, w, capThickness * 0.85)
        }
        context.fillStyle = terminal
        context.fill()

        // Family detail inside the body.
        const midX = (box.x1 + box.x2) / 2
        const midY = (box.y1 + box.y2) / 2
        context.beginPath()
        if (family === 'capacitor') {
          // Two plates, the universal cap read.
          const gap = Math.max(long * 0.05, onePx * 1.2)
          if (horizontal) {
            context.moveTo(midX - gap, box.y1 + h * 0.18)
            context.lineTo(midX - gap, box.y2 - h * 0.18)
            context.moveTo(midX + gap, box.y1 + h * 0.18)
            context.lineTo(midX + gap, box.y2 - h * 0.18)
          } else {
            context.moveTo(box.x1 + w * 0.18, midY - gap)
            context.lineTo(box.x2 - w * 0.18, midY - gap)
            context.moveTo(box.x1 + w * 0.18, midY + gap)
            context.lineTo(box.x2 - w * 0.18, midY + gap)
          }
          context.strokeStyle = stroke
          context.lineWidth = onePx * 1.2
          context.stroke()
        } else if (family === 'diode') {
          // Cathode band near one end.
          context.strokeStyle = band
          context.lineWidth = Math.max(capThickness * 0.7, onePx * 1.6)
          if (horizontal) {
            const bandX = box.x2 - capThickness * 2
            context.moveTo(bandX, box.y1 + h * 0.12)
            context.lineTo(bandX, box.y2 - h * 0.12)
          } else {
            const bandY = box.y2 - capThickness * 2
            context.moveTo(box.x1 + w * 0.12, bandY)
            context.lineTo(box.x2 - w * 0.12, bandY)
          }
          context.stroke()
        } else if (family === 'inductor') {
          // Three coil bumps along the outer edge.
          context.strokeStyle = stroke
          context.lineWidth = onePx
          const bumps = 3
          const span = (horizontal ? bodyEnd - bodyStart : bodyEnd - bodyStart) / bumps
          for (let index = 0; index < bumps; index += 1) {
            const from = bodyStart + span * index
            if (horizontal) {
              context.moveTo(from, box.y1)
              context.quadraticCurveTo(from + span / 2, box.y1 - short * 0.42, from + span, box.y1)
            } else {
              context.moveTo(box.x1, from)
              context.quadraticCurveTo(box.x1 - short * 0.42, from + span / 2, box.x1, from + span)
            }
          }
          context.stroke()
        }
        return
      }

      if (family === 'transistor') {
        roundedRect(context, box.x1, box.y1, w, h, Math.min(short * 0.3, onePx * 3), onePx)
        context.fillStyle = body
        context.fill()
        context.strokeStyle = stroke
        context.lineWidth = onePx
        context.stroke()
        // Chamfer marking the collector corner.
        context.beginPath()
        const cut = Math.min(w, h) * 0.3
        context.moveTo(box.x1 + w - cut, box.y1)
        context.lineTo(box.x1 + w - cut * 0.35, box.y1 + cut * 0.35)
        context.strokeStyle = stroke
        context.stroke()
        return
      }

      if (family === 'crystal') {
        roundedRect(context, box.x1, box.y1, w, h, Math.min(short * 0.35, onePx * 3), onePx)
        context.fillStyle = body
        context.fill()
        context.strokeStyle = stroke
        context.lineWidth = onePx
        context.stroke()
        // Inner resonator plates.
        context.beginPath()
        const inset = Math.min(w, h) * 0.26
        context.rect(box.x1 + inset, box.y1 + inset, w - inset * 2, h - inset * 2)
        context.stroke()
        return
      }

      // Chips, connectors, switches and everything else: a body with pin-1.
      roundedRect(context, box.x1, box.y1, w, h, Math.min(short * 0.12, onePx * 3), onePx)
      context.fillStyle = body
      context.fill()
      context.strokeStyle = stroke
      context.lineWidth = onePx
      context.stroke()

      if (pinned && Math.max(w, h) * style.zoom > 26) {
        // Pin-1 dot, then pin fingers so a fine-pitch package reads as one.
        const dotR = Math.max(Math.min(w, h) * 0.09, onePx * 1.4)
        context.beginPath()
        context.arc(box.x1 + short * 0.2, box.y1 + short * 0.2, dotR, 0, Math.PI * 2)
        context.fillStyle = stroke
        context.fill()

        context.beginPath()
        const tick = Math.max(short * 0.14, onePx * 1.6)
        const perSide = Math.min(28, Math.max(2, Math.round(style.pins / 4)))
        for (let index = 0; index < perSide; index += 1) {
          const fraction = (index + 0.5) / perSide
          const x = box.x1 + w * fraction
          const y = box.y1 + h * fraction
          context.rect(x - onePx, box.y1, onePx * 2, tick)
          context.rect(x - onePx, box.y2 - tick, onePx * 2, tick)
          if (style.pins > 8) {
            context.rect(box.x1, y - onePx, tick, onePx * 2)
            context.rect(box.x2 - tick, y - onePx, tick, onePx * 2)
          }
        }
        context.fillStyle = terminal
        context.fill()
      }
    }

    /**
     * Draw one board scene.
     *
     * Geometry is drawn in board coordinates through a canvas transform; text
     * is drawn afterwards in screen space so flipped or rotated views keep
     * readable labels.
     */
    function drawScene(canvas, doc, view, ui, selection, overlay) {
      if (!canvas || !doc) return
      const railColour = overlay?.railColour ?? new Map()
      const railMap = overlay?.railMap ?? null
      const suspectRank = overlay?.suspectRank ?? new Map()
      const markedParts = overlay?.marks ?? new Map()
  // A part the boardview could not name is drawn with the name established
  // from the schematic or the bench, and keeps its raw label otherwise.
  const partAliases = overlay?.aliases ?? null
  const aliasOf = (part) => (partAliases ? partAliases[part.refdes]?.alias ?? part.refdes : part.refdes)
      const context = canvas.getContext('2d')
      if (!context) return

      const ratio = window.devicePixelRatio || 1
      const width = Math.max(1, canvas.clientWidth)
      const height = Math.max(1, canvas.clientHeight)
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
      }

      const theme = themeColors(canvas)
      const board = doc.board
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      context.fillStyle = theme.background
      context.fillRect(0, 0, width, height)

      const bounds = boundsOf(board)
      const centreX = (bounds.minX + bounds.maxX) / 2
      const centreY = (bounds.minY + bounds.maxY) / 2
      const flip = view.side === 'bottom' ? -1 : 1
      const zoom = view.zoom
      const topOnly = view.side === 'top'
      const bottomOnly = view.side === 'bottom'

      const highlightsNet = selection.net ? String(selection.net) : null
      const highlightPins = new Set()
      if (highlightsNet) {
        const net = board.nets.find((entry) => entry.name === highlightsNet)
        if (net) for (const index of net.pins) highlightPins.add(index)
      }
      const highlightRefdes = selection.refdes ? String(selection.refdes).toUpperCase() : null
      const highlightedPartIndex =
        highlightRefdes === null ? -1 : board.parts.findIndex((part) => part.refdes.toUpperCase() === highlightRefdes)

      const dimming = ui.dim && (highlightRefdes !== null || highlightsNet !== null)
      const alphaFor = (pin) => {
        if (!dimming) return 1
        if (highlightPins.has(pin.pinIndex)) return 1
        if (pin.part === highlightedPartIndex) return 1
        return 0.12
      }

      // Geometry pass: everything below is in board coordinates.
      context.save()
      context.translate(width / 2 + view.panX, height / 2 + view.panY)
      context.scale(zoom, zoom)
      context.rotate(view.rotation)
      context.scale(1, flip)
      context.translate(-centreX, -centreY)

      const onePx = 1 / zoom

      // Board edge.
      if (Array.isArray(board.outline) && board.outline.length > 2) {
        context.beginPath()
        board.outline.forEach((point, index) => {
          if (index === 0) context.moveTo(point.x, point.y)
          else context.lineTo(point.x, point.y)
        })
        context.closePath()
        context.fillStyle = theme.boardFill
        context.fill()
        context.strokeStyle = theme.border
        context.lineWidth = 1.6 * onePx
        context.stroke()
      }
      if (Array.isArray(board.edges) && board.edges.length > 0) {
        context.beginPath()
        for (const edge of board.edges) {
          context.moveTo(edge.x1, edge.y1)
          context.lineTo(edge.x2, edge.y2)
        }
        context.strokeStyle = theme.border
        context.lineWidth = 1.6 * onePx
        context.stroke()
      }

      // Net wiring: a star from the net centroid, drawn under the pads.
      if (ui.showNetWiring && highlightsNet) {
        const net = board.nets.find((entry) => entry.name === highlightsNet)
        if (net && net.pins.length > 1) {
          let sumX = 0
          let sumY = 0
          const points = []
          for (const pinIndex of net.pins) {
            const pin = board.pins[pinIndex]
            if (!pin) continue
            if (topOnly && pin.layer !== 'top') continue
            if (bottomOnly && pin.layer !== 'bottom') continue
            points.push(pin)
            sumX += pin.x
            sumY += pin.y
          }
          if (points.length > 1) {
            const cx = sumX / points.length
            const cy = sumY / points.length
            context.beginPath()
            for (const point of points) {
              context.moveTo(cx, cy)
              context.lineTo(point.x, point.y)
            }
            context.strokeStyle = theme.good
            context.globalAlpha = 0.42
            context.lineWidth = 0.9 * onePx
            context.stroke()
            context.globalAlpha = 1
          }
        }
      }

      // Components, drawn as footprint symbols.
      if (ui.showComponents) {
        context.lineWidth = onePx
        for (let partIndex = 0; partIndex < board.parts.length; partIndex += 1) {
          const part = board.parts[partIndex]
          if (part.pins === 0) continue
          if (topOnly && part.layer !== 'top') continue
          if (bottomOnly && part.layer !== 'bottom') continue
          const box = part.bbox
          if (!box || (box.x1 === box.x2 && box.y1 === box.y2)) continue

          // Cull in screen space: a board has thousands of parts and only the
          // visible ones are worth building a path for.
          const screenWidth = (box.x2 - box.x1) * zoom
          const screenHeight = (box.y2 - box.y1) * zoom
          if (screenWidth < 3 && screenHeight < 3) continue

          const isSelected = partIndex === highlightedPartIndex
          if (dimming && !isSelected) context.globalAlpha = 0.18
          const railTint = ui.railColour ? railColour.get(railMap?.get(partIndex)) : undefined
          const stroke = isSelected ? theme.accent : railTint ?? theme.borderSoft
          const weight = (isSelected ? 1.8 : railTint ? 1.3 : 0.9) * onePx

          if (Math.max(screenWidth, screenHeight) < 9) {
            // Too small for a symbol to read: a solid block keeps the board's
            // density legible instead of turning into a smear of outlines.
            context.fillStyle = railTint ?? theme.borderSoft
            context.globalAlpha = isSelected ? 1 : dimming ? 0.25 : 0.7
            context.fillRect(box.x1, box.y1, Math.max(box.x2 - box.x1, onePx * 2), Math.max(box.y2 - box.y1, onePx * 2))
            context.globalAlpha = 1
            continue
          }

          paintPartSymbol(
            context,
            box,
            familyOfRefdes(part.refdes, part.pins),
            {
              body: theme.partBody,
              stroke,
              terminal: railTint ?? theme.partTerminal,
              band: theme.partBand,
              pinned: part.pins > 4,
              pins: part.pins,
              zoom,
            },
            weight,
          )
          context.globalAlpha = 1
        }
      }

      // Pads. Drawn in screen-constant size so a 0201 stays clickable at fit
      // zoom, and batched per colour so a 15 000-pad board is a handful of fills
      // rather than 15 000 separate paths.
      if (ui.showPads) {
        const halfSize = clamp(3.1 / Math.max(zoom, 1e-6), 0.3, 60)
        const buckets = new Map()
        const push = (colour, x, y) => {
          let list = buckets.get(colour)
          if (!list) {
            list = []
            buckets.set(colour, list)
          }
          list.push(x, y)
        }
        for (let index = 0; index < board.pins.length; index += 1) {
          const pin = board.pins[index]
          if (topOnly && pin.layer !== 'top') continue
          if (bottomOnly && pin.layer !== 'bottom') continue
          const isNetPin = highlightPins.has(index)
          const isPartPin = pin.part === highlightedPartIndex
          if (dimming && !isNetPin && !isPartPin) continue
          let colour
          if (isNetPin) colour = theme.good
          else if (isPartPin) colour = theme.accent
          else if (ui.railColour && pin.net && railColour.has(pin.net)) colour = railColour.get(pin.net)
          else colour = pin.layer === 'top' ? theme.padTop : theme.padBottom
          push(colour, pin.x, pin.y)
        }
        const radius = halfSize * 0.42
        for (const [colour, points] of buckets) {
          context.beginPath()
          for (let index = 0; index < points.length; index += 2) {
            roundedRect(
              context,
              points[index] - halfSize,
              points[index + 1] - halfSize,
              halfSize * 2,
              halfSize * 2,
              radius,
              onePx,
            )
          }
          context.fillStyle = colour
          context.fill()
          // A hairline ring keeps touching pads separable on a dense pitch.
          if (halfSize * zoom >= 2.5) {
            context.strokeStyle = theme.background
            context.lineWidth = onePx * 0.7
            context.stroke()
          }
        }
      }

      // Hovered pad: a ring outside the pad so the target is obvious before a
      // click, which is what makes a dense pitch usable with a mouse.
      if (overlay?.hoverPin) {
        const ringRadius = clamp(7 / Math.max(zoom, 1e-6), 0.4, 80)
        context.beginPath()
        context.arc(overlay.hoverPin.x, overlay.hoverPin.y, ringRadius, 0, Math.PI * 2)
        context.strokeStyle = theme.accent
        context.lineWidth = 1.6 * onePx
        context.stroke()
      }

      // Probe points (nails): a ring, so they read differently from pads.
      if (ui.showProbes && Array.isArray(board.nails) && board.nails.length > 0) {
        const radius = clamp(2.4 / Math.max(zoom, 1e-6), 0.4, 60)
        context.strokeStyle = theme.labelMuted
        context.lineWidth = onePx
        for (const nail of board.nails) {
          if (topOnly && nail.side !== 'top') continue
          if (bottomOnly && nail.side !== 'bottom') continue
          context.beginPath()
          context.arc(nail.x, nail.y, radius, 0, Math.PI * 2)
          context.stroke()
        }
      }

      context.restore()

      // --- labels, in screen space -----------------------------------------
      context.save()
      context.font = '10px ui-sans-serif, system-ui, -apple-system, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'

      if (ui.showComponents && zoom * (bounds.maxX - bounds.minX) > 220) {
        for (let partIndex = 0; partIndex < board.parts.length; partIndex += 1) {
          const part = board.parts[partIndex]
          if (part.pins === 0) continue
          if (topOnly && part.layer !== 'top') continue
          if (bottomOnly && part.layer !== 'bottom') continue
          const box = part.bbox
          // Label only what is legible: a big package at this zoom, or a very
          // large part. Labelling every 0402 at once would be unreadable.
          const onScreen = Math.max(box.x2 - box.x1, box.y2 - box.y1) * zoom
          if (onScreen < 10 && part.pins < 40) continue
          const screen = projectPoint(board, view, width, height, (box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2)
          if (screen.x < -40 || screen.x > width + 40 || screen.y < -20 || screen.y > height + 20) continue
          const isSelected = partIndex === highlightedPartIndex
          context.globalAlpha = dimming && !isSelected ? 0.2 : isSelected ? 1 : 0.82
          context.fillStyle = isSelected ? theme.accent : theme.labelMuted
          context.font = isSelected
            ? '600 11px ui-sans-serif, system-ui, -apple-system, sans-serif'
            : '10px ui-sans-serif, system-ui, -apple-system, sans-serif'
          context.fillText(aliasOf(part), screen.x, screen.y)
        }
        context.globalAlpha = 1
      }

      // Bench marks and ranked suspects, in screen space so a ring and a
      // number stay legible at any zoom.
      for (const [partIndex, kind] of markedParts) {
        const part = board.parts[partIndex]
        if (!part) continue
        const box = part.bbox
        const centre = projectPoint(board, view, width, height, (box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2)
        const span = Math.max((box.x2 - box.x1) * zoom, (box.y2 - box.y1) * zoom)
        const radius = Math.max(span / 2 + 7, 13)
        context.beginPath()
        context.arc(centre.x, centre.y, radius, 0, Math.PI * 2)
        context.strokeStyle = kind === 'ok' ? theme.good : theme.bad
        context.lineWidth = 2.2
        if (kind === 'open') context.setLineDash([4, 3])
        context.stroke()
        context.setLineDash([])
      }

      if (suspectRank.size > 0) {
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        for (const [partIndex, rank] of suspectRank) {
          const part = board.parts[partIndex]
          if (!part) continue
          const box = part.bbox
          const centre = projectPoint(board, view, width, height, (box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2)
          const offset = Math.max(Math.max((box.x2 - box.x1) * zoom, (box.y2 - box.y1) * zoom) / 2 + 10, 13)
          const badgeX = centre.x + offset * 0.72
          const badgeY = centre.y - offset * 0.72
          context.beginPath()
          context.arc(badgeX, badgeY, 8.5, 0, Math.PI * 2)
          context.fillStyle = rank === 1 ? theme.bad : theme.brand
          context.fill()
          context.fillStyle = theme.background
          context.font = '600 10px ui-sans-serif, system-ui, -apple-system, sans-serif'
          context.fillText(String(rank), badgeX, badgeY + 0.5)
        }
      }

      // Focus annotation the agent asked for.
      if (selection.annotation && highlightRefdes) {
        const partIndex = board.parts.findIndex((part) => part.refdes.toUpperCase() === highlightRefdes)
        if (partIndex >= 0) {
          const box = board.parts[partIndex].bbox
          const anchor = projectPoint(board, view, width, height, box.x2, box.y1)
          const text = String(selection.annotation)
          context.font = '11px ui-sans-serif, system-ui, -apple-system, sans-serif'
          context.textAlign = 'left'
          const metrics = context.measureText(text)
          const padding = 5
          context.fillStyle = theme.background
          context.globalAlpha = 0.92
          context.fillRect(anchor.x + 8, anchor.y - 20, metrics.width + padding * 2, 18)
          context.globalAlpha = 1
          context.strokeStyle = theme.accent
          context.lineWidth = 1
          context.strokeRect(anchor.x + 8, anchor.y - 20, metrics.width + padding * 2, 18)
          context.fillStyle = theme.label
          context.fillText(text, anchor.x + 8 + padding, anchor.y - 11)
        }
      }

      context.restore()
    }

    // ---------------------------------------------------------------------
    // Small presentational pieces
    // ---------------------------------------------------------------------

    function ToolbarButton(props) {
      const [hover, setHover] = React.useState(false)
      const active = Boolean(props.active)
      return h(
        'button',
        {
          type: 'button',
          title: props.title,
          'aria-label': props.title,
          'aria-pressed': props.toggle ? (active ? 'true' : 'false') : undefined,
          disabled: props.disabled,
          onClick: props.onClick,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            appearance: 'none',
            border: 'none',
            borderRadius: 7,
            width: props.wide ? 'auto' : 28,
            height: 28,
            padding: props.wide ? '0 9px' : 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            fontSize: 12,
            fontFamily: 'inherit',
            cursor: props.disabled ? 'default' : 'pointer',
            color: 'inherit',
            background: active
              ? 'color-mix(in srgb, currentColor 16%, transparent)'
              : hover
                ? 'color-mix(in srgb, currentColor 9%, transparent)'
                : 'transparent',
            opacity: props.disabled ? 0.4 : 1,
          },
        },
        props.children,
      )
    }

    function IconGlyph(props) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 15,
          height: 15,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        props.children,
      )
    }

    const GLYPH = {
      search: () => [h('circle', { key: 'c', cx: 11, cy: 11, r: 6.4 }), h('path', { key: 'p', d: 'm20 20-3.6-3.6' })],
      rotateLeft: () => [h('path', { key: 'a', d: 'M4 10a8 8 0 1 0 3-6.2' }), h('path', { key: 'b', d: 'M4 4v6h6' })],
      rotateRight: () => [h('path', { key: 'a', d: 'M20 10a8 8 0 1 1-3-6.2' }), h('path', { key: 'b', d: 'M20 4v6h-6' })],
      fit: () => [
        h('path', { key: 'a', d: 'M4 9V5h4' }),
        h('path', { key: 'b', d: 'M20 9V5h-4' }),
        h('path', { key: 'c', d: 'M4 15v4h4' }),
        h('path', { key: 'd', d: 'M20 15v4h-4' }),
      ],
      pads: () => [
        h('rect', { key: 'a', x: 4, y: 4, width: 6, height: 6, rx: 1 }),
        h('rect', { key: 'b', x: 14, y: 4, width: 6, height: 6, rx: 1 }),
        h('rect', { key: 'c', x: 4, y: 14, width: 6, height: 6, rx: 1 }),
        h('rect', { key: 'd', x: 14, y: 14, width: 6, height: 6, rx: 1 }),
      ],
      components: () => [
        h('rect', { key: 'a', x: 6, y: 6, width: 12, height: 12, rx: 2 }),
        h('path', { key: 'b', d: 'M6 10h12M6 14h12' }),
      ],
      probes: () => [
        h('circle', { key: 'a', cx: 12, cy: 12, r: 4 }),
        h('circle', { key: 'b', cx: 12, cy: 12, r: 8.5 }),
      ],
      net: () => [
        h('circle', { key: 'a', cx: 6, cy: 18, r: 2 }),
        h('circle', { key: 'b', cx: 18, cy: 6, r: 2 }),
        h('path', { key: 'c', d: 'M7.4 16.6 16.6 7.4' }),
      ],
      dim: () => [
        h('circle', { key: 'a', cx: 12, cy: 12, r: 8.5 }),
        h('path', { key: 'b', d: 'M12 3.5a8.5 8.5 0 0 0 0 17z', fill: 'currentColor', stroke: 'none' }),
      ],
      rail: () => [
        h('path', { key: 'a', d: 'M3 7h18' }),
        h('path', { key: 'b', d: 'M3 12h18' }),
        h('path', { key: 'c', d: 'M3 17h18' }),
        h('circle', { key: 'd', cx: 8, cy: 7, r: 1.6, fill: 'currentColor', stroke: 'none' }),
        h('circle', { key: 'e', cx: 15, cy: 12, r: 1.6, fill: 'currentColor', stroke: 'none' }),
        h('circle', { key: 'f', cx: 10, cy: 17, r: 1.6, fill: 'currentColor', stroke: 'none' }),
      ],
      trash: () => [
        h('path', { key: 'a', d: 'M4 7h16' }),
        h('path', { key: 'b', d: 'M9 7V5h6v2' }),
        h('path', { key: 'c', d: 'M6 7l1 13h10l1-13' }),
      ],
    }

    function SectionLabel(props) {
      return h(
        'div',
        {
          style: {
            fontSize: 10,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            color: T.muted,
            marginBottom: 6,
          },
        },
        props.children,
      )
    }

    // ---------------------------------------------------------------------
    // The panel
    // ---------------------------------------------------------------------

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-wrenchbench: dictionaries')

        const t = (key) => {
          try {
            return ctx.locale.bind(NS)(key)
          } catch {
            return en[key] ?? key
          }
        }

        /**
     * Identity of one agent focus command.
     *
     * The Host bumps `revision` on every /focus write, so re-issuing the same
     * target counts as a new command, while an unchanged file means the agent
     * did nothing and the technician's own selection must be left alone.
     * `updatedAt` is only a fallback for a focus file written by an older Host.
     */
    function focusSignature(focus) {
      if (!focus) return ''
      return [
        focus.revision ?? focus.updatedAt ?? '',
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

    function WrenchBenchPanel() {
          const [index, setIndex] = React.useState(null)
          const [indexError, setIndexError] = React.useState('')
          const [activeId, setActiveId] = React.useState(null)
          const [doc, setDoc] = React.useState(null)
          const [busy, setBusy] = React.useState('')
          const [notice, setNotice] = React.useState('')
          const [tab, setTab] = React.useState('board')
          const [search, setSearch] = React.useState('')
          const [dragging, setDragging] = React.useState(false)
          const [selection, setSelection] = React.useState({ refdes: null, net: null, pin: null, annotation: null })
          const [schematic, setSchematic] = React.useState(null)
          const [rails, setRails] = React.useState([])
          const [railOfPart, setRailOfPart] = React.useState(null)
          const [observations, setObservations] = React.useState([])
          const [checks, setChecks] = React.useState({ suspects: [], notes: [] })
          const [markBusy, setMarkBusy] = React.useState(false)
          const [railEdit, setRailEdit] = React.useState(null)
          // Right-click target on the canvas: the technician's shortcut into
          // marking, probing and pointing the agent at what they are looking at.
          const [menu, setMenu] = React.useState(null)
          // Guided triage: symptom -> rail -> what was measured.
          const [triage, setTriage] = React.useState({ symptom: null, rail: null, finding: null })
          const [aliases, setAliases] = React.useState({})
          // null = closed. { step: 'board' } is the new-project wizard.
          const [startup, setStartup] = React.useState(null)
          const [startupImported, setStartupImported] = React.useState(null)
          const [schematicQuery, setSchematicQuery] = React.useState('')
          const [askText, setAskText] = React.useState('')
          const [askState, setAskState] = React.useState({ status: 'idle', message: '', sessionId: null })
          const [ui, setUi] = React.useState({
            showComponents: true,
            showPads: true,
            showProbes: true,
            showNetWiring: true,
            dim: false,
            // On by default: a board with no rail grouping shows plain pads,
            // and a board with rails is immediately readable as supplies.
            railColour: true,
          })
          const [view, setView] = React.useState({ zoom: 1, panX: 0, panY: 0, rotation: 0, side: 'both' })
          const [cursor, setCursor] = React.useState(null)
          // The pad under the pointer, so the net name is readable before a
          // click commits to it — the same affordance the WrenchBoard viewer
          // has, and the thing that makes a dense pitch workable.
          const [hover, setHover] = React.useState(null)
          const [, forceRender] = React.useReducer((value) => value + 1, 0)

          const canvasRef = React.useRef(null)
          const frameRef = React.useRef(0)
          const dragRef = React.useRef(null)
          const fileInputRef = React.useRef(null)
          const pdfInputRef = React.useRef(null)
          const searchRef = React.useRef(null)
          const viewRef = React.useRef(view)
          const docRef = React.useRef(doc)
          const menuRef = React.useRef(null)
          const sizeRef = React.useRef({ width: 0, height: 0 })

          viewRef.current = view
          docRef.current = doc
          menuRef.current = menu

          const panelRef = React.useRef(null)
          // Which agent focus command this panel has already applied. Without
          // it, the 2s poll re-applies "no focus" forever and wipes the
          // technician's own click after a couple of seconds.
          const appliedFocusRef = React.useRef(null)

          React.useEffect(() => {
            let dispose = () => {}
            try {
              dispose = ctx.locale.subscribe(() => forceRender())
            } catch {
              // Locale subscription is optional.
            }
            return () => {
              try {
                dispose()
              } catch {
                // Ignore disposal errors.
              }
            }
          }, [])

          // --- library -------------------------------------------------------
          const loadIndex = React.useCallback(async () => {
            try {
              const body = await getJson(`${ROUTE}/boards`)
              const boards = Array.isArray(body?.boards) ? body.boards : []
              setIndex(body)
              setIndexError('')
              setActiveId((current) => {
                if (current && boards.some((board) => board.id === current)) return current
                return boards[0]?.id ?? null
              })
            } catch (error) {
              setIndexError(error instanceof Error ? error.message : String(error))
              setIndex({ boards: [], formats: [] })
            }
          }, [])

          React.useEffect(() => {
            loadIndex()
          }, [loadIndex])

          // First run: nothing in the library, so offer the two files instead of
          // an empty canvas. Dismissing it does not make it come back.
          const startupDismissed = React.useRef(false)
          React.useEffect(() => {
            if (startupDismissed.current) return
            if (startup !== null) return
            const list = index?.boards
            if (!Array.isArray(list) || list.length > 0) return
            setStartup({ step: 'board' })
          }, [index, startup])

          // --- one board -----------------------------------------------------
          React.useEffect(() => {
            if (!activeId) {
              setDoc(null)
              setSchematic(null)
              return undefined
            }
            let alive = true
            setBusy('board')
            getJson(`${ROUTE}/board?id=${encodeURIComponent(activeId)}`)
              .then((body) => {
                if (!alive) return
                setDoc(body)
                setSchematic(body.schematic ?? null)
                setRails(Array.isArray(body.rails) ? body.rails : [])
                setRailOfPart(new Map(Array.isArray(body.railOfPart) ? body.railOfPart : []))
                setObservations(Array.isArray(body.observations) ? body.observations : [])
                setChecks(body.checks ?? { suspects: [], notes: [] })
                setAliases(body.aliases && typeof body.aliases === 'object' ? body.aliases : {})
                // A focus the agent set before this board was opened is still
                // live, so adopt it now and record it as applied — otherwise
                // the poll above would replay it on top of the first click.
                const openingFocus = body.focus && body.focus.boardId === body.meta.id ? body.focus : null
                appliedFocusRef.current = focusSignature(openingFocus)
                setSelection(selectionFromFocus(openingFocus))
                const canvas = canvasRef.current
                const width = canvas?.clientWidth ?? 0
                const height = canvas?.clientHeight ?? 0
                const zoom = fitZoom(body.board, width || 800, height || 600, 0)
                setView({ zoom, panX: 0, panY: 0, rotation: 0, side: 'both' })
                setNotice('')
              })
              .catch((error) => {
                if (alive) {
                  setDoc(null)
                  setNotice(error instanceof Error ? error.message : String(error))
                }
              })
              .finally(() => {
                if (alive) setBusy('')
              })
            return () => {
              alive = false
            }
          }, [activeId])

          // --- the agent's canvas focus --------------------------------------
          // Also pulls the bench marks back, so a short the agent recorded with
          // wrenchbench_mark appears on the canvas without a manual refresh.
          React.useEffect(() => {
            let alive = true
            const timer = window.setInterval(async () => {
              if (!alive) return
              try {
                const focus = await getJson(`${ROUTE}/focus`)
                if (!alive || !focus) return
                const current = docRef.current
                if (!current) return
                if (focus.boardId && focus.boardId !== current.meta.id) {
                  // The agent pointed at a different board; follow it.
                  setActiveId(focus.boardId)
                  return
                }
                // Adopt the agent's focus only when it actually issued a new
                // command. An unchanged focus file means "the agent is not
                // doing anything", which must never disturb a selection the
                // technician made by clicking the board — that was the bug
                // where connected pads vanished after a couple of seconds.
                const signature = focusSignature(focus)
                if (signature !== appliedFocusRef.current) {
                  appliedFocusRef.current = signature
                  setSelection(selectionFromFocus(focus))
                }

                const marks = await getJson(`${ROUTE}/observe?id=${encodeURIComponent(current.meta.id)}`)
                if (!alive || !marks) return
                setObservations((previous) => {
                  const next = Array.isArray(marks.observations) ? marks.observations : []
                  return previous.length === next.length && previous.at(-1)?.at === next.at(-1)?.at ? previous : next
                })
                setChecks((previous) => {
                  const next = marks.checks ?? { suspects: [], notes: [] }
                  const key = JSON.stringify([(next.suspects ?? []).map((one) => one.refdes), next.notes ?? []])
                  const old = JSON.stringify([(previous.suspects ?? []).map((one) => one.refdes), previous.notes ?? []])
                  return key === old ? previous : next
                })
              } catch {
                // The panel keeps working when these routes are unavailable.
              }
            }, 2000)
            return () => {
              alive = false
              window.clearInterval(timer)
            }
          }, [])

          // Rail colours, marked parts and ranked suspects, resolved to part
          // indices once per change so the renderer stays a plain draw loop.
          const overlay = React.useMemo(() => {
            const railColour = new Map()
            for (const rail of rails) railColour.set(rail.name, rail.colour)
            const suspectRank = new Map()
            ;(checks?.suspects ?? []).forEach((suspect, index) => suspectRank.set(suspect.partIndex, index + 1))
            const marks = new Map()
            const parts = doc?.board?.parts ?? []
            for (const observation of observations) {
              if (!observation.refdes) continue
              const index = parts.findIndex((part) => part.refdes.toUpperCase() === observation.refdes.toUpperCase())
              if (index >= 0) marks.set(index, observation.kind)
            }
            return { railColour, railMap: railOfPart, suspectRank, marks, aliases, hoverPin: hover }
          }, [rails, railOfPart, checks, observations, doc, aliases, hover])

          // --- drawing -------------------------------------------------------
          const paint = React.useCallback(() => {
            frameRef.current = 0
            const canvas = canvasRef.current
            const current = docRef.current
            if (!canvas || !current) return
            drawScene(canvas, current, viewRef.current, ui, selection, overlay)
          }, [ui, selection, overlay])

          const schedule = React.useCallback(() => {
            if (frameRef.current) return
            frameRef.current = window.requestAnimationFrame(paint)
          }, [paint])

          React.useEffect(() => {
            schedule()
            return () => {
              if (frameRef.current) {
                window.cancelAnimationFrame(frameRef.current)
                frameRef.current = 0
              }
            }
          }, [schedule, doc, view, ui, selection, overlay])

          React.useEffect(() => {
            const canvas = canvasRef.current
            if (!canvas || typeof ResizeObserver === 'undefined') return undefined
            const observer = new ResizeObserver((entries) => {
              const box = entries[0]?.contentRect
              if (!box) return
              const previous = sizeRef.current
              sizeRef.current = { width: box.width, height: box.height }
              const current = docRef.current
              if (!current) return
              if (previous.width === 0 || previous.height === 0) {
                const zoom = fitZoom(current.board, box.width, box.height, viewRef.current.rotation)
                setView((existing) => ({ ...existing, zoom, panX: 0, panY: 0 }))
                return
              }
              schedule()
            })
            observer.observe(canvas)
            return () => observer.disconnect()
            // Re-attach when the canvas element itself appears or is replaced.
          }, [schedule, doc?.meta?.id])

          // --- fit whenever a board arrives ----------------------------------
          React.useEffect(() => {
            const canvas = canvasRef.current
            if (!canvas || !doc) return
            const zoom = fitZoom(doc.board, canvas.clientWidth, canvas.clientHeight, view.rotation)
            setView((existing) => ({ ...existing, zoom, panX: 0, panY: 0 }))
            // Only when the board identity changes.
            // eslint-disable-next-line react-hooks/exhaustive-deps
          }, [doc?.meta?.id])

          // --- import --------------------------------------------------------
          const importFile = React.useCallback(
            async (file) => {
              if (!file) return null
              setBusy('import')
              setNotice('')
              try {
                const display = String(file.name).replace(/\.[^.]+$/, '')
                const query = `?name=${encodeURIComponent(file.name)}&display=${encodeURIComponent(display)}`
                const body = await postFile(`${ROUTE}/import${query}`, file)
                await loadIndex()
                if (body?.meta?.id) setActiveId(body.meta.id)
                const warnings = body?.meta?.warnings ?? []
                const stats = body?.meta?.stats ?? {}
                const enrichment = body?.enrichment
                const parts = stats.components ?? stats.parts ?? 0
                const enrichmentNote = enrichment
                  ? ` ${enrichment.named} ${t('startup.namedFromSchematic')}${
                      enrichment.ambiguous > 0 ? `, ${enrichment.ambiguous} ${t('startup.needReview')}` : ''
                    }.`
                  : ''
                setNotice(
                  warnings.length > 0
                    ? `${t('panel.parseWarning')}: ${warnings.join('; ')}`
                    : `${body.meta.name}: ${parts} ${t('status.parts')}, ${stats.pins ?? 0} ${t('status.pins')}, ${stats.nets ?? 0} ${t('status.nets')}.${enrichmentNote}`,
                )
                return body
              } catch (error) {
                setNotice(`${t('panel.error')}: ${error instanceof Error ? error.message : String(error)}`)
                return null
              } finally {
                setBusy('')
              }
            },
            [loadIndex, t],
          )

          const removeBoard = React.useCallback(
            async (id) => {
              try {
                await sendJson(`${ROUTE}/board?id=${encodeURIComponent(id)}`, 'DELETE')
                setActiveId((current) => (current === id ? null : current))
                await loadIndex()
              } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error))
              }
            },
            [loadIndex],
          )

          // --- schematic -----------------------------------------------------
          const uploadSchematic = React.useCallback(
            async (file) => {
              if (!file || !activeId) return null
              setBusy('pdf')
              setNotice('')
              try {
                const body = await postFile(`${ROUTE}/schematic?id=${encodeURIComponent(activeId)}&name=${encodeURIComponent(file.name)}`, file)
                setSchematic(body)
                const enrichment = body?.enrichment
                const enrichmentNote = enrichment
                  ? ` ${enrichment.named} ${t('startup.namedFromSchematic')}${
                      enrichment.ambiguous > 0 ? `, ${enrichment.ambiguous} ${t('startup.needReview')}` : ''
                    }.`
                  : ''
                setNotice(
                  `${body.name}: ${body.stats.pages} ${t('schematic.pages')}, ${body.stats.chars} ${t('schematic.chars')}.${enrichmentNote}`,
                )
                return body
              } catch (error) {
                setNotice(`${error instanceof Error ? error.message : String(error)}`)
                return null
              } finally {
                setBusy('')
              }
            },
            [activeId, t],
          )

          const searchSchematicText = React.useCallback(async () => {
            if (!activeId) return
            try {
              const query = schematicQuery.trim()
              const body = await getJson(
                `${ROUTE}/schematic?id=${encodeURIComponent(activeId)}${query ? `&q=${encodeURIComponent(query)}` : ''}`,
              )
              setSchematic((previous) => ({ ...(previous ?? {}), ...body }))
            } catch (error) {
              setNotice(error instanceof Error ? error.message : String(error))
            }
          }, [activeId, schematicQuery])

          // --- bench marks -----------------------------------------------------
          const applyMarks = React.useCallback((body) => {
            setObservations(Array.isArray(body?.observations) ? body.observations : [])
            setChecks(body?.checks ?? { suspects: [], notes: [] })
          }, [])

          const markSelection = React.useCallback(
            async (kind) => {
              if (!activeId) return
              const refdes = selection.refdes
              const net = selection.net
              if (!refdes && !net) {
                setNotice(t('mark.needsSelection'))
                return
              }
              setMarkBusy(true)
              try {
                const body = await sendJson(`${ROUTE}/observe?id=${encodeURIComponent(activeId)}`, 'POST', {
                  kind,
                  refdes: refdes ?? undefined,
                  net: refdes ? undefined : net,
                  pin: selection.pin ?? undefined,
                })
                applyMarks(body)
                setNotice(`${t('mark.marked')}: ${kind} ${refdes ?? net}`)
              } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error))
              } finally {
                setMarkBusy(false)
              }
            },
            [activeId, selection, applyMarks, t],
          )

          /** Mark a specific part or net, for the context menu and the wizard. */
          const markFor = React.useCallback(
            async (kind, target) => {
              if (!activeId || !target) return
              setMarkBusy(true)
              try {
                const body = await sendJson(`${ROUTE}/observe?id=${encodeURIComponent(activeId)}`, 'POST', {
                  kind,
                  refdes: target.refdes ?? undefined,
                  net: target.refdes ? undefined : target.net ?? undefined,
                  pin: Number.isFinite(Number(target.pin)) ? Number(target.pin) : undefined,
                })
                applyMarks(body)
                setNotice(`${t('mark.marked')}: ${kind} ${target.refdes ?? target.net}`)
              } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error))
              } finally {
                setMarkBusy(false)
              }
            },
            [activeId, applyMarks, t],
          )

          const clearMarks = React.useCallback(async () => {
            if (!activeId) return
            setMarkBusy(true)
            try {
              const body = await sendJson(`${ROUTE}/observe?id=${encodeURIComponent(activeId)}`, 'DELETE')
              applyMarks(body)
            } catch (error) {
              setNotice(error instanceof Error ? error.message : String(error))
            } finally {
              setMarkBusy(false)
            }
          }, [activeId, applyMarks])

          // --- rail labels ---------------------------------------------------
          const saveRailLabel = React.useCallback(
            async (net, label) => {
              setRailEdit(null)
              if (!activeId || !net) return
              const text = String(label ?? '').trim()
              const current = rails.find((rail) => rail.name === net)
              const existing = current && current.label !== current.name ? current.label : ''
              if (text === existing) return
              try {
                const body = await sendJson(`${ROUTE}/rail-label?id=${encodeURIComponent(activeId)}`, 'POST', {
                  net,
                  label: text,
                })
                if (Array.isArray(body?.rails)) setRails(body.rails)
                if (Array.isArray(body?.railOfPart)) setRailOfPart(new Map(body.railOfPart))
              } catch (error) {
                setNotice(error instanceof Error ? error.message : String(error))
              }
            },
            [activeId, rails],
          )

          // --- ask the agent -------------------------------------------------
          const askAgent = React.useCallback(async () => {
            const question = askText.trim()
            if (question.length === 0 || !activeId) return
            setAskState({ status: 'sending', message: '', sessionId: null })
            try {
              const body = await sendJson(`${ROUTE}/ask`, 'POST', {
                question,
                board: activeId,
                refdes: selection.refdes ?? undefined,
              })
              if (body?.accepted) {
                setAskState({ status: 'sent', message: '', sessionId: body.sessionId ?? null })
                setAskText('')
              } else {
                setAskState({ status: 'no-session', message: body?.reason ?? '', sessionId: null })
              }
            } catch (error) {
              setAskState({ status: 'error', message: error instanceof Error ? error.message : String(error), sessionId: null })
            }
          }, [askText, activeId, selection.refdes])

          const openConversation = React.useCallback(() => {
            try {
              const layout = ctx.get('layout')
              if (layout && typeof layout.selectPanel === 'function') layout.selectPanel('conversation')
            } catch {
              // Navigation is best-effort.
            }
          }, [])

          // --- pointer interactions ------------------------------------------
          // A native listener, because React's delegated wheel handler is
          // passive and cannot preventDefault the page scroll while zooming.
          React.useEffect(() => {
            const canvas = canvasRef.current
            if (!canvas) return undefined
            const onWheel = (event) => {
              if (!docRef.current) return
              event.preventDefault()
              const rect = canvas.getBoundingClientRect()
              const mx = event.clientX - rect.left - rect.width / 2
              const my = event.clientY - rect.top - rect.height / 2
              setView((existing) => {
                const factor = Math.exp(-event.deltaY * 0.0016)
                const nextZoom = clamp(existing.zoom * factor, 1e-4, 1e4)
                const ratio = nextZoom / existing.zoom
                return {
                  ...existing,
                  zoom: nextZoom,
                  panX: mx - (mx - existing.panX) * ratio,
                  panY: my - (my - existing.panY) * ratio,
                }
              })
            }
            canvas.addEventListener('wheel', onWheel, { passive: false })
            return () => canvas.removeEventListener('wheel', onWheel)
          }, [doc?.meta?.id])

          /**
            * Screen positions of every pad, cached per view.
            *
            * Both the click hit-test and the hover readout need the nearest pad
            * to a pointer, and re-projecting 15 000 pads per mouse move is the
            * one thing that would make hovering feel worse than not having it.
            */
          const screenPinsRef = React.useRef({ key: '', xs: null, ys: null, count: 0 })
          const projectPins = React.useCallback(() => {
            const canvas = canvasRef.current
            const current = docRef.current
            const currentView = viewRef.current
            if (!canvas || !current) return null
            const width = canvas.clientWidth
            const height = canvas.clientHeight
            const key = [
              current.meta.id,
              currentView.zoom,
              currentView.panX,
              currentView.panY,
              currentView.rotation,
              width,
              height,
            ].join('|')
            const cache = screenPinsRef.current
            if (cache.key === key && cache.xs && cache.xs.length === current.board.pins.length) return cache
            const pins = current.board.pins
            const xs = new Float32Array(pins.length)
            const ys = new Float32Array(pins.length)
            for (let index = 0; index < pins.length; index += 1) {
              const screen = projectPoint(current.board, currentView, width, height, pins[index].x, pins[index].y)
              xs[index] = screen.x
              ys[index] = screen.y
            }
            screenPinsRef.current = { key, xs, ys, count: pins.length }
            return screenPinsRef.current
          }, [])

          const hitTest = React.useCallback((screenX, screenY) => {
            const canvas = canvasRef.current
            const current = docRef.current
            const currentView = viewRef.current
            if (!canvas || !current) return null
            const width = canvas.clientWidth
            const height = canvas.clientHeight
            const board = current.board

            // Pads are drawn ~3 px half-size, so a 12 px grab radius means a
            // 2 px miss still lands, while "nearest wins" keeps a dense BGA
            // from selecting the wrong ball.
            const projected = projectPins()
            let best = null
            let bestDistance = 12
            if (projected) {
              for (let index = 0; index < projected.count; index += 1) {
                const pin = board.pins[index]
                if (currentView.side !== 'both' && pin.layer !== currentView.side) continue
                const distance = Math.hypot(projected.xs[index] - screenX, projected.ys[index] - screenY)
                if (distance < bestDistance) {
                  bestDistance = distance
                  best = { kind: 'pin', pin, index }
                }
              }
            }
            if (best) return best

            const world = unprojectPoint(board, currentView, width, height, screenX, screenY)
            for (let partIndex = 0; partIndex < board.parts.length; partIndex += 1) {
              const part = board.parts[partIndex]
              if (currentView.side !== 'both' && part.layer !== currentView.side) continue
              const box = part.bbox
              // Body margin, in board units, that stays roughly constant on
              // screen — a small package is otherwise unclickable at fit zoom.
              const margin = Math.min(8 / Math.max(currentView.zoom, 1e-6), Math.max(box.x2 - box.x1, box.y2 - box.y1))
              if (
                world.x >= box.x1 - margin &&
                world.x <= box.x2 + margin &&
                world.y >= box.y1 - margin &&
                world.y <= box.y2 + margin
              ) {
                return { kind: 'part', part, index: partIndex }
              }
            }
            return null
          }, [projectPins])

          const onPointerDown = React.useCallback(
            (event) => {
              const canvas = canvasRef.current
              if (!canvas || !docRef.current) return
              canvas.setPointerCapture?.(event.pointerId)
              dragRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                panX: viewRef.current.panX,
                panY: viewRef.current.panY,
                moved: false,
              }
              canvas.dataset.panning = '1'
            },
            [],
          )

          const onPointerMove = React.useCallback((event) => {
            const canvas = canvasRef.current
            const current = docRef.current
            const currentView = viewRef.current
            if (!canvas || !current) return
            const rect = canvas.getBoundingClientRect()
            const screenX = event.clientX - rect.left
            const screenY = event.clientY - rect.top
            const world = unprojectPoint(current.board, currentView, rect.width, rect.height, screenX, screenY)
            setCursor(world)

            const projected = projectPins()
            let nearest = null
            let nearestDistance = 9
            if (projected && currentView.side !== 'none') {
              for (let index = 0; index < projected.count; index += 1) {
                const pin = current.board.pins[index]
                if (currentView.side !== 'both' && pin.layer !== currentView.side) continue
                const distance = Math.hypot(projected.xs[index] - screenX, projected.ys[index] - screenY)
                if (distance < nearestDistance) {
                  nearestDistance = distance
                  nearest = pin
                }
              }
            }
            setHover((previous) => {
              const nextKey = nearest ? `${nearest.part}:${nearest.index}` : ''
              const previousKey = previous ? `${previous.part}:${previous.index}` : ''
              return previousKey === nextKey ? previous : nearest
            })

            const drag = dragRef.current
            if (!drag) return
            const dx = event.clientX - drag.startX
            const dy = event.clientY - drag.startY
            if (!drag.moved && Math.hypot(dx, dy) > 3) drag.moved = true
            if (drag.moved) {
              setView((existing) => ({ ...existing, panX: drag.panX + dx, panY: drag.panY + dy }))
            }
          }, [projectPins])

          /**
            * Right-click: open the action menu for whatever is under the cursor.
            *
            * Left click keeps selecting (the user asked for the menu on right
            * click), and the menu carries the actions a bench technician reaches
            * for mid-probe: mark it, point at it, label the rail, copy the name.
            */
          const onContextMenu = React.useCallback(
            (event) => {
              const canvas = canvasRef.current
              if (!canvas || !docRef.current) return
              event.preventDefault()
              const rect = canvas.getBoundingClientRect()
              const x = event.clientX - rect.left
              const y = event.clientY - rect.top
              const hit = hitTest(x, y)
              const current = docRef.current
              if (hit?.kind === 'pin') {
                const part = current.board.parts[hit.pin.part]
                setSelection({
                  refdes: part ? part.refdes : null,
                  net: hit.pin.net,
                  pin: hit.pin.index,
                  annotation: null,
                })
                setMenu({
                  x,
                  y,
                  refdes: part ? part.refdes : null,
                  net: hit.pin.net ?? null,
                  pin: hit.pin.index,
                })
                return
              }
              if (hit?.kind === 'part') {
                setSelection({ refdes: hit.part.refdes, net: null, pin: null, annotation: null })
                const owned = current.board.nets.find((net) =>
                  net.pins.some((pinIndex) => current.board.pins[pinIndex]?.part === hit.index),
                )
                setMenu({ x, y, refdes: hit.part.refdes, net: owned?.name ?? null, pin: null })
                return
              }
              setMenu({ x, y, refdes: null, net: null, pin: null })
            },
            [hitTest],
          )

          const onPointerLeave = React.useCallback(() => {
            setHover(null)
          }, [])

          const onPointerUp = React.useCallback(
            (event) => {
              const canvas = canvasRef.current
              const drag = dragRef.current
              dragRef.current = null
              if (canvas) canvas.dataset.panning = '0'
              if (!canvas || !drag || drag.moved) return
              const rect = canvas.getBoundingClientRect()
              const hit = hitTest(event.clientX - rect.left, event.clientY - rect.top)
              if (!hit) {
                setSelection({ refdes: null, net: null, pin: null, annotation: null })
                return
              }
              if (hit.kind === 'pin') {
                const part = docRef.current?.board.parts[hit.pin.part]
                setSelection({ refdes: part ? part.refdes : null, net: hit.pin.net, pin: hit.pin.index, annotation: null })
                return
              }
              setSelection({ refdes: hit.part.refdes, net: null, pin: null, annotation: null })
            },
            [hitTest],
          )

          /** Select a part and bring it into view — the inspector/wizard path. */
          const focusRefdes = React.useCallback(
            (refdes) => {
              if (!refdes) return
              setSelection({ refdes, net: null, pin: null, annotation: null })
              zoomToPart(refdes)
            },
            [zoomToPart],
          )

          const zoomToPart = React.useCallback((refdes) => {
            const canvas = canvasRef.current
            const current = docRef.current
            if (!canvas || !current) return
            const part = current.board.parts.find((entry) => entry.refdes.toUpperCase() === String(refdes).toUpperCase())
            if (!part) return
            const bounds = boundsOf(current.board)
            const centreX = (bounds.minX + bounds.maxX) / 2
            const centreY = (bounds.minY + bounds.maxY) / 2
            const targetX = (part.bbox.x1 + part.bbox.x2) / 2
            const targetY = (part.bbox.y1 + part.bbox.y2) / 2
            const zoom = Math.max(viewRef.current.zoom, fitZoom(current.board, canvas.clientWidth, canvas.clientHeight, viewRef.current.rotation) * 3)
            setView((existing) => {
              const flip = existing.side === 'bottom' ? -1 : 1
              const dx = targetX - centreX
              const dy = (targetY - centreY) * flip
              const cos = Math.cos(existing.rotation)
              const sin = Math.sin(existing.rotation)
              return {
                ...existing,
                zoom,
                panX: -(dx * cos - dy * sin) * zoom,
                panY: -(dx * sin + dy * cos) * zoom,
              }
            })
            setSelection({ refdes: part.refdes, net: null, pin: null, annotation: null })
          }, [])

          // --- keyboard -------------------------------------------------------
          React.useEffect(() => {
            const onKey = (event) => {
              if (event.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) {
                const node = searchRef.current
                if (node) {
                  event.preventDefault()
                  node.focus()
                }
              }
              if (event.key === 'Escape') {
                const node = searchRef.current
                if (node && document.activeElement === node) node.blur()
                // Escape closes the topmost layer first: the action menu, then
                // the selection.
                if (menuRef.current) setMenu(null)
                else setSelection({ refdes: null, net: null, pin: null, annotation: null })
              }
            }
            window.addEventListener('keydown', onKey)
            return () => window.removeEventListener('keydown', onKey)
          }, [])

          // --- derived --------------------------------------------------------
          const boards = index?.boards ?? []
          const formats = index?.formats ?? []
          const activeMeta = boards.find((board) => board.id === activeId) ?? null
          const board = doc?.board ?? null
          const focus = index?.focus ?? null

          // Zoom is reported against "fit", so 100% always means the whole
          // board is in view regardless of board size or canvas size.
          const zoomPercent = React.useMemo(() => {
            if (!board) return 100
            const canvas = canvasRef.current
            const fit = fitZoom(board, canvas?.clientWidth || 900, canvas?.clientHeight || 600, view.rotation)
            if (!(fit > 0)) return 100
            return Math.max(1, Math.round((view.zoom / fit) * 100))
          }, [board, view.zoom, view.rotation])

          const matching = React.useMemo(() => {
            const needle = search.trim().toLowerCase()
            if (!board || needle.length === 0) return { parts: [], nets: [] }
            return {
              parts: board.parts.filter((part) => part.refdes.toLowerCase().includes(needle)).slice(0, 24),
              nets: board.nets.filter((net) => net.name.toLowerCase().includes(needle)).slice(0, 24),
            }
          }, [board, search])

          const inspectedPart = React.useMemo(() => {
            if (!board || !selection.refdes) return null
            return board.parts.find((part) => part.refdes.toUpperCase() === String(selection.refdes).toUpperCase()) ?? null
          }, [board, selection.refdes])

          const inspectedPins = React.useMemo(() => {
            if (!board || !inspectedPart) return []
            const partIndex = board.parts.indexOf(inspectedPart)
            return board.pins
              .map((pin, index) => ({ ...pin, index, pinIndex: index }))
              .filter((pin) => pin.part === partIndex)
          }, [board, inspectedPart])

          const inspectedRail = React.useMemo(() => {
            if (!board || !inspectedPart || !railOfPart) return null
            return railOfPart.get(board.parts.indexOf(inspectedPart)) ?? null
          }, [board, inspectedPart, railOfPart])

          /** Pin budget of the selected part: supplies, ground, signals, unused. */
          const inspectedPinout = React.useMemo(() => {
            if (!board || !inspectedPart || inspectedPins.length === 0) return null
            const counts = { power: 0, ground: 0, signal: 0, nc: 0 }
            const byName = new Map(board.nets.map((net) => [net.name, net]))
            const railNames = new Set(rails.map((rail) => rail.name))
            for (const pin of inspectedPins) {
              if (!pin.net) {
                counts.nc += 1
                continue
              }
              const net = byName.get(pin.net)
              if (net?.ground || /^(GND|GROUND|VSS|AGND|DGND|PGND)$/i.test(pin.net)) counts.ground += 1
              else if (/^(NC|N\.?C\.?|DNC|NO_?CONNECT|RESERVED)$/i.test(pin.net)) counts.nc += 1
              else if (net?.power || railNames.has(pin.net)) counts.power += 1
              else counts.signal += 1
            }
            return counts
          }, [board, inspectedPart, inspectedPins, rails])

          /**
           * Where to probe the selected part's rail.
           *
           * "Easiest first" is the ordering that matters at the bench: a
           * two-terminal passive can be probed without moving the board or
           * lifting anything, while a 300-pad package needs the board on a
           * stand. Distance breaks the tie.
           */
          const probePlan = React.useMemo(() => {
            if (!board || !inspectedPart || !inspectedRail) return { points: [], more: 0 }
            const rail = rails.find((entry) => entry.name === inspectedRail)
            const railLabel = rail?.label && rail.label !== rail.name ? rail.label : inspectedRail
            const net = board.nets.find((entry) => entry.name === inspectedRail)
            const centre = {
              x: (inspectedPart.bbox.x1 + inspectedPart.bbox.x2) / 2,
              y: (inspectedPart.bbox.y1 + inspectedPart.bbox.y2) / 2,
            }
            const unitsToMm = board.units === 'mm' ? 1 : 0.0254
            const seen = new Set([inspectedPart.refdes])
            const found = []
            for (const pinIndex of net?.pins ?? []) {
              const pin = board.pins[pinIndex]
              if (!pin) continue
              const part = board.parts[pin.part]
              if (!part || seen.has(part.refdes) || part.pins === 0) continue
              seen.add(part.refdes)
              const dx = (part.bbox.x1 + part.bbox.x2) / 2 - centre.x
              const dy = (part.bbox.y1 + part.bbox.y2) / 2 - centre.y
              const mm = Math.hypot(dx, dy) * unitsToMm
              const ease = (part.pins <= 2 ? 40 : part.pins <= 4 ? 22 : part.pins <= 8 ? 8 : 0) - Math.min(mm, 220) * 0.28
              found.push({
                refdes: part.refdes,
                label: aliases[part.refdes]?.alias ?? part.refdes,
                value: part.value ?? null,
                pins: part.pins,
                distance: mm < 100 ? mm.toFixed(1) : Math.round(mm),
                ease,
                railLabel,
              })
            }
            found.sort((a, b) => b.ease - a.ease || a.refdes.localeCompare(b.refdes))
            const points = found.slice(0, 4)
            return { points, more: Math.max(0, found.length - points.length) }
          }, [board, inspectedPart, inspectedRail, rails, aliases])

          const probePoints = probePlan.points
          const probeMore = probePlan.more

          /**
           * Easiest points to probe on one rail, for the triage wizard.
           *
           * Same ordering idea as the inspector: a two-terminal passive you can
           * reach beats a package you would have to lift, and among equals the
           * smallest pad count wins because it is a purer measurement.
           */
          const triageProbe = React.useMemo(() => {
            if (!board || !triage.rail) return []
            const net = board.nets.find((entry) => entry.name === triage.rail)
            if (!net) return []
            const seen = new Set()
            const found = []
            for (const pinIndex of net.pins ?? []) {
              const pin = board.pins[pinIndex]
              if (!pin) continue
              const part = board.parts[pin.part]
              if (!part || seen.has(part.refdes) || part.pins === 0) continue
              seen.add(part.refdes)
              found.push({
                refdes: part.refdes,
                label: aliases[part.refdes]?.alias ?? part.refdes,
                value: part.value ?? null,
                pins: part.pins,
              })
            }
            found.sort((a, b) => a.pins - b.pins || a.refdes.localeCompare(b.refdes))
            return found.slice(0, 6)
          }, [board, triage.rail, aliases])

          const otherNetPins = React.useMemo(() => {            if (!board || !selection.net) return []
            const net = board.nets.find((entry) => entry.name === selection.net)
            if (!net) return []
            return net.pins
              .map((index) => ({ pin: board.pins[index], index }))
              .filter((entry) => entry.pin && entry.pin.net === selection.net)
              .slice(0, 40)
          }, [board, selection.net])

          // --- render ---------------------------------------------------------

          const header = h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h(
              'div',
              { style: { minWidth: 0 } },
              h('div', { style: { fontSize: 17, fontWeight: 650 } }, t('nav.label')),
              h('div', { style: { fontSize: 12, color: T.muted } }, t('panel.subtitle')),
            ),
            h('div', { style: { flex: 1 } }),
            h(
              'button',
              {
                type: 'button',
                style: { ...BUTTON, borderColor: T.brand, color: T.brand },
                onClick: () => {
                  setStartupImported(null)
                  setStartup({ step: 'board' })
                },
                disabled: busy === 'import' || busy === 'pdf',
              },
              t('startup.newProject'),
            ),
            h(
              'button',
              { type: 'button', style: BUTTON, onClick: () => fileInputRef.current?.click(), disabled: busy === 'import' },
              busy === 'import' ? t('panel.importing') : t('panel.import'),
            ),
            h('button', { type: 'button', style: BUTTON, onClick: () => loadIndex() }, t('panel.refresh')),
            h('input', {
              ref: fileInputRef,
              type: 'file',
              // Any file is accepted: the host sniffs the payload, so an
              // unusual extension (or none) must not block an import.
              accept: undefined,
              style: { display: 'none' },
              onChange: (event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                importFile(file)
              },
            }),
            h('input', {
              ref: pdfInputRef,
              type: 'file',
              accept: undefined,
              style: { display: 'none' },
              onChange: (event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                uploadSchematic(file)
              },
            }),
          )

          const library = h(
            'aside',
            {
              style: {
                width: 212,
                flex: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                minHeight: 0,
              },
            },
            h(SectionLabel, null, `${t('panel.library')}${boards.length ? ` · ${boards.length}` : ''}`),
            h(
              'div',
              { style: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 } },
              boards.length === 0
                ? h('div', { style: { fontSize: 12, color: T.muted } }, t('panel.library.empty'))
                : boards.map((boardMeta) =>
                    h(
                      'div',
                      {
                        key: boardMeta.id,
                        className: 'wb-row',
                        onClick: () => setActiveId(boardMeta.id),
                        style: {
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 6,
                          padding: '7px 8px',
                          borderRadius: 8,
                          cursor: 'pointer',
                          border: boardMeta.id === activeId ? T.borderStrong : '1px solid transparent',
                          background: boardMeta.id === activeId ? T.layer1 : 'transparent',
                        },
                      },
                      h(
                        'div',
                        { style: { minWidth: 0, flex: 1 } },
                        h(
                          'div',
                          {
                            style: {
                              fontSize: 12.5,
                              fontWeight: boardMeta.id === activeId ? 600 : 500,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            },
                            title: boardMeta.sourceName || boardMeta.name,
                          },
                          boardMeta.name,
                        ),
                        h(
                          'div',
                          { style: { fontSize: 10.5, color: T.muted, marginTop: 2 } },
                          `${boardMeta.stats.parts} ${t('status.parts')} · ${boardMeta.stats.pins} ${t('status.pins')}`,
                        ),
                        h(
                          'div',
                          { style: { display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' } },
                          h('span', { className: 'wb-chip' }, boardMeta.format),
                          boardMeta.schematic ? h('span', { className: 'wb-chip' }, `PDF ${boardMeta.schematic.stats.pages}p`) : null,
                        ),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          title: t('panel.library.remove'),
                          'aria-label': t('panel.library.remove'),
                          onClick: (event) => {
                            event.stopPropagation()
                            removeBoard(boardMeta.id)
                          },
                          style: {
                            appearance: 'none',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            padding: 2,
                            color: T.muted,
                            display: 'flex',
                          },
                        },
                        h(IconGlyph, null, GLYPH.trash()),
                      ),
                    ),
                  ),
            ),
          )

          const toolbar = board
            ? h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: 5,
                    border: T.border,
                    borderRadius: 12,
                    background: T.layer1,
                    flexWrap: 'wrap',
                  },
                },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 4 } },
                  h(IconGlyph, null, GLYPH.search()),
                  h('input', {
                    ref: searchRef,
                    value: search,
                    onChange: (event) => setSearch(event.currentTarget.value),
                    placeholder: t('toolbar.searchPlaceholder'),
                    'aria-label': t('toolbar.search'),
                    style: {
                      width: 148,
                      fontSize: 12,
                      padding: '3px 6px',
                      color: 'inherit',
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      fontFamily: 'inherit',
                    },
                  }),
                ),
                h('div', { style: { width: 1, height: 18, background: T.muted, opacity: 0.3 } }),
                ['top', 'both', 'bottom'].map((side) =>
                  h(
                    ToolbarButton,
                    {
                      key: side,
                      wide: true,
                      active: view.side === side,
                      title: t(`toolbar.${side}`),
                      onClick: () => setView((existing) => ({ ...existing, side })),
                    },
                    t(`toolbar.${side}`),
                  ),
                ),
                h('div', { style: { width: 1, height: 18, background: T.muted, opacity: 0.3 } }),
                h(
                  ToolbarButton,
                  {
                    title: t('toolbar.rotateLeft'),
                    onClick: () => setView((existing) => ({ ...existing, rotation: existing.rotation - Math.PI / 2 })),
                  },
                  h(IconGlyph, null, GLYPH.rotateLeft()),
                ),
                h(
                  ToolbarButton,
                  {
                    title: t('toolbar.rotateRight'),
                    onClick: () => setView((existing) => ({ ...existing, rotation: existing.rotation + Math.PI / 2 })),
                  },
                  h(IconGlyph, null, GLYPH.rotateRight()),
                ),
                h(
                  ToolbarButton,
                  {
                    title: t('toolbar.fit'),
                    onClick: () => {
                      const canvas = canvasRef.current
                      if (!canvas || !doc) return
                      const zoom = fitZoom(doc.board, canvas.clientWidth, canvas.clientHeight, view.rotation)
                      setView((existing) => ({ ...existing, zoom, panX: 0, panY: 0 }))
                    },
                  },
                  h(IconGlyph, null, GLYPH.fit()),
                ),
                h('div', { style: { width: 1, height: 18, background: T.muted, opacity: 0.3 } }),
                h(
                  ToolbarButton,
                  {
                    title: t('toolbar.showPads'),
                    toggle: true,
                    active: ui.showPads,
                    onClick: () => setUi((existing) => ({ ...existing, showPads: !existing.showPads })),
                  },
                  h(IconGlyph, null, GLYPH.pads()),
                ),
                h(
                  ToolbarButton,
                  {
                    title: t('toolbar.showComponents'),
                    toggle: true,
                    active: ui.showComponents,
                    onClick: () => setUi((existing) => ({ ...existing, showComponents: !existing.showComponents })),
                  },
                  h(IconGlyph, null, GLYPH.components()),
                ),
                h(
                  ToolbarButton,
                  {
                    title: t('toolbar.showProbes'),
                    toggle: true,
                    active: ui.showProbes,
                    disabled: !board.nails || board.nails.length === 0,
                    onClick: () => setUi((existing) => ({ ...existing, showProbes: !existing.showProbes })),
                  },
                  h(IconGlyph, null, GLYPH.probes()),
                ),
                h(
                  ToolbarButton,
                  {
                    title: t('toolbar.showNetWiring'),
                    toggle: true,
                    active: ui.showNetWiring,
                    onClick: () => setUi((existing) => ({ ...existing, showNetWiring: !existing.showNetWiring })),
                  },
                  h(IconGlyph, null, GLYPH.net()),
                ),
                h(
                  ToolbarButton,
                  {
                    title: t('toolbar.dim'),
                    toggle: true,
                    active: ui.dim,
                    onClick: () => setUi((existing) => ({ ...existing, dim: !existing.dim })),
                  },
                  h(IconGlyph, null, GLYPH.dim()),
                ),
                h('div', { style: { width: 1, height: 18, background: T.muted, opacity: 0.3 } }),
                h(
                  ToolbarButton,
                  {
                    title: t('toolbar.rail'),
                    toggle: true,
                    active: ui.railColour,
                    disabled: rails.length === 0,
                    onClick: () => setUi((existing) => ({ ...existing, railColour: !existing.railColour })),
                  },
                  h(IconGlyph, null, GLYPH.rail()),
                ),
              )
            : null

          const statusBar = board
            ? h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    fontSize: 11,
                    color: T.muted,
                    padding: '2px 4px',
                    fontFamily: T.mono,
                    flexWrap: 'wrap',
                  },
                },
                h('span', null, `${board.stats.parts} ${t('status.parts')}`),
                h('span', null, `${board.stats.pins} ${t('status.pins')}`),
                h('span', null, `${board.stats.nets} ${t('status.nets')}`),
                // The pad under the pointer, before a click commits to it.
                hover
                  ? h(
                      'span',
                      { style: { color: T.brand } },
                      `${aliases[board.parts[hover.part]?.refdes]?.alias ?? board.parts[hover.part]?.refdes ?? '?'}.${hover.index}${
                        hover.net ? ` → ${hover.net}` : ''
                      }`,
                    )
                  : h('span', { style: { opacity: 0.45 } }, t('status.hover')),
                cursor
                  ? h('span', null, `X: ${cursor.x.toFixed(1)}  Y: ${cursor.y.toFixed(1)}`)
                  : h('span', null, 'X: —  Y: —'),
                h('span', null, `Zoom: ${zoomPercent}%`),
                h('span', { style: { marginLeft: 'auto' } }, board.units === 'mm' ? 'mm' : 'board units'),
              )
            : null

          // --- right-click action menu ----------------------------------------
          const menuItem = (label, onClick, options = {}) =>
            h(
              'button',
              {
                type: 'button',
                disabled: Boolean(options.disabled),
                onClick: () => {
                  setMenu(null)
                  onClick()
                },
                style: {
                  appearance: 'none',
                  border: 'none',
                  background: 'transparent',
                  color: options.danger ? T.danger : 'inherit',
                  textAlign: 'left',
                  padding: '5px 9px',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  opacity: options.disabled ? 0.4 : 1,
                },
              },
              options.dot
                ? h('span', { style: { width: 7, height: 7, borderRadius: 2, background: options.dot, flex: 'none' } })
                : h('span', { style: { width: 7, flex: 'none' } }),
              label,
            )

          const copyText = async (value) => {
            try {
              await navigator.clipboard?.writeText(String(value))
              setNotice(`${t('menu.copied')} ${value}`)
            } catch {
              setNotice(String(value))
            }
          }

          const contextMenu =
            menu && board
              ? h(
                  'div',
                  {
                    onContextMenu: (event) => event.preventDefault(),
                    style: {
                      position: 'absolute',
                      // Keep the menu on screen when the click is near an edge.
                      left: Math.max(4, Math.min(menu.x + 6, (canvasRef.current?.clientWidth ?? 400) - 210)),
                      top: Math.max(4, Math.min(menu.y + 6, (canvasRef.current?.clientHeight ?? 300) - 40)),
                      zIndex: 30,
                      minWidth: 196,
                      maxHeight: 340,
                      overflowY: 'auto',
                      border: T.border,
                      borderRadius: 10,
                      padding: 4,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                      background: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #ffffff))',
                      boxShadow: '0 10px 30px color-mix(in srgb, currentColor 18%, transparent)',
                    },
                  },
                  h(
                    'div',
                    {
                      style: {
                        padding: '4px 9px 6px',
                        fontSize: 11,
                        color: T.muted,
                        borderBottom: T.border,
                        marginBottom: 3,
                        fontFamily: T.mono,
                      },
                    },
                    menu.refdes
                      ? `${aliases[menu.refdes]?.alias ?? menu.refdes}${menu.pin ? `.${menu.pin}` : ''}${
                          menu.net ? `  ·  ${menu.net}` : ''
                        }`
                      : t('menu.emptySpace'),
                  ),

                  menu.refdes
                    ? menuItem(t('menu.focus'), () => zoomToPart(menu.refdes))
                    : null,
                  menu.refdes
                    ? menuItem(t('mark.short'), () => markFor('short', { refdes: menu.refdes, pin: menu.pin }), {
                        dot: T.danger,
                      })
                    : null,
                  menu.refdes
                    ? menuItem(t('mark.shortToGround'), () => markFor('short-to-ground', { refdes: menu.refdes, pin: menu.pin }), {
                        dot: T.danger,
                      })
                    : null,
                  menu.refdes
                    ? menuItem(t('mark.open'), () => markFor('open', { refdes: menu.refdes, pin: menu.pin }))
                    : null,
                  menu.refdes
                    ? menuItem(t('mark.ok'), () => markFor('ok', { refdes: menu.refdes, pin: menu.pin }), {
                        dot: 'var(--dsw-alias-state-success-primary, #3f9e6b)',
                      })
                    : null,
                  menu.refdes && observations.some((item) => item.refdes === menu.refdes)
                    ? menuItem(t('menu.clearHere'), async () => {
                        if (!activeId) return
                        try {
                          const body = await sendJson(
                            `${ROUTE}/observe?id=${encodeURIComponent(activeId)}&refdes=${encodeURIComponent(menu.refdes)}`,
                            'DELETE',
                          )
                          applyMarks(body)
                        } catch (error) {
                          setNotice(error instanceof Error ? error.message : String(error))
                        }
                      }, { danger: true })
                    : null,
                  menu.refdes ? h('div', { style: { height: 1, background: T.muted, opacity: 0.18, margin: '3px 6px' } }) : null,

                  menu.net
                    ? menuItem(t('rail.labelThis'), () => setRailEdit(menu.net))
                    : null,
                  menu.net
                    ? menuItem(t('menu.onlyNet'), () => {
                        setSelection({ refdes: menu.refdes ?? null, net: menu.net, pin: menu.pin ?? null, annotation: null })
                        setUi((existing) => ({ ...existing, dim: true, showNetWiring: true }))
                      })
                    : null,
                  menu.net
                    ? menuItem(t('mark.shortToGround') + ' (' + t('inspector.net') + ')', () =>
                        markFor('short-to-ground', { net: menu.net }),
                      {
                        dot: T.danger,
                      })
                    : null,
                  menu.net
                    ? menuItem(t('menu.copyNet'), () => copyText(menu.net))
                    : null,
                  menu.refdes ? menuItem(t('menu.copyRefdes'), () => copyText(menu.refdes)) : null,
                  menu.refdes || menu.net
                    ? h('div', { style: { height: 1, background: T.muted, opacity: 0.18, margin: '3px 6px' } })
                    : null,
                  menu.refdes
                    ? menuItem(t('inspector.askAbout'), () => {
                        setAskText(
                          `${menu.refdes}${menu.pin ? ` pad ${menu.pin}` : ''}${menu.net ? ` on ${menu.net}` : ''} — `,
                        )
                        setTab('agent')
                      })
                    : null,
                  menuItem(t('toolbar.fit'), () => {
                    const canvas = canvasRef.current
                    const zoom = fitZoom(board, canvas?.clientWidth ?? 800, canvas?.clientHeight ?? 600, view.rotation)
                    setView((existing) => ({ ...existing, zoom, panX: 0, panY: 0 }))
                  }),
                  menuItem(t('startup.newProject'), () => {
                    setStartupImported(null)
                    setStartup({ step: 'board' })
                  }),
                )
              : null

          const canvasArea = board
            ? h(
                'div',
                { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 } },
                toolbar,
                h(
                  'div',
                  {
                    style: {
                      position: 'relative',
                      flex: 1,
                      minHeight: 0,
                      border: T.border,
                      borderRadius: 12,
                      overflow: 'hidden',
                      background: 'var(--dsw-alias-bg-base, transparent)',
                    },
                  },
                  h('canvas', {
                    ref: canvasRef,
                    className: 'wb-canvas',
                    style: { display: 'block', width: '100%', height: '100%' },
                    onPointerDown: (event) => {
                      setMenu(null)
                      onPointerDown(event)
                    },
                    onPointerMove,
                    onPointerUp,
                    onContextMenu,
                    onPointerLeave: () => {
                      setCursor(null)
                      setHover(null)
                      dragRef.current = null
                    },
                  }),
                  contextMenu,
                  search.trim().length > 0
                    ? h(
                        'div',
                        {
                          style: {
                            position: 'absolute',
                            top: 8,
                            left: 8,
                            maxHeight: '70%',
                            overflowY: 'auto',
                            minWidth: 200,
                            border: T.borderStrong,
                            borderRadius: 10,
                            background: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #fff))',
                            padding: 6,
                            boxShadow: '0 6px 24px color-mix(in srgb, currentColor 20%, transparent)',
                          },
                        },
                        matching.parts.length === 0 && matching.nets.length === 0
                          ? h('div', { style: { fontSize: 12, color: T.muted, padding: 4 } }, t('schematic.noMatches'))
                          : null,
                        matching.parts.map((part) =>
                          h(
                            'button',
                            {
                              key: `p-${part.refdes}`,
                              type: 'button',
                              onClick: () => zoomToPart(part.refdes),
                              style: {
                                display: 'flex',
                                width: '100%',
                                gap: 8,
                                alignItems: 'baseline',
                                appearance: 'none',
                                border: 'none',
                                background: 'transparent',
                                color: 'inherit',
                                cursor: 'pointer',
                                padding: '3px 6px',
                                borderRadius: 6,
                                fontSize: 12,
                                textAlign: 'left',
                                fontFamily: 'inherit',
                              },
                            },
                            h('span', { style: { fontFamily: T.mono } }, aliases[part.refdes]?.alias ?? part.refdes),
                            aliases[part.refdes]?.alias
                              ? h('span', { style: { color: T.muted, marginLeft: 6 } }, part.refdes)
                              : null,
                            h('span', { style: { fontSize: 10.5, color: T.muted } }, `${part.pins} ${t('inspector.pins')}`),
                          ),
                        ),
                        matching.nets.map((net) =>
                          h(
                            'button',
                            {
                              key: `n-${net.name}`,
                              type: 'button',
                              onClick: () => {
                                setSelection({ refdes: null, net: net.name, pin: null, annotation: null })
                                setSearch('')
                              },
                              style: {
                                display: 'flex',
                                width: '100%',
                                gap: 8,
                                alignItems: 'baseline',
                                appearance: 'none',
                                border: 'none',
                                background: 'transparent',
                                color: 'inherit',
                                cursor: 'pointer',
                                padding: '3px 6px',
                                borderRadius: 6,
                                fontSize: 12,
                                textAlign: 'left',
                                fontFamily: 'inherit',
                              },
                            },
                            h('span', { style: { fontFamily: T.mono } }, net.name),
                            h('span', { style: { fontSize: 10.5, color: T.muted } }, `${net.pins.length} ${t('inspector.pins')}`),
                          ),
                        ),
                      )
                    : null,
                  ui.railColour && rails.length > 0
                    ? h(
                        'div',
                        {
                          style: {
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            width: 194,
                            maxHeight: 'calc(100% - 16px)',
                            overflowY: 'auto',
                            border: T.border,
                            borderRadius: 10,
                            background: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #fff))',
                            padding: '7px 9px',
                            fontSize: 10.5,
                            lineHeight: 1.55,
                          },
                        },
                        h(
                          'div',
                          { style: { color: T.muted, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 } },
                          t('rail.title'),
                        ),
                        rails.map((rail) =>
                          railEdit === rail.name
                            ? h(
                                'div',
                                { key: rail.name, style: { display: 'flex', alignItems: 'center', gap: 4, margin: '1px 0' } },
                                h('span', { style: { width: 9, height: 9, borderRadius: 2, background: rail.colour, flex: 'none' } }),
                                h('input', {
                                  autoFocus: true,
                                  defaultValue: rail.label && rail.label !== rail.name ? rail.label : '',
                                  placeholder: t('rail.labelPlaceholder'),
                                  onKeyDown: (event) => {
                                    if (event.key === 'Enter') saveRailLabel(rail.name, event.currentTarget.value)
                                    if (event.key === 'Escape') setRailEdit(null)
                                  },
                                  onBlur: (event) => saveRailLabel(rail.name, event.currentTarget.value),
                                  style: {
                                    ...INPUT,
                                    flex: 1,
                                    minWidth: 0,
                                    padding: '1px 4px',
                                    fontSize: 10.5,
                                    fontFamily: T.mono,
                                  },
                                }),
                              )
                            : h(
                                'div',
                                { key: rail.name, style: { display: 'flex', alignItems: 'center', gap: 6 } },
                                h('span', { style: { width: 9, height: 9, borderRadius: 2, background: rail.colour, flex: 'none' } }),
                                h(
                                  'button',
                                  {
                                    type: 'button',
                                    title: `${rail.name} — ${t('rail.labelHint')}`,
                                    onClick: () => setRailEdit(rail.name),
                                    style: {
                                      background: 'transparent',
                                      border: 'none',
                                      padding: 0,
                                      font: 'inherit',
                                      fontFamily: T.mono,
                                      color: 'inherit',
                                      textAlign: 'left',
                                      cursor: 'pointer',
                                      flex: 1,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    },
                                  },
                                  rail.label && rail.label !== rail.name ? rail.label : rail.name,
                                ),
                                h(
                                  'span',
                                  { style: { color: T.muted, flex: 'none' } },
                                  rail.voltage === null ? `${rail.pads} ${t('rail.pads')}` : `${rail.voltage} V`,
                                ),
                              ),
                        ),
                        h(
                          'div',
                          { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, color: T.muted } },
                          h('span', {
                            style: { width: 9, height: 9, borderRadius: 2, background: T.muted, opacity: 0.35, flex: 'none' },
                          }),
                          t('rail.unassigned'),
                        ),
                      )
                    : null,
                  notice
                    ? h(
                        'div',
                        {
                          style: {
                            position: 'absolute',
                            bottom: 8,
                            left: 8,
                            right: 8,
                            fontSize: 11,
                            color: T.muted,
                            background: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #fff))',
                            border: T.border,
                            borderRadius: 8,
                            padding: '5px 8px',
                          },
                        },
                        notice,
                      )
                    : null,
                ),
                statusBar,
              )
            : h(
                'div',
                {
                  style: {
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: T.border,
                    borderRadius: 12,
                    padding: 28,
                    textAlign: 'center',
                    gap: 10,
                  },
                },
                h(
                  'div',
                  { style: { fontSize: 26, fontWeight: 680, letterSpacing: -0.4 } },
                  t('panel.empty.title'),
                  h('span', { style: { color: T.brand, fontStyle: 'italic', marginLeft: 8 } }, t('panel.empty.accent')),
                ),
                h('div', { style: { fontSize: 13, color: T.muted, maxWidth: 460, lineHeight: 1.55 } }, t('panel.empty.body')),
                h(
                  'div',
                  { style: { display: 'flex', gap: 8, marginTop: 6 } },
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => fileInputRef.current?.click(),
                      style: {
                        ...BUTTON,
                        background: T.brand,
                        borderColor: 'transparent',
                        color: 'var(--dsw-alias-bg-base, #ffffff)',
                        fontWeight: 600,
                        padding: '8px 16px',
                      },
                    },
                    busy === 'import' ? t('panel.importing') : t('panel.empty.choose'),
                  ),
                ),
                formats.length > 0
                  ? h(
                      'div',
                      {
                        style: {
                          display: 'flex',
                          gap: 5,
                          flexWrap: 'wrap',
                          justifyContent: 'center',
                          maxWidth: 460,
                          marginTop: 8,
                        },
                      },
                      h('div', { style: { width: '100%', fontSize: 10.5, color: T.muted, letterSpacing: 0.5, textTransform: 'uppercase' } }, t('panel.empty.formats')),
                      formats.map((format) => h('span', { key: format, className: 'wb-chip' }, format)),
                    )
                  : null,
                indexError ? h('div', { style: { fontSize: 12, color: T.danger } }, `${t('panel.error')}: ${indexError}`) : null,
              )

          // --- guided triage --------------------------------------------------
          // A selective path for the common case: pick the symptom, pick the
          // rail, say what you measured, and the panel marks it and ranks what
          // to probe. No typing, no model call — and only then does it offer to
          // hand the same brief to the agent for the reasoning it cannot do.
          const chipRow = (options, selected, onPick) =>
            h(
              'div',
              { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
              options.map((option) =>
                h(
                  'button',
                  {
                    key: option.id,
                    type: 'button',
                    onClick: () => onPick(option.id),
                    style: {
                      ...BUTTON,
                      padding: '3px 9px',
                      fontSize: 11,
                      borderColor: selected === option.id ? T.brand : undefined,
                      color: selected === option.id ? T.brand : 'inherit',
                      background: selected === option.id ? 'color-mix(in srgb, currentColor 8%, transparent)' : 'transparent',
                    },
                  },
                  option.label,
                ),
              ),
            )

          const triageBrief = () => {
            const rail = triage.rail
              ? `${rails.find((entry) => entry.name === triage.rail)?.label ?? triage.rail}`
              : 'an unknown rail'
            const symptom = triage.symptom ? t(`triage.symptom.${triage.symptom}`) : 'an unreported fault'
            const finding = triage.finding ? t(`triage.finding.${triage.finding}`) : 'not measured yet'
            return [
              `Board: ${board?.meta?.name ?? activeMeta?.name ?? 'unknown'} (focused in the WrenchBench panel).`,
              `Symptom: ${symptom}.`,
              `Rail in question: ${rail}${triage.rail ? ` (${triage.rail})` : ''}.`,
              `Measured: ${finding}.`,
              triageProbe.length > 0
                ? `Easiest points on that rail: ${triageProbe.map((point) => point.label).join(', ')}.`
                : '',
              'Work this as a bench interview: one question per turn with options, then record what I measure.',
            ]
              .filter(Boolean)
              .join('\n')
          }

          const triagePane = h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 } },
            h(SectionLabel, null, t('triage.title')),
            h('div', { style: { fontSize: 11.5, color: T.muted, lineHeight: 1.5 } }, t('triage.hint')),

            h(
              'div',
              { style: { border: T.border, borderRadius: 10, padding: 9, display: 'flex', flexDirection: 'column', gap: 7 } },
              h('div', { style: { fontSize: 11, color: T.muted } }, `1 · ${t('triage.step.symptom')}`),
              chipRow(
                [
                  { id: 'noPower', label: t('triage.symptom.noPower') },
                  { id: 'noDisplay', label: t('triage.symptom.noDisplay') },
                  { id: 'shutdown', label: t('triage.symptom.shutdown') },
                  { id: 'liquid', label: t('triage.symptom.liquid') },
                ],
                triage.symptom,
                (id) => setTriage((existing) => ({ ...existing, symptom: existing.symptom === id ? null : id })),
              ),
              h('div', { style: { fontSize: 11, color: T.muted } }, `2 · ${t('triage.step.rail')}`),
              rails.length > 0
                ? chipRow(
                    rails.slice(0, 8).map((rail) => ({
                      id: rail.name,
                      label: `${rail.label && rail.label !== rail.name ? rail.label : rail.name}`,
                    })),
                    triage.rail,
                    (id) => setTriage((existing) => ({ ...existing, rail: existing.rail === id ? null : id })),
                  )
                : h('div', { style: { fontSize: 11, color: T.muted } }, t('rail.none')),
              h('div', { style: { fontSize: 11, color: T.muted } }, `3 · ${t('triage.step.finding')}`),
              chipRow(
                [
                  { id: 'shortToGround', label: t('triage.finding.shortToGround') },
                  { id: 'short', label: t('triage.finding.short') },
                  { id: 'open', label: t('triage.finding.open') },
                  { id: 'unknown', label: t('triage.finding.unknown') },
                ],
                triage.finding,
                (id) => setTriage((existing) => ({ ...existing, finding: existing.finding === id ? null : id })),
              ),
              h(
                'div',
                { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
                h(
                  'button',
                  {
                    type: 'button',
                    disabled: !triage.rail || !triage.finding || triage.finding === 'unknown' || markBusy,
                    onClick: () => {
                      const kind =
                        triage.finding === 'shortToGround'
                          ? 'short-to-ground'
                          : triage.finding === 'short'
                            ? 'short'
                            : 'open'
                      markFor(kind, { net: triage.rail })
                    },
                    style: { ...BUTTON, padding: '4px 10px', fontSize: 11.5, borderColor: T.danger, color: T.danger },
                  },
                  t('triage.apply'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    disabled: !board,
                    onClick: () => {
                      setAskText(triageBrief())
                      setTab('agent')
                    },
                    style: { ...BUTTON, padding: '4px 10px', fontSize: 11.5, borderColor: T.brand, color: T.brand },
                  },
                  t('triage.ask'),
                ),
              ),
            ),

            triageProbe.length > 0
              ? h(
                  'div',
                  { style: { border: T.border, borderRadius: 10, padding: 9, display: 'flex', flexDirection: 'column', gap: 3 } },
                  h(
                    'div',
                    { style: { fontSize: 10.5, color: T.muted, letterSpacing: 0.4, textTransform: 'uppercase' } },
                    `${t('probe.title')} ${rails.find((entry) => entry.name === triage.rail)?.label ?? triage.rail}`,
                  ),
                  triageProbe.map((point) =>
                    h(
                      'button',
                      {
                        key: point.refdes,
                        type: 'button',
                        onClick: () => zoomToPart(point.refdes),
                        style: {
                          display: 'flex',
                          gap: 6,
                          alignItems: 'baseline',
                          background: 'transparent',
                          border: 'none',
                          padding: '1px 0',
                          font: 'inherit',
                          fontSize: 11,
                          color: 'inherit',
                          textAlign: 'left',
                          cursor: 'pointer',
                        },
                      },
                      h('span', { style: { fontFamily: T.mono, minWidth: 46 } }, point.label),
                      h('span', { style: { color: T.muted, flex: 1 } }, point.value ?? `${point.pins} ${t('inspector.pins')}`),
                    ),
                  ),
                )
              : null,

            (checks?.suspects ?? []).length > 0
              ? h(
                  'div',
                  { style: { border: T.border, borderRadius: 10, padding: 9, display: 'flex', flexDirection: 'column', gap: 5, minHeight: 0, overflowY: 'auto' } },
                  h('div', { style: { fontSize: 10.5, color: T.muted, letterSpacing: 0.4, textTransform: 'uppercase' } }, t('checks.title')),
                  checks.suspects.slice(0, 6).map((suspect, rank) =>
                    h(
                      'div',
                      { key: suspect.refdes, style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11.5 } },
                        h(
                          'span',
                          {
                            style: {
                              width: 15,
                              height: 15,
                              borderRadius: 999,
                              fontSize: 9.5,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: rank === 0 ? T.danger : T.brand,
                              color: 'var(--dsw-alias-bg-base, #ffffff)',
                              flex: 'none',
                            },
                          },
                          String(rank + 1),
                        ),
                        h('span', { style: { fontFamily: T.mono, fontWeight: 600 } }, aliases[suspect.refdes]?.alias ?? suspect.refdes),
                        h('span', { style: { flex: 1 } }),
                        h(
                          'button',
                          {
                            type: 'button',
                            onClick: () => focusRefdes(suspect.refdes),
                            style: { ...BUTTON, padding: '1px 7px', fontSize: 10.5 },
                          },
                          t('triage.focus'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            onClick: () => markFor('ok', { refdes: suspect.refdes }),
                            style: { ...BUTTON, padding: '1px 7px', fontSize: 10.5 },
                          },
                          t('mark.ok'),
                        ),
                      ),
                      h('div', { style: { fontSize: 10.5, color: T.muted, lineHeight: 1.4 } }, (suspect.evidence ?? []).slice(0, 2).join('; ')),
                    ),
                  ),
                )
              : null,
          )

          const inspector = board
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 } },
                h(SectionLabel, null, t('inspector.title')),
                !inspectedPart && !selection.net
                  ? h('div', { style: { fontSize: 12, color: T.muted, lineHeight: 1.5 } }, t('inspector.none'))
                  : h(
                      'div',
                      { style: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 } },
                      inspectedPart
                        ? h(
                            'div',
                            { style: { border: T.border, borderRadius: 10, padding: 10, background: T.layer1 } },
                            h(
                              'div',
                              { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
                              h(
                                'div',
                                { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
                                h(
                                  'div',
                                  { style: { fontSize: 15, fontWeight: 650, fontFamily: T.mono } },
                                  aliases[inspectedPart.refdes]?.alias ?? inspectedPart.refdes,
                                ),
                                aliases[inspectedPart.refdes]?.alias
                                  ? h(
                                      'div',
                                      { style: { fontSize: 10.5, color: T.muted, fontFamily: T.mono } },
                                      `boardview label ${inspectedPart.refdes}${
                                        inspectedPart.value ? ` · ${inspectedPart.value}` : ''
                                      }`,
                                    )
                                  : inspectedPart.value
                                    ? h(
                                        'div',
                                        { style: { fontSize: 10.5, color: T.muted, fontFamily: T.mono } },
                                        `marking ${inspectedPart.value}`,
                                      )
                                    : null,
                              ),
                              h('span', { className: 'wb-chip' }, inspectedPart.layer),
                              h('span', { className: 'wb-chip' }, inspectedPart.smd ? t('inspector.smd') : t('inspector.throughHole')),
                            ),
                            h(
                              'div',
                              { style: { fontSize: 11, color: T.muted, marginTop: 3, fontFamily: T.mono } },
                              `${inspectedPart.pins} ${t('inspector.pins')} · ${t('inspector.position')} ${(
                                (inspectedPart.bbox.x1 + inspectedPart.bbox.x2) / 2
                              ).toFixed(1)}, ${((inspectedPart.bbox.y1 + inspectedPart.bbox.y2) / 2).toFixed(1)}`,
                            ),
                            inspectedRail || inspectedPart.pins > 0
                              ? h(
                                  'div',
                                  { style: { fontSize: 11, marginTop: 3, fontFamily: T.mono, color: T.muted } },
                                  `${t('rail.title')}: ${
                                    inspectedRail
                                      ? (rails.find((rail) => rail.name === inspectedRail)?.label ?? inspectedRail)
                                      : t('rail.unassigned')
                                  }`,
                                )
                              : null,
                            inspectedPinout
                              ? h(
                                  'div',
                                  { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 } },
                                  [
                                    ['power', t('pinout.power'), T.brand],
                                    ['ground', t('pinout.ground'), T.muted],
                                    ['signal', t('pinout.signal'), T.muted],
                                    ['nc', t('pinout.nc'), T.muted],
                                  ]
                                    .filter(([kind]) => inspectedPinout[kind] > 0)
                                    .map(([kind, label, colour]) =>
                                      h(
                                        'span',
                                        { key: kind, className: 'wb-chip', style: { color: colour } },
                                        `${label} ${inspectedPinout[kind]}`,
                                      ),
                                    ),
                                )
                              : null,
                            probePoints.length > 0
                              ? h(
                                  'div',
                                  { style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 } },
                                  h(
                                    'div',
                                    { style: { fontSize: 10.5, color: T.muted, letterSpacing: 0.4, textTransform: 'uppercase' } },
                                    `${t('probe.title')} ${probePoints[0].railLabel}`,
                                  ),
                                  probePoints.map((point) =>
                                    h(
                                      'button',
                                      {
                                        key: point.refdes,
                                        type: 'button',
                                        onClick: () => zoomToPart(point.refdes),
                                        style: {
                                          display: 'flex',
                                          alignItems: 'baseline',
                                          gap: 6,
                                          background: 'transparent',
                                          border: 'none',
                                          padding: '1px 0',
                                          cursor: 'pointer',
                                          font: 'inherit',
                                          fontSize: 11,
                                          color: 'inherit',
                                          textAlign: 'left',
                                        },
                                      },
                                      h('span', { style: { fontFamily: T.mono, minWidth: 46 } }, point.label),
                                      h(
                                        'span',
                                        { style: { color: T.muted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                                        point.value ? point.value : `${point.pins} ${t('inspector.pins')}`,
                                      ),
                                      h('span', { style: { color: T.muted, fontSize: 10 } }, `${point.distance} mm`),
                                    ),
                                  ),
                                  probeMore > 0
                                    ? h(
                                        'div',
                                        { style: { fontSize: 10.5, color: T.muted } },
                                        `+ ${probeMore} ${t('probe.more')}`,
                                      )
                                    : null,
                                )
                              : null,
                            h(
                              'div',
                              { style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 } },
                              inspectedPins.slice(0, 40).map((pin) =>
                                h(
                                  'button',
                                  {
                                    key: `pin-${pin.index}`,
                                    type: 'button',
                                    onClick: () =>
                                      setSelection({
                                        refdes: inspectedPart.refdes,
                                        net: pin.net,
                                        pin: pin.index,
                                        annotation: null,
                                      }),
                                    style: {
                                      display: 'flex',
                                      gap: 8,
                                      alignItems: 'baseline',
                                      appearance: 'none',
                                      border: 'none',
                                      background:
                                        selection.pin === pin.index ? 'color-mix(in srgb, currentColor 10%, transparent)' : 'transparent',
                                      color: 'inherit',
                                      cursor: 'pointer',
                                      borderRadius: 6,
                                      padding: '2px 5px',
                                      fontSize: 11.5,
                                      textAlign: 'left',
                                      fontFamily: 'inherit',
                                    },
                                  },
                                  h('span', { style: { fontFamily: T.mono, minWidth: 26, color: T.muted } }, String(pin.index)),
                                  h('span', { style: { fontFamily: T.mono, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, pin.net ?? '—'),
                                ),
                              ),
                            ),
                          )
                        : null,
                      selection.net
                        ? h(
                            'div',
                            { style: { border: T.border, borderRadius: 10, padding: 10, background: T.layer1 } },
                            h('div', { style: { fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: 0.4 } }, t('inspector.net')),
                            h('div', { style: { fontSize: 14, fontWeight: 650, fontFamily: T.mono, marginTop: 2 } }, selection.net),
                            h(
                              'div',
                              { style: { fontSize: 11, color: T.muted, marginTop: 6 } },
                              `${t('inspector.otherPins')} (${otherNetPins.length})`,
                            ),
                            h(
                              'div',
                              { style: { marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 } },
                              otherNetPins.map((entry) =>
                                h(
                                  'button',
                                  {
                                    key: `net-${entry.index}`,
                                    type: 'button',
                                    onClick: () => {
                                      const part = board.parts[entry.pin.part]
                                      if (part) setSelection({ refdes: part.refdes, net: selection.net, pin: entry.pin.index, annotation: null })
                                    },
                                    style: {
                                      ...BUTTON,
                                      padding: '1px 6px',
                                      fontSize: 10.5,
                                      fontFamily: T.mono,
                                      borderRadius: 6,
                                    },
                                  },
                                  `${board.parts[entry.pin.part]?.refdes ?? '?'}.${entry.pin.index}`,
                                ),
                              ),
                            ),
                          )
                        : null,
                    ),
                h(
                  'button',
                  {
                    type: 'button',
                    style: { ...BUTTON, justifyContent: 'center', display: 'flex' },
                    onClick: () => setTab('agent'),
                  },
                  t('inspector.askAbout'),
                ),
                h(
                  'div',
                  { style: { flex: 'none', maxHeight: '50%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 } },
                // --- bench marks -------------------------------------------
                h('div', { style: { height: 1, background: T.muted, opacity: 0.2 } }),
                h(SectionLabel, null, t('mark.title')),
                h(
                  'div',
                  { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
                  [
                    ['short', t('mark.short'), T.danger],
                    ['short-to-ground', t('mark.shortToGround'), T.danger],
                    ['open', t('mark.open'), T.muted],
                    ['ok', t('mark.ok'), 'var(--dsw-alias-state-success-primary, #3f9e6b)'],
                  ].map(([kind, label, colour]) =>
                    h(
                      'button',
                      {
                        key: kind,
                        type: 'button',
                        disabled: markBusy || !board,
                        onClick: () => markSelection(kind),
                        style: {
                          ...BUTTON,
                          padding: '3px 9px',
                          fontSize: 11,
                          borderColor: selection.refdes || selection.net ? colour : undefined,
                          color: selection.refdes || selection.net ? colour : T.muted,
                        },
                      },
                      label,
                    ),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      disabled: markBusy || observations.length === 0,
                      onClick: clearMarks,
                      style: { ...BUTTON, padding: '3px 9px', fontSize: 11, color: T.muted },
                    },
                    t('mark.clear'),
                  ),
                ),
                observations.length === 0
                  ? h('div', { style: { fontSize: 11, color: T.muted, lineHeight: 1.45 } }, t('mark.none'))
                  : h(
                      'div',
                      { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                      observations.map((item) =>
                        h(
                          'div',
                          { key: item.id, style: { fontSize: 11, fontFamily: T.mono, color: item.kind === 'ok' ? T.muted : T.danger } },
                          `${item.kind} ${item.refdes ? aliases[item.refdes]?.alias ?? item.refdes : ''}${
                            item.pin ? `.${item.pin}` : ''
                          }${item.net ? ` ${item.net}` : ''}${item.note ? ` — ${item.note}` : ''}`,
                        ),
                      ),
                    ),
                // --- ranked suspects ----------------------------------------
                h('div', { style: { height: 1, background: T.muted, opacity: 0.2 } }),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'baseline', gap: 6 } },
                  h('div', { style: { flex: 1 } }, h(SectionLabel, null, t('checks.title'))),
                  markBusy ? h('span', { style: { fontSize: 10, color: T.muted } }, t('checks.asking')) : null,
                ),
                (checks?.suspects ?? []).length === 0
                  ? h('div', { style: { fontSize: 11, color: T.muted, lineHeight: 1.45 } }, t('checks.none'))
                  : h(
                      'div',
                      { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
                      checks.suspects.map((suspect, rank) =>
                        h(
                          'div',
                          {
                            key: suspect.refdes,
                            style: {
                              border: T.border,
                              borderRadius: 8,
                              padding: '5px 7px',
                              fontSize: 11,
                              background: rank === 0 ? 'color-mix(in srgb, currentColor 7%, transparent)' : 'transparent',
                            },
                          },
                          h(
                            'div',
                            { style: { display: 'flex', alignItems: 'baseline', gap: 6 } },
                            h(
                              'span',
                              {
                                style: {
                                  width: 15,
                                  height: 15,
                                  flex: 'none',
                                  borderRadius: 999,
                                  fontSize: 9.5,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  background: rank === 0 ? T.danger : T.brand,
                                  color: 'var(--dsw-alias-bg-base, #ffffff)',
                                },
                              },
                              String(rank + 1),
                            ),
                            h('span', { style: { fontFamily: T.mono, fontWeight: 600 } }, suspect.refdes),
                            h('span', { style: { flex: 1 } }),
                            h('span', { style: { color: T.muted, fontSize: 10 } }, `${suspect.score}`),
                          ),
                          h(
                            'div',
                            { style: { color: T.muted, marginTop: 2, lineHeight: 1.4 } },
                            (suspect.evidence ?? []).slice(0, 2).join('; '),
                          ),
                        ),
                      ),
                      (checks.notes ?? []).length > 0
                        ? h(
                            'div',
                            { style: { fontSize: 10.5, color: T.muted, lineHeight: 1.4, marginTop: 2 } },
                            checks.notes.join(' '),
                          )
                        : null,
                    ),
                  ),
              )
            : h('div', { style: { fontSize: 12, color: T.muted } }, t('inspector.none'))

          const agentPane = h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 } },
            h('div', { style: { fontSize: 11.5, color: T.muted, lineHeight: 1.5 } }, t('agent.hint')),
            h('textarea', {
              value: askText,
              onChange: (event) => setAskText(event.currentTarget.value),
              placeholder: t('agent.placeholder'),
              rows: 3,
              style: {
                width: '100%',
                boxSizing: 'border-box',
                resize: 'vertical',
                fontSize: 12.5,
                padding: '7px 8px',
                borderRadius: 9,
                border: T.border,
                background: 'transparent',
                color: 'inherit',
                fontFamily: 'inherit',
                lineHeight: 1.45,
              },
            }),
            h(
              'div',
              { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              h(
                'button',
                {
                  type: 'button',
                  onClick: askAgent,
                  disabled: askState.status === 'sending' || askText.trim().length === 0 || !board,
                  style: {
                    ...BUTTON,
                    background: T.brand,
                    borderColor: 'transparent',
                    color: 'var(--dsw-alias-bg-base, #ffffff)',
                    fontWeight: 600,
                    padding: '6px 14px',
                  },
                },
                askState.status === 'sending' ? t('agent.sending') : t('agent.send'),
              ),
              selection.refdes
                ? h('span', { style: { fontSize: 11, color: T.muted, fontFamily: T.mono } }, `→ ${selection.refdes}`)
                : null,
            ),
            askState.status === 'sent'
              ? h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: T.muted } },
                  h('div', null, t('agent.sent')),
                  h(
                    'button',
                    { type: 'button', style: { ...BUTTON, alignSelf: 'flex-start' }, onClick: openConversation },
                    t('agent.openConversation'),
                  ),
                )
              : null,
            askState.status === 'no-session'
              ? h('div', { style: { fontSize: 12, color: T.muted } }, t('agent.noSession'))
              : null,
            askState.status === 'error'
              ? h('div', { style: { fontSize: 12, color: T.danger } }, askState.message)
              : null,
            h('div', { style: { height: 1, background: T.muted, opacity: 0.2 } }),
            inspector,
          )

          const schematicPane = h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1, overflowY: 'auto' } },
            !schematic
              ? h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  h('div', { style: { fontSize: 12, color: T.muted, lineHeight: 1.5 } }, t('schematic.empty')),
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => pdfInputRef.current?.click(),
                      disabled: !board || busy === 'pdf',
                      style: { ...BUTTON, alignSelf: 'flex-start', padding: '6px 14px' },
                    },
                    busy === 'pdf' ? t('schematic.uploading') : t('schematic.upload'),
                  ),
                )
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  h(
                    'div',
                    { style: { border: T.border, borderRadius: 10, padding: 9, background: T.layer1 } },
                    h('div', { style: { fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, schematic.name),
                    h(
                      'div',
                      { style: { fontSize: 11, color: T.muted, marginTop: 2 } },
                      `${schematic.stats?.pages ?? 0} ${t('schematic.pages')} · ${schematic.stats?.chars ?? 0} ${t('schematic.chars')}`,
                    ),
                    schematic.warnings?.length
                      ? h('div', { style: { fontSize: 10.5, color: T.danger, marginTop: 4 } }, schematic.warnings.join('; '))
                      : null,
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 6 } },
                    h('input', {
                      value: schematicQuery,
                      onChange: (event) => setSchematicQuery(event.currentTarget.value),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter') searchSchematicText()
                      },
                      placeholder: t('schematic.searchPlaceholder'),
                      'aria-label': t('schematic.search'),
                      style: {
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12,
                        padding: '5px 8px',
                        borderRadius: 8,
                        border: T.border,
                        background: 'transparent',
                        color: 'inherit',
                        fontFamily: 'inherit',
                      },
                    }),
                    h('button', { type: 'button', style: BUTTON, onClick: searchSchematicText }, t('schematic.search')),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => pdfInputRef.current?.click(),
                      disabled: busy === 'pdf',
                      style: { ...BUTTON, alignSelf: 'flex-start', fontSize: 11 },
                    },
                    busy === 'pdf' ? t('schematic.uploading') : t('schematic.replace'),
                  ),
                  (schematic.hits ?? []).length > 0
                    ? h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                        schematic.hits.map((hit, position) =>
                          h(
                            'div',
                            {
                              key: `hit-${position}`,
                              style: { border: T.border, borderRadius: 8, padding: 7, fontSize: 11.5, lineHeight: 1.45 },
                            },
                            h('span', { style: { fontFamily: T.mono, color: T.brand, marginRight: 6 } }, `p${hit.page}`),
                            hit.snippet,
                          ),
                        ),
                      )
                    : null,
                  (schematic.pages ?? []).length > 0 && (schematic.hits ?? []).length === 0
                    ? h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                        schematic.pages.slice(0, 40).map((page) =>
                          h(
                            'div',
                            { key: `page-${page.page}`, style: { fontSize: 11, color: T.muted, lineHeight: 1.4 } },
                            h('span', { style: { fontFamily: T.mono, color: T.brand, marginRight: 6 } }, `p${page.page}`),
                            (page.preview ?? '').slice(0, 110),
                          ),
                        ),
                      )
                    : null,
                  schematicQuery.trim().length > 0 && (schematic.hits ?? []).length === 0
                    ? h('div', { style: { fontSize: 12, color: T.muted } }, t('schematic.noMatches'))
                    : null,
                ),
          )

          const tabButton = (id, label) =>
            h(
              'button',
              {
                key: id,
                type: 'button',
                onClick: () => setTab(id),
                style: {
                  appearance: 'none',
                  border: T.border,
                  borderRadius: 999,
                  padding: '4px 11px',
                  fontSize: 11.5,
                  cursor: 'pointer',
                  color: 'inherit',
                  fontFamily: 'inherit',
                  background: tab === id ? 'color-mix(in srgb, currentColor 13%, transparent)' : 'transparent',
                  opacity: tab === id ? 1 : 0.76,
                },
              },
              label,
            )

          const rail = h(
            'aside',
            {
              style: {
                width: 292,
                flex: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                minHeight: 0,
                borderLeft: T.border,
                paddingLeft: 12,
              },
            },
            h(
              'div',
              { style: { display: 'flex', gap: 5 } },
              tabButton('board', t('tab.board')),
              tabButton('triage', t('tab.triage')),
              tabButton('agent', t('tab.agent')),
              tabButton('schematic', t('tab.schematic')),
            ),
            tab === 'triage' ? triagePane : tab === 'agent' ? agentPane : tab === 'schematic' ? schematicPane : inspector,
          )

          // --- new-project wizard ---------------------------------------------
          // Opens by itself the first time the panel has nothing to show, and
          // from the header afterwards. Two zones, because the two files mean
          // different things: one is parsed as a board, the other is indexed as
          // reference text for it.
          const dropZone = (title, hint, onClick, busyLabel, active) =>
            h(
              'div',
              {
                onClick,
                style: {
                  border: active ? `2px dashed ${T.brand}` : T.border,
                  borderRadius: 12,
                  padding: '18px 16px',
                  cursor: 'pointer',
                  background: active ? 'color-mix(in srgb, currentColor 5%, transparent)' : 'transparent',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                },
              },
              h('div', { style: { fontSize: 13, fontWeight: 600 } }, title),
              h('div', { style: { fontSize: 11.5, color: T.muted, lineHeight: 1.5 } }, active ? busyLabel : hint),
            )

          const startupOverlay =
            startup === null
              ? null
              : h(
                  'div',
                  {
                    style: {
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 24,
                      background: 'color-mix(in srgb, var(--dsw-alias-bg-base, #ffffff) 82%, transparent)',
                      backdropFilter: 'blur(2px)',
                      zIndex: 10,
                    },
                    onDragOver: (event) => {
                      event.preventDefault()
                      event.stopPropagation()
                    },
                    onDrop: (event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      const file = event.dataTransfer?.files?.[0]
                      if (!file) return
                      if (startup.step === 'schematic') {
                        uploadSchematic(file).then((body) => {
                          if (body) setStartup({ step: 'done' })
                        })
                      } else {
                        importFile(file).then((body) => {
                          if (body) {
                            setStartupImported(body.enrichment ?? null)
                            setStartup({ step: 'schematic' })
                          }
                        })
                      }
                    },
                  },
                  h(
                    'div',
                    {
                      style: {
                        width: 'min(520px, 100%)',
                        border: T.border,
                        borderRadius: 14,
                        padding: '20px 22px',
                        background: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #ffffff))',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                        boxShadow: '0 12px 40px color-mix(in srgb, currentColor 16%, transparent)',
                      },
                    },
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
                      h('div', { style: { fontSize: 16, fontWeight: 650, flex: 1 } }, t('startup.title')),
                      h(
                        'button',
                        {
                          type: 'button',
                          style: { ...BUTTON, padding: '2px 8px', fontSize: 11 },
                          onClick: () => {
                            startupDismissed.current = true
                            setStartup(null)
                          },
                        },
                        t('startup.close'),
                      ),
                    ),
                    h('div', { style: { fontSize: 12, color: T.muted, lineHeight: 1.5 } }, t('startup.subtitle')),
                    startup.step === 'board'
                      ? dropZone(
                          t('startup.boardTitle'),
                          t('startup.boardHint'),
                          () => fileInputRef.current?.click(),
                          t('panel.importing'),
                          busy === 'import',
                        )
                      : null,
                    startup.step === 'board'
                      ? h(
                          'div',
                          { style: { fontSize: 11, color: T.muted, lineHeight: 1.5 } },
                          t('startup.boardHint2'),
                        )
                      : null,
                    startup.step === 'schematic' || startup.step === 'done'
                      ? h(
                          'div',
                          {
                            style: {
                              border: T.border,
                              borderRadius: 10,
                              padding: '8px 10px',
                              fontSize: 11.5,
                              background: T.layer1,
                            },
                          },
                          h('div', { style: { fontWeight: 600 } }, activeMeta?.name ?? t('startup.imported')),
                          h(
                            'div',
                            { style: { color: T.muted, marginTop: 2 } },
                            `${activeMeta?.stats?.components ?? activeMeta?.stats?.parts ?? 0} ${t('status.parts')} · ${
                              activeMeta?.stats?.pins ?? 0
                            } ${t('status.pins')} · ${activeMeta?.stats?.nets ?? 0} ${t('status.nets')}`,
                          ),
                          startupImported
                            ? h(
                                'div',
                                { style: { color: T.muted, marginTop: 2 } },
                                `${startupImported.roles?.components ?? 0} ${t('startup.components')}, ${
                                  startupImported.roles?.pads ?? 0
                                } ${t('startup.padEntries')}, ${startupImported.named ?? 0} ${t(
                                  'startup.namedFromSchematic',
                                )}${startupImported.ambiguous > 0 ? `, ${startupImported.ambiguous} ${t('startup.needReview')}` : ''}.`,
                              )
                            : null,
                        )
                      : null,
                    startup.step === 'schematic'
                      ? dropZone(
                          t('startup.schematicTitle'),
                          t('startup.schematicHint'),
                          () => pdfInputRef.current?.click(),
                          t('schematic.uploading'),
                          busy === 'pdf',
                        )
                      : null,
                    startup.step === 'schematic'
                      ? h(
                          'div',
                          { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                          h(
                            'button',
                            {
                              type: 'button',
                              style: { ...BUTTON, fontSize: 11.5 },
                              onClick: () => setStartup({ step: 'done' }),
                            },
                            t('startup.skip'),
                          ),
                          h('div', { style: { flex: 1, fontSize: 11, color: T.muted } }, t('startup.later')),
                        )
                      : null,
                    startup.step === 'done'
                      ? h(
                          'div',
                          { style: { display: 'flex', gap: 8 } },
                          h(
                            'button',
                            {
                              type: 'button',
                              style: { ...BUTTON, fontSize: 12, borderColor: T.brand, color: T.brand },
                              onClick: () => {
                                startupDismissed.current = true
                                setStartup(null)
                              },
                            },
                            t('startup.open'),
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              style: { ...BUTTON, fontSize: 12 },
                              onClick: () => {
                                setStartupImported(null)
                                setStartup({ step: 'board' })
                              },
                            },
                            t('startup.another'),
                          ),
                        )
                      : null,
                  ),
                )

          return h(
            'div',
            {
              ref: panelRef,
              'data-wrenchbench': '',
              'aria-label': t('nav.aria'),
              onDragOver: (event) => {
                event.preventDefault()
                if (!dragging) setDragging(true)
              },
              onDragLeave: () => setDragging(false),
              onDrop: (event) => {
                event.preventDefault()
                setDragging(false)
                const file = event.dataTransfer?.files?.[0]
                if (!file) return
                if (/\.pdf$/i.test(file.name)) uploadSchematic(file)
                else importFile(file)
              },
              style: {
                boxSizing: 'border-box',
                position: 'relative',
                height: '100%',
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                padding: '16px 20px',
                color: 'inherit',
                outline: dragging ? `2px dashed ${T.brand}` : 'none',
                outlineOffset: -8,
              },
            },
            h('style', null, PANEL_CSS),
            header,
            h(
              'div',
              { style: { flex: 1, minHeight: 0, display: 'flex', gap: 12 } },
              library,
              h('div', { style: { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' } }, canvasArea),
              rail,
            ),
            startupOverlay,
            dragging
              ? h(
                  'div',
                  {
                    style: {
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      pointerEvents: 'none',
                      fontSize: 15,
                      fontWeight: 600,
                      color: T.brand,
                      background: 'color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 72%, transparent)',
                      borderRadius: 10,
                    },
                  },
                  t('panel.drop'),
                )
              : null,
            focus && focus.boardId === activeId && (focus.refdes || focus.net)
              ? h(
                  'div',
                  {
                    style: {
                      position: 'absolute',
                      top: 8,
                      right: 20,
                      fontSize: 10.5,
                      color: T.muted,
                      border: T.border,
                      borderRadius: 999,
                      padding: '2px 9px',
                      background: T.layer1,
                    },
                  },
                  `agent → ${[focus.refdes, focus.net ? `net ${focus.net}` : null, focus.pin ? `pin ${focus.pin}` : null].filter(Boolean).join(', ')}`,
                )
              : null,
          )
        }

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'wrenchbench', order: 6, label: () => t('nav.label') },
            Icon,
          ),
        )
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'wrenchbench' }, WrenchBenchPanel))
      },
    }
  },
})
