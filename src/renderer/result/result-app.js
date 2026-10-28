/* 结果窗口（Vue 2）：流式 Markdown + KaTeX + 追问 + 切智能体。
 * 模板在 index.html 的 #tpl-result；#answer 仍是 v-html 宿主（内容已过 DOMPurify）。
 */
(function () {
  const bridge = window.api;
  marked.setOptions({ breaks: true, gfm: true });

  window.ResultApp = {
    template: '#tpl-result',
    data() {
      return {
        agentIcon: '🤖',
        agentName: '',
        modelMeta: '',
        previewSrc: '',
        agents: [],
        agentId: '',
        statusClass: '',
        statusText: '',
        streaming: false,
        followupMode: false, // 追问时不清空已有内容，续写在新答案后
        content: '',
        reasoning: '',
        streamTip: false,
        answerVisible: false,
        answerHtml: '',
        error: { visible: false, message: '' },
        followupText: '',
        flash: { result: false, image: false },
      };
    },
    computed: {
      copyResultLabel() {
        return this.flash.result ? this.$t('res.copied') : this.$t('res.copyResult');
      },
      copyImageLabel() {
        return this.flash.image ? this.$t('res.copied') : this.$t('res.copyImage');
      },
    },
    created() {
      this._renderPending = false;
      this._lastKatex = 0;
      this._offs = [];
      this._offs.push(bridge.on('result:init', (p) => this.onInit(p)));
      this._offs.push(bridge.on('result:stream', (p) => this.onStream(p)));
      this._onKey = (e) => {
        if (e.key !== 'Escape') return;
        const t = document.activeElement;
        const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        if (!typing) bridge.invoke('win:control', { action: 'close' });
      };
      document.addEventListener('keydown', this._onKey);
    },
    beforeDestroy() {
      this._offs.forEach((f) => f && f());
      document.removeEventListener('keydown', this._onKey);
    },
    mounted() {
      bridge.invoke('result:ready');
    },
    methods: {
      onInit(payload) {
        this.agentIcon = payload.agent.icon || '🤖';
        this.agentName = payload.agent.name;
        this.modelMeta = `${payload.providerName} · ${payload.modelName}` + (payload.vision ? '' : ' · ⚠ 非视觉模型，可能无法读图');
        this.previewSrc = payload.imageFull;
        this.agents = payload.agents || [];
        this.agentId = payload.agent.id;
        if (!payload.vision) {
          this.error = { visible: true, message: this.$t('res.visionWarn') };
        }
      },
      onStream({ kind, delta, message }) {
        if (kind === 'start') {
          this.streaming = true;
          this.error.visible = false;
          this.streamTip = true;
          if (!this.followupMode) {
            this.content = '';
            this.reasoning = '';
            this.answerVisible = false;
            this.answerHtml = '';
          }
          this.statusText = this.$t('res.analyzing');
          this.statusClass = 'running';
        } else if (kind === 'reasoning') {
          this.reasoning += delta;
        } else if (kind === 'content') {
          if (this.content === '' && delta) {
            this.streamTip = false;
            this.answerVisible = true;
          }
          this.content += delta;
          this.scheduleRender();
        } else if (kind === 'done') {
          this.streaming = false;
          this.followupMode = false;
          this.streamTip = false;
          this.renderAnswer(true);
          this.statusText = this.$t('res.done');
          this.statusClass = '';
        } else if (kind === 'error') {
          this.streaming = false;
          this.followupMode = false;
          this.streamTip = false;
          this.statusText = this.$t('res.error');
          this.statusClass = 'error';
          this.error = { visible: true, message: message || 'Unknown error' };
        }
      },
      // 节流渲染流式 markdown
      scheduleRender() {
        if (this._renderPending) return;
        this._renderPending = true;
        requestAnimationFrame(() => {
          this._renderPending = false;
          this.renderAnswer(false);
        });
      },
      renderAnswer(final) {
        const contentEl = this.$refs.content;
        const nearBottom = contentEl.scrollHeight - contentEl.scrollTop - contentEl.clientHeight < 90;
        this.answerVisible = true;
        this.answerHtml = DOMPurify.sanitize(marked.parse(this.content || (final ? this.$t('res.emptyContent') : '')));
        Vue.nextTick(() => {
          // KaTeX 渲染（流式期间每 600ms 一次，结束时必渲）
          const now = Date.now();
          if (typeof renderMathInElement === 'function' && (final || now - this._lastKatex > 600)) {
            this._lastKatex = now;
            try {
              renderMathInElement(document.getElementById('answer'), {
                delimiters: [
                  { left: '$$', right: '$$', display: true },
                  { left: '$', right: '$', display: false },
                  { left: '\\(', right: '\\)', display: false },
                  { left: '\\[', right: '\\]', display: true },
                ],
                throwOnError: false,
              });
            } catch (_) { /* 公式解析失败不影响文本 */ }
          }
          if (nearBottom) contentEl.scrollTop = contentEl.scrollHeight;
        });
      },
      sendFollowup() {
        const text = this.followupText.trim();
        if (!text || this.streaming) return;
        this.followupText = '';
        // 在界面上把追问追加到答案后面，随后模型回复继续接在其后
        this.content += `\n\n---\n\n**我：** ${text.replace(/\n/g, ' ')}\n\n`;
        this.followupMode = true;
        this.renderAnswer(true);
        bridge.invoke('result:followup', { text });
      },
      onAgentChange() {
        if (this.streaming) this.act({ type: 'stop' });
        this.act({ type: 'switch-agent', agentId: this.agentId });
      },
      copyResult() {
        if (!this.content) return;
        bridge.invoke('result:action', { type: 'copy-result', text: this.content });
        this.flashButton('result');
      },
      copyImage() {
        this.act({ type: 'copy-image' });
        this.flashButton('image');
      },
      flashButton(which) {
        this.flash[which] = true;
        setTimeout(() => { this.flash[which] = false; }, 1200);
      },
      togglePreview() {
        document.body.classList.toggle('preview-full');
        const full = document.body.classList.contains('preview-full');
        document.body.style.overflow = full ? 'auto' : 'hidden';
        this.$refs.content.style.display = full ? 'none' : 'block';
      },
      winOp(action) {
        bridge.invoke('win:control', { action });
      },
      act(payload) {
        bridge.invoke('result:action', payload);
      },
    },
  };
})();
