/* 设置窗口（Vue 2）：模型服务 / 智能体 CRUD / 截图行为 / 通用。
 * 模板在 index.html 的 #tpl-settings。
 * providers 是按 id 键的对象：增删必须走 $set/$delete，并同步 providerIds 数组
 * （Vue 2 追踪不到 Object.keys）。保存契约不变：整份 settings 提交。
 */
(function () {
  const bridge = window.api;
  const AgentsShared = window.AgentsShared;

  // 存储用 Electron accelerator（CommandOrControl），展示用当前平台的按键名
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
  const SHORTCUT_KEY_NAMES = IS_MAC
    ? { CommandOrControl: '\u2318', Command: '\u2318', Control: '\u2303', Alt: '\u2325', Shift: '\u21e7', Space: '\u2423' }
    : { CommandOrControl: 'Ctrl', Command: 'Win', Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Space: 'Space' };
  function formatShortcut(accel) {
    return String(accel || '')
      .split('+')
      .map((part) => SHORTCUT_KEY_NAMES[part] || (part.length === 1 ? part.toUpperCase() : part))
      .join(IS_MAC ? '' : '+');
  }
  function buildAccelerator(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    let key = '';
    const code = e.code || '';
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
    else if (/^Digit\d$/.test(code)) key = code.slice(5);
    else if (/^F\d{1,2}$/.test(code)) key = code;
    else {
      const map = { Comma: ',', Period: '.', Slash: '/', Space: 'Space', Tab: 'Tab', Quote: "'", Semicolon: ';' };
      key = map[code] || '';
    }
    if (!key || parts.length === 0) return null;
    parts.push(key.length === 1 ? key.toUpperCase() : key);
    return parts.join('+');
  }

  window.SettingsApp = {
    template: '#tpl-settings',
    data() {
      return {
        loaded: false,
        settings: null,
        page: 'providers',
        dirty: false,
        savedFlash: false,
        providerIds: [],
        providerEditor: { open: false, id: null, name: '', base: '', key: '', models: '' },
        modelEditor: { open: false, providerId: null, originalId: null, id: '', name: '', vision: false, thinking: false },
        agentEditor: { open: false, id: null, icon: '', name: '', prompt: '', model: '' },
        testResults: {},
        recordingFor: null, // 正在录制的目标：'shot' | 'record'
        pendingShortcut: null,
        pendingRecordShortcut: null,
        dialog: { open: false, message: '', danger: false },
      };
    },
    computed: {
      providers() {
        return this.providerIds.map((id) => this.settings && this.settings.providers[id]).filter(Boolean);
      },
      activeProvider() {
        return this.settings ? this.settings.providers[this.settings.activeProviderId] : null;
      },
      models() {
        return (this.activeProvider && this.activeProvider.models) || [];
      },
      builtinProvider() {
        return this.providers.find((p) => p.builtIn) || null;
      },
      builtinKey: {
        get() {
          return this.builtinProvider ? this.builtinProvider.apiKey || '' : '';
        },
        set(val) {
          if (this.builtinProvider) this.builtinProvider.apiKey = val;
        },
      },
      shortcutDisplay() {
        return formatShortcut(this.pendingShortcut || (this.settings && this.settings.shortcut));
      },
      recordShortcutDisplay() {
        return formatShortcut(this.pendingRecordShortcut || (this.settings && this.settings.recordShortcut));
      },
    },
    created() {
      this._offs = [];
      this._offs.push(bridge.on('settings:updated', ({ settings: s }) => {
        // 其它入口（托盘）改动时同步刷新；本地有未保存修改时保留编辑状态
        if (this.dirty) return;
        this.applySettings(s);
      }));
      this._onKey = (e) => {
        // 快捷键录制优先
        if (this.recordingFor) {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Escape') {
            this.recordingFor = null;
            return;
          }
          const combo = buildAccelerator(e);
          if (!combo) return;
          const target = this.recordingFor;
          this.recordingFor = null;
          if (target === 'record') {
            this.pendingRecordShortcut = combo;
            this.settings.recordShortcut = combo;
          } else {
            this.pendingShortcut = combo;
            this.settings.shortcut = combo;
          }
          this.markDirty();
          return;
        }
        if (e.key !== 'Escape') return;
        if (this.dialog.open) return; // 页内弹窗自行处理 ESC
        const t = document.activeElement;
        const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        if (!typing) bridge.invoke('win:control', { action: 'close' });
      };
      document.addEventListener('keydown', this._onKey);
      bridge.invoke('settings:get').then((s) => this.applySettings(s));
    },
    beforeDestroy() {
      this._offs.forEach((f) => f && f());
      document.removeEventListener('keydown', this._onKey);
    },
    methods: {
      agentDisplayName(a) {
        return AgentsShared.agentName(a, this.$lang);
      },
      agentLabel(a) {
        return [a.icon, this.agentDisplayName(a)].filter(Boolean).join(' ') || a.id;
      },
      agentDisplayPrompt(a) {
        return AgentsShared.agentPrompt(a, this.$lang);
      },
      applySettings(s) {
        this.settings = s;
        this.syncProviderIds();
        this.loaded = true;
        this.dirty = false;
      },
      syncProviderIds() {
        this.providerIds = Object.keys(this.settings.providers);
      },
      markDirty() {
        this.dirty = true;
      },
      // ---------- 页内弹窗（替代原生 alert/confirm，Promise 化） ----------
      showDialog({ message, danger }) {
        return new Promise((resolve) => {
          this.dialog = { open: true, message, danger: !!danger };
          this._dialogResolve = resolve;
          this.$nextTick(() => {
            const ok = this.$refs.dlgOk;
            if (ok) ok.focus();
          });
        });
      },
      dlgAlert(msg) {
        return this.showDialog({ message: msg });
      },
      dlgConfirm(msg) {
        return this.showDialog({ message: msg, danger: true });
      },
      dialogDone(val) {
        this.dialog.open = false;
        const r = this._dialogResolve;
        this._dialogResolve = null;
        if (r) r(val);
      },
      onDialogKeydown(e) {
        if (e.key === 'Enter') this.dialogDone(true);
        else if (e.key === 'Escape') this.dialogDone(this.dialog.danger ? false : true);
      },
      onDialogBackdrop(e) {
        if (e.target === e.currentTarget) this.dialogDone(this.dialog.danger ? false : true);
      },
      // ---------- 模型服务 ----------
      selectProvider(p) {
        if (!this.settings || this.settings.activeProviderId === p.id) return;
        this.settings.activeProviderId = p.id;
        const firstVision = (p.models || []).find((m) => m.vision) || (p.models || [])[0];
        if (firstVision && !this.isModelInProvider(this.settings.activeModelId)) this.settings.activeModelId = firstVision.id;
        this.markDirty();
      },
      isModelInProvider(modelId) {
        const p = this.settings && this.settings.providers[this.settings.activeProviderId];
        return !!p && (p.models || []).some((m) => m.id === modelId);
      },
      selectModel(m) {
        if (this.settings.activeModelId === m.id) return;
        this.settings.activeModelId = m.id;
        this.markDirty();
      },
      testResult(id) {
        return this.testResults[id] || { state: '', text: '' };
      },
      async testModel(m, p) {
        this.$set(this.testResults, m.id, { state: 'testing', text: this.$t('pv.testing') });
        const res = await bridge.invoke('settings:test-model', { provider: { baseURL: p.baseURL, apiKey: p.apiKey }, modelId: m.id, thinking: !!m.thinking });
        if (res && res.ok) {
          this.$set(this.testResults, m.id, { state: 'ok', text: this.$t('pv.testOk', (res.latencyMs / 1000).toFixed(1)) });
        } else {
          this.$set(this.testResults, m.id, { state: 'fail', text: this.$t('pv.testFail', (res && res.error) || 'error') });
        }
      },
      openModelEditor(m) {
        this.modelEditor = {
          open: true,
          providerId: this.settings.activeProviderId,
          originalId: m.id,
          id: m.id,
          name: m.name || '',
          vision: !!m.vision,
          thinking: !!m.thinking,
        };
        this.$nextTick(() => { const el = this.$refs.meId; if (el) el.focus(); });
      },
      saveModelEditor() {
        const id = this.modelEditor.id.trim();
        if (!id) return this.dlgAlert(this.$t('pv.alertModelId'));
        const provider = this.settings.providers[this.modelEditor.providerId];
        const keep = provider.models.find((x) => x.id === this.modelEditor.originalId);
        Object.assign(keep, {
          id,
          name: this.modelEditor.name.trim() || id,
          vision: this.modelEditor.vision,
          thinking: this.modelEditor.thinking,
        });
        if (this.settings.activeModelId === this.modelEditor.originalId) this.settings.activeModelId = id;
        this.modelEditor.open = false;
        this.markDirty();
      },
      async deleteModel(m) {
        if (!(await this.dlgConfirm(this.$t('pv.delModelConfirm', m.name || m.id)))) return;
        const p = this.settings.providers[this.modelEditor.providerId || this.settings.activeProviderId] || this.activeProvider;
        p.models = p.models.filter((x) => x.id !== m.id);
        if (this.settings.activeModelId === m.id) {
          const next = p.models.find((x) => x.vision) || p.models[0];
          this.settings.activeModelId = next ? next.id : '';
        }
        this.markDirty();
      },
      async resetBuiltinModels() {
        if (!(await this.dlgConfirm(this.$t('pv.resetModelsConfirm')))) return;
        const res = await bridge.invoke('settings:reset-builtin-models');
        if (res && res.settings) this.applySettings(res.settings);
      },
      addProvider() {
        this.providerEditor = { open: true, id: 'custom_' + Date.now(), name: '', base: '', key: '', models: '' };
        this.$nextTick(() => { const el = this.$refs.peName; if (el) el.focus(); });
      },
      openProviderEditor(p) {
        this.providerEditor = {
          open: true,
          id: p.id,
          name: p.name || '',
          base: p.baseURL || '',
          key: p.apiKey || '',
          models: (p.models || [])
            .map((m) => `${m.id} | ${m.name || m.id}${m.vision ? ' | v' : ''}${m.thinking ? ' | t' : ''}`)
            .join('\n'),
        };
        this.$nextTick(() => {
          const el = this.$refs.providerEditorCard;
          if (el) el.scrollIntoView({ behavior: 'smooth' });
        });
      },
      saveProvider() {
        const pe = this.providerEditor;
        const name = pe.name.trim();
        const base = pe.base.trim().replace(/\/+$/, '');
        const key = pe.key.trim();
        // 模型留空时直接采用输入框 placeholder 里的默认示例
        const modelsText = pe.models.trim() || this.$t('pv.modelsPh');
        const models = modelsText
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const parts = line.split('|').map((x) => (x || '').trim());
            const id = parts[0];
            const flags = new Set(parts.slice(2).flatMap((f) => f.toLowerCase().split(/[,\s]+/)).filter(Boolean));
            return { id, name: parts[1] || id, vision: flags.has('v'), thinking: flags.has('t') };
          })
          .filter((m) => m.id);
        if (!name || !base) return this.dlgAlert(this.$t('pv.alertNameBase'));
        if (!/^https?:\/\//i.test(base)) return this.dlgAlert(this.$t('pv.alertBadBase'));
        if (!models.length) return this.dlgAlert(this.$t('pv.alertModels'));
        const existing = this.settings.providers[pe.id];
        if (existing) {
          // 编辑：保留原 id 键，避免旧条目变孤儿；模型列表整体替换
          Object.assign(existing, { name, baseURL: base, apiKey: key, models });
          if (this.settings.activeProviderId === existing.id && !this.isModelInProvider(this.settings.activeModelId)) {
            const next = models.find((m) => m.vision) || models[0];
            this.settings.activeModelId = next.id;
          }
        } else {
          this.$set(this.settings.providers, pe.id, { id: pe.id, name, baseURL: base, apiKey: key, models });
          this.syncProviderIds();
          if (!this.isModelInProvider(this.settings.activeModelId)) {
            this.settings.activeModelId = (models.find((m) => m.vision) || models[0]).id;
            this.settings.activeProviderId = pe.id;
          }
        }
        pe.open = false;
        this.markDirty();
      },
      async deleteProvider(id) {
        if (!(await this.dlgConfirm(this.$t('pv.delConfirm')))) return;
        this.$delete(this.settings.providers, id);
        this.syncProviderIds();
        if (this.settings.activeProviderId === id) {
          const fallback = this.builtinProvider || this.providers[0];
          if (fallback) {
            this.settings.activeProviderId = fallback.id;
            const next = (fallback.models || []).find((m) => m.vision) || (fallback.models || [])[0];
            this.settings.activeModelId = next ? next.id : '';
          }
        }
        this.providerEditor.open = false;
        this.markDirty();
      },
      async saveBuiltinKey() {
        if (!this.builtinProvider) return;
        this.markDirty();
        await this.saveNow();
      },
      // ---------- 智能体 ----------
      setDefaultAgent(a) {
        this.settings.defaultAgentId = a.id;
        this.markDirty();
      },
      toggleAgent(a, checked) {
        a.enabled = checked;
        this.markDirty();
      },
      async deleteAgent(a) {
        if (!(await this.dlgConfirm(this.$t('ag.delConfirm', this.agentLabel(a))))) return;
        this.settings.agents = this.settings.agents.filter((x) => x.id !== a.id);
        if (this.settings.defaultAgentId === a.id) this.settings.defaultAgentId = 'translate';
        this.markDirty();
      },
      openAgentEditor(a) {
        this.agentEditor = {
          open: true,
          id: a ? a.id : null,
          icon: a ? a.icon || '' : '',
          name: a ? this.agentDisplayName(a) : '',
          prompt: a ? this.agentDisplayPrompt(a) : '',
          model: a && a.model ? a.model : '',
        };
        this.$nextTick(() => {
          const el = this.$refs.agentEditorCard;
          if (el) el.scrollIntoView({ behavior: 'smooth' });
          if (!a && this.$refs.aeName) this.$refs.aeName.focus();
        });
      },
      saveAgent() {
        const ae = this.agentEditor;
        const icon = ae.icon.trim();
        const name = ae.name.trim();
        const prompt = ae.prompt.trim();
        // 图标和名称只需其一：只填名称时补默认图标，只填图标时名称留空
        if (!icon && !name) return this.dlgAlert(this.$t('ag.alertIconOrName'));
        if (!prompt) return this.dlgAlert(this.$t('ag.alertPrompt'));
        const iconOut = icon || '🤖';
        const model = ae.model || undefined;
        const idx = this.settings.agents.findIndex((x) => x.id === ae.id);
        if (idx >= 0) {
          // 整体替换而不是原位改：model 字段可能原本不存在，保证响应式
          this.settings.agents.splice(idx, 1, { ...this.settings.agents[idx], icon: iconOut, name, systemPrompt: prompt, model });
        } else {
          this.settings.agents.push({ id: 'agent_' + Date.now(), icon: iconOut, name, systemPrompt: prompt, model, enabled: true });
        }
        ae.open = false;
        this.markDirty();
      },
      async deleteEditingAgent() {
        const ae = this.agentEditor;
        const target = this.settings.agents.find((x) => x.id === ae.id);
        if (!(await this.dlgConfirm(this.$t('ag.delConfirm', target ? this.agentLabel(target) : ae.id)))) return;
        this.settings.agents = this.settings.agents.filter((x) => x.id !== ae.id);
        if (this.settings.defaultAgentId === ae.id) this.settings.defaultAgentId = 'translate';
        ae.open = false;
        this.markDirty();
      },
      async resetAgents() {
        if (!(await this.dlgConfirm(this.$t('ag.resetConfirm')))) return;
        const res = await bridge.invoke('settings:reset-agents');
        if (res && res.settings) this.applySettings(res.settings);
      },
      // ---------- 保存 ----------
      async saveNow() {
        const res = await bridge.invoke('settings:save', { settings: this.settings });
        if (res && res.settings) {
          this.applySettings(res.settings);
          // 主进程保存时已切换语言：同步刷新词典，界面立即换文案
          const boot = window.i18n.dict();
          if (boot.lang !== window.CaptureI18n.state.lang) window.CaptureI18n.install(boot);
          this.savedFlash = true;
          setTimeout(() => { this.savedFlash = false; }, 1600);
        }
      },
      winOp(action) {
        bridge.invoke('win:control', { action });
      },
    },
  };
})();
