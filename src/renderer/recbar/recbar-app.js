/* 录制控制条：计时 + 停止/取消，按住非按钮区可拖动窗口 */
window.RecBarApp = {
  template: '#tpl-recbar',
  data() {
    return { timeText: '00:00', stopped: false };
  },
  created() {
    const bridge = window.api;
    bridge.on('rec:mode', ({ mode }) => {
      if (mode !== 'live') return;
      this.stopped = false;
      this.timeText = '00:00';
    });
    bridge.on('rec:tick', ({ seconds }) => { this.timeText = this.fmt(seconds); });
  },
  methods: {
    fmt(s) {
      const m = Math.floor(s / 60);
      const ss = s % 60;
      return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    },
    stop() {
      this.stopped = true;
      window.api.invoke('rec:stop');
    },
    cancel() {
      window.api.invoke('rec:cancel');
    },
    // 拖动：按下非按钮区域即移动窗口（屏幕坐标增量交给主进程）
    onDragDown(e) {
      if (e.button !== 0 || (e.target && e.target.tagName === 'BUTTON')) return;
      e.preventDefault();
      window.api.invoke('rec:bar-drag-start', { x: e.screenX, y: e.screenY });
      const onMove = (ev) => window.api.invoke('rec:bar-drag-move', { x: ev.screenX, y: ev.screenY });
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        window.api.invoke('rec:bar-drag-end');
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
  },
};