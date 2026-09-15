// 设置持久化：userData/settings.json（零依赖）
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { BUILTIN_PROVIDER, BUILTIN_PROVIDER_ID } = require('../shared/providers');
const { BUILTIN_AGENTS, migrateStoredAgents } = require('../shared/agents');
const { setLang } = require('../shared/i18n');

const DEFAULT_SETTINGS = {
  language: 'zh',
  theme: 'system',
  providers: { [BUILTIN_PROVIDER_ID]: BUILTIN_PROVIDER },
  activeProviderId: BUILTIN_PROVIDER_ID,
  activeModelId: 'zhipu/glm-4v-flash',
  agents: BUILTIN_AGENTS.map((a) => ({ ...a, enabled: true })),
  defaultAgentId: 'general',
  autoAnalyze: false,
  shortcut: 'CommandOrControl+Shift+A',
  openAtLogin: false,
};

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override) || override === null || typeof base !== 'object' || typeof override !== 'object') {
    return override === undefined ? base : override;
  }
  const out = { ...base };
  for (const k of Object.keys(override)) {
    out[k] = deepMerge(base[k], override[k]);
  }
  return out;
}

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.data = this.load();
    setLang(this.data.language);
  }

  load() {
    let data = DEFAULT_SETTINGS;
    try {
      if (fs.existsSync(this.file)) {
        data = deepMerge(DEFAULT_SETTINGS, JSON.parse(fs.readFileSync(this.file, 'utf8')));
      }
    } catch (e) {
      console.error('[store] 读取设置失败，使用默认设置:', e.message);
      data = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
    // 旧版内置智能体迁移 + 语言同步
    if (Array.isArray(data.agents)) data.agents = migrateStoredAgents(data.agents);
    setLang(data.language);
    return data;
  }

  save() {
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] 保存设置失败:', e.message);
    }
  }

  patch(partial) {
    this.data = deepMerge(this.data, partial);
    this.save();
    return this.data;
  }

  resetAgents() {
    this.data.agents = DEFAULT_SETTINGS.agents.map((a) => ({ ...a, enabled: true }));
    if (!this.getAgent(this.data.defaultAgentId)) this.data.defaultAgentId = 'general';
    this.save();
    return this.data;
  }

  getAgent(id) {
    return this.data.agents.find((a) => a.id === id) || null;
  }

  getEnabledAgents() {
    return this.data.agents.filter((a) => a.enabled !== false);
  }

  getActiveProvider() {
    return this.data.providers[this.data.activeProviderId] || this.data.providers[BUILTIN_PROVIDER_ID];
  }

  getActiveModel() {
    const p = this.getActiveProvider();
    const m = (p && p.models || []).find((m) => m.id === this.data.activeModelId);
    return m || { id: this.data.activeModelId, name: this.data.activeModelId, vision: true };
  }
}

module.exports = { Store, DEFAULT_SETTINGS };
