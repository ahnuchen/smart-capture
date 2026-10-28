/* 浮动工具条（Vue 2）
 * 单行 = 8 个标注工具 | 撤销·重做·清除 | ✕ 保存 ✔
 * 样式行常驻可点：未选工具时改的是「默认样式」，之后选中的工具自动继承；
 * 每个工具各记一份颜色/线宽。条目数固定 → #bar 尺寸恒定，窗口不会被重排。
 */
(function () {
  const bridge = window.api;

  const svg = (d, vb = '0 0 16 16') =>
    `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`;

  const ICONS = {
    rect: svg('M2.2 3.4 h11.6 a0.9 0.9 0 0 1 0.9 0.9 v7.4 a0.9 0.9 0 0 1 -0.9 0.9 h-11.6 a0.9 0.9 0 0 1 -0.9 -0.9 v-7.4 a0.9 0.9 0 0 1 0.9 -0.9 z M3.2 5.2 v6.4 h9.6 v-6.4 z'),
    ellipse: svg('M8 2.9 C4.6 2.9 1.9 5.1 1.9 8 c0 2.9 2.7 5.1 6.1 5.1 s6.1 -2.2 6.1 -5.1 c0 -2.9 -2.7 -5.1 -6.1 -5.1 z M8 4.4 c3.1 0 4.6 1.8 4.6 3.6 s-1.5 3.6 -4.6 3.6 s-4.6 -1.8 -4.6 -3.6 s1.5 -3.6 4.6 -3.6 z'),
    line: svg('M2.6 13.4 L13.4 2.6 L14.2 3.4 L3.4 14.2 z'),
    arrow: svg('M2.4 13.9 L12.3 4.0 L10.3 4.0 L10.3 2.3 L15.0 2.3 L15.0 7.0 L13.3 7.0 L13.3 5.0 L3.4 14.9 z'),
    pencil: svg('M11.2 1.9 l2.9 2.9 -8.4 8.4 -3.7 0.8 0.8 -3.7 z M10.4 3.4 l-6.6 6.6 -0.4 1.6 1.6 -0.4 6.6 -6.6 -1.2 -1.2 z'),
    highlighter: svg('M3.0 9.0 l6.0 -6.0 3.0 3.0 -6.0 6.0 -3.6 0.6 z M1.8 13.4 h12.4 v1.4 h-12.4 z'),
    mosaic: svg('M1.8 1.8 h3.4 v3.4 h-3.4 z M6.3 1.8 h3.4 v3.4 h-3.4 z M10.8 1.8 h3.4 v3.4 h-3.4 z M1.8 6.3 h3.4 v3.4 h-3.4 z M10.8 6.3 h3.4 v3.4 h-3.4 z M6.3 10.8 h3.4 v3.4 h-3.4 z M1.8 10.8 h3.4 v3.4 h-3.4 z M10.8 10.8 h3.4 v3.4 h-3.4 z'),
    text: svg('M3.4 1.8 h9.2 v2.6 h-1.5 v-1.1 h-2.5 v10.2 h1.6 v1.5 h-4.6 v-1.5 h1.6 v-10.2 h-2.5 v1.1 h-1.5 z'),
    pin: svg('M9.4 1.6 a1.6 1.6 0 0 1 2.3 0 l2.7 2.7 a1.6 1.6 0 0 1 0 2.3 l-1.2 1.2 -1.4 -1.4 -4.6 4.6 v1.6 h-1.6 l-1.6 -1.6 -1.6 1.6 -1.0 -1.0 1.6 -1.6 -1.6 -1.6 v-1.6 h1.6 l4.6 -4.6 -1.4 -1.4 z'),
    save: svg('M2.2 1.7 h9.2 l2.4 2.4 v8.2 a1.2 1.2 0 0 1 -1.2 1.2 h-10.4 a1.2 1.2 0 0 1 -1.2 -1.2 v-9.4 a1.2 1.2 0 0 1 1.2 -1.2 z M4.2 2.9 v2.6 h6.4 v-2.6 z M4.6 11.4 h6.8 v3.0 h-6.8 z M3.5 7.0 h9.0 v3.2 h-9.0 z M4.7 8.2 v0.9 h6.6 v-0.9 z'),
    undo: svg('M6.2 4.6 L2.6 8.0 L6.2 11.4 L7.4 10.2 L5.8 8.6 h4.2 a2.6 2.6 0 0 0 0 -5.2 h-2.2 v1.6 h2.2 a1.0 1.0 0 0 1 0 2.0 h-4.2 l1.6 -1.6 z'),
    redo: svg('M9.8 4.6 L13.4 8.0 L9.8 11.4 L8.6 10.2 L10.2 8.6 h-4.2 a2.6 2.6 0 0 1 0 -5.2 h2.2 v1.6 h-2.2 a1.0 1.0 0 0 0 0 2.0 h4.2 l-1.6 -1.6 z'),
    clear: svg('M5.4 1.8 h5.2 l0.9 1.4 h3.1 v1.6 h-1.8 v8.0 a1.2 1.2 0 0 1 -1.2 1.2 h-5.6 a1.2 1.2 0 0 1 -1.2 -1.2 v-8.0 h-1.8 v-1.6 h3.1 z M6.6 4.8 v6.6 h1.2 v-6.6 z M8.8 4.8 v6.6 h1.2 v-6.6 z'),
  };

  const TOOLS = [
    { id: 'rect', icon: ICONS.rect, key: 'tb.rect' },
    { id: 'ellipse', icon: ICONS.ellipse, key: 'tb.ellipse' },
    { id: 'line', icon: ICONS.line, key: 'tb.line' },
    { id: 'arrow', icon: ICONS.arrow, key: 'tb.arrow' },
    { id: 'pencil', icon: ICONS.pencil, key: 'tb.pencil' },
    { id: 'highlighter', icon: ICONS.highlighter, key: 'tb.highlight' },
    { id: 'mosaic', icon: ICONS.mosaic, key: 'tb.mosaic' },
    { id: 'text', icon: ICONS.text, key: 'tb.text' },
  ];

  function initialTool() {
    const saved = sessionStorage.getItem('tb.tool') || null;
    return TOOLS.some((x) => x.id === saved) ? saved : null;
  }

  window.ToolbarApp = {
    template: '#tpl-toolbar',
    data() {
      return {
        tools: TOOLS,
        // 左侧拖拽手柄：2 列 × 3 行圆点
        gripIcon: '<svg viewBox="0 0 12 18" xmlns="http://www.w3.org/2000/svg">' +
          [3.6, 9, 14.4].map((cy) => [3.6, 8.4].map((cx) => '<circle cx="' + cx + '" cy="' + cy + '" r="1.7"/>').join('')).join('') +
          '</svg>',
        icons: ICONS,
        colors: ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#af52de', '#000000', '#ffffff'],
        widths: [2, 4, 7],
        textSizes: [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 84, 96],
        activeTool: initialTool(),
        defaultStyle: { color: '#ff3b30', width: 4, size: 20 },
        styles: {}, // toolId -> { color, width }，首次使用时从 defaultStyle 继承
        agents: [],
        defaultAgentId: null,
        autoAnalyze: false,
      };
    },
    computed: {
      currentStyle() {
        return this.activeTool ? this.styleFor(this.activeTool) : this.defaultStyle;
      },
    },
    created() {
      this._offs = [];
      const off = bridge.on('toolbar:init', (payload) => this.onInit(payload));
      if (off) this._offs.push(off);
      this._onKey = (e) => {
        if (e.key === 'Escape') bridge.invoke('shot:reselect').catch(() => {});
        else if (e.key === 'Enter') bridge.invoke('shot:copy-finish').catch(() => {});
      };
      document.addEventListener('keydown', this._onKey);
    },
    mounted() {
      this.reportSize();
    },
    beforeDestroy() {
      this._offs.forEach((f) => f && f());
      document.removeEventListener('keydown', this._onKey);
    },
    methods: {
      styleFor(id) {
        if (!this.styles[id]) this.$set(this.styles, id, { ...this.defaultStyle });
        return this.styles[id];
      },
      onInit(payload) {
        const p = payload || {};
        this.agents = p.agents || [];
        this.defaultAgentId = p.defaultAgentId || null;
        this.autoAnalyze = !!p.autoAnalyze;
        this.$nextTick(() => this.reportSize());
        // 渲染层重载后恢复的工具：补发一次让覆盖窗跟上
        if (this.activeTool) {
          const st = this.styleFor(this.activeTool);
          this.act({ type: 'tool', value: this.activeTool, color: st.color, width: st.width, size: st.size });
        }
      },
      toggleTool(id) {
        this.activeTool = this.activeTool === id ? null : id; // 再点一次 = 取消
        sessionStorage.setItem('tb.tool', this.activeTool || '');
        const st = this.activeTool ? this.styleFor(this.activeTool) : null;
        this.act({
          type: 'tool', value: this.activeTool,
          color: st ? st.color : null,
          width: st ? st.width : null,
          size: st ? st.size : null,
        });
        this.$nextTick(() => this.reportSize());
      },
      // 拖动工具条：用屏幕坐标增量移动窗口（主进程 setBounds）
      startDrag(e) {
        if (e.button !== 0) return;
        bridge.invoke('toolbar:drag-start', { x: e.screenX, y: e.screenY });
        const onMove = (ev) => bridge.invoke('toolbar:drag-move', { x: ev.screenX, y: ev.screenY });
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          bridge.invoke('toolbar:drag-end');
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      },
      pickColor(c) {
        this.currentStyle.color = c;
        this.act({ type: 'color', value: c });
      },
      pickWidth(w) {
        this.currentStyle.width = w;
        this.act({ type: 'width', value: w });
      },
      // 文字工具专用：字号走独立通道，不再借用线宽
      pickSize(size) {
        this.currentStyle.size = size;
        this.act({ type: 'size', value: size });
      },
      agentTitle(a) {
        const keep = (a.systemPrompt || '').slice(0, 120);
        const isDefault = this.autoAnalyze && a.id === this.defaultAgentId;
        return keep + (isDefault ? '\n' + this.$t('tb.defaultAuto') : '');
      },
      act(payload) {
        bridge.invoke('toolbar:action', payload);
      },
      reportSize() {
        const bar = document.getElementById('bar');
        if (!bar) return;
        bridge.invoke('toolbar:size', { w: bar.offsetWidth + 4, h: bar.offsetHeight + 4 });
      },
    },
  };
})();
