/* 录制预览窗：生成中 → 播放 → 复制到剪切板 / 保存。
 * 复制成功或保存成功后由主进程直接关窗；用户自己关掉 = 丢弃，不做任何动作。 */
window.PreviewApp = {
  template: '#tpl-preview',
  data() {
    return {
      phase: 'processing', // processing | ready | error
      kind: 'video', // video | image
      src: '',
      name: '',
      error: '',
      tip: '',
      busy: false,
    };
  },
  computed: {
    canAct() {
      return this.phase === 'ready' && !this.busy;
    },
  },
  created() {
    const bridge = window.api;
    bridge.on('preview:init', () => { this.phase = 'processing'; });
    bridge.on('preview:ready', (p) => {
      this.kind = p.kind === 'image' ? 'image' : 'video';
      this.src = p.src;
      this.name = p.name || '';
      this.phase = 'ready';
    });
    bridge.on('preview:error', (p) => {
      this.error = String((p && p.message) || '');
      this.phase = 'error';
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.winOp('close'); });
  },
  methods: {
    winOp(action) {
      window.api.invoke('win:control', { action });
    },
    async copy() {
      this.busy = true;
      const res = await window.api.invoke('preview:copy').catch((e) => ({ ok: false, error: e.message }));
      if (res && res.ok) return; // 主进程会关窗
      this.busy = false;
      this.tip = this.$t('preview.copyFail');
    },
    async save() {
      this.busy = true;
      const res = await window.api.invoke('preview:save').catch((e) => ({ ok: false, error: e.message }));
      if (res && res.ok) return; // 主进程会关窗
      this.busy = false;
    },
  },
};