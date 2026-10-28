/* 覆盖窗外围 UI（Vue 2）：尺寸角标 / 提示条 / 十字线 / 取色器 / 调整热区。
 * 选区框 #sel、底图 #bg、变暗层 #dim、Fabric 画布 #annWrap 都在 Vue 之外，
 * 由 overlay.js 命令式驱动；这里只承接需要响应式渲染的部分。
 */
window.OverlayApp = {
  template: '#tpl-overlay',
  data() {
    return {
      mode: 'idle',
      rect: null, // {x,y,w,h} CSS 像素
      tip: { visible: false, left: 0, top: 0 },
      size: { visible: false, left: 0, top: 0, text: '' },
      cross: { visible: false, x: 0, y: 0 },
      picker: { visible: false, left: 0, top: 0, color: '#000000', text: '', pos: '' },
    };
  },
  computed: {
    adjVisible() {
      return this.mode === 'confirm' && !!this.rect;
    },
    handles() {
      const r = this.rect;
      if (!r) return [];
      const pts = {
        nw: [r.x, r.y], n: [r.x + r.w / 2, r.y], ne: [r.x + r.w, r.y], e: [r.x + r.w, r.y + r.h / 2],
        se: [r.x + r.w, r.y + r.h], s: [r.x + r.w / 2, r.y + r.h], sw: [r.x, r.y + r.h], w: [r.x, r.y + r.h / 2],
      };
      // 手柄必须排在边带之后（DOM 顺序 = 命中优先级，角/边中点要抢过移动带）
      return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((cur) => ({ cur, x: pts[cur][0], y: pts[cur][1] }));
    },
    bands() {
      const r = this.rect;
      if (!r) return [];
      // 热区 24px（见 .handle::after），边带在角上让位 12px，避免角手柄抢走边手柄的点击
      const BAND = 12;
      return [
        { side: 'n', left: r.x + BAND, top: r.y - BAND + 1, width: Math.max(0, r.w - BAND * 2), height: 24 },
        { side: 's', left: r.x + BAND, top: r.y + r.h - BAND + 1, width: Math.max(0, r.w - BAND * 2), height: 24 },
        { side: 'w', left: r.x - BAND + 1, top: r.y + BAND, width: 24, height: Math.max(0, r.h - BAND * 2) },
        { side: 'e', left: r.x + r.w - BAND + 1, top: r.y + BAND, width: 24, height: Math.max(0, r.h - BAND * 2) },
      ];
    },
    sizeStyle() {
      return { display: this.size.visible ? 'block' : 'none', left: this.size.left + 'px', top: this.size.top + 'px' };
    },
    tipStyle() {
      return { display: this.tip.visible ? 'block' : 'none', left: this.tip.left + 'px', top: this.tip.top + 'px' };
    },
    crossVStyle() {
      return { display: this.cross.visible ? 'block' : 'none', left: this.cross.x + 'px' };
    },
    crossHStyle() {
      return { display: this.cross.visible ? 'block' : 'none', top: this.cross.y + 'px' };
    },
    pickerStyle() {
      return {
        display: this.picker.visible ? 'block' : 'none',
        left: this.picker.left + 'px',
        top: this.picker.top + 'px',
      };
    },
  },
  methods: {
    adjustStart(kind, e) {
      if (this.onAdjustStart) this.onAdjustStart(kind, e);
    },
  },
};
