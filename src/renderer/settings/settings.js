/* 设置窗口逻辑：模型服务 / 智能体 CRUD / 截图行为 / 通用 */
const bridge = window.api;
const AgentsShared = window.AgentsShared;
const agentLang = () => window.i18n.lang();
const agentDisplayName = (a) => AgentsShared.agentName(a, agentLang());
const agentDisplayPrompt = (a) => AgentsShared.agentPrompt(a, agentLang());


let settings = null;
let editingProviderId = null; // 正在编辑的自定义服务
let editingAgentId = null; // 正在编辑的智能体
let recording = false;
let pendingShortcut = null;
let dirty = false;

const $ = (id) => document.getElementById(id);

// ---------- 初始化 ----------
bridge.invoke('settings:get').then((s) => {
  settings = s;
  renderAll();
});

bridge.on('settings:updated', ({ settings: s }) => {
  // 其它入口（托盘）改动时同步刷新；本地有未保存修改时保留编辑状态
  if (dirty) return;
  settings = s;
  renderAll();
});

// ---------- 页面切换 ----------
document.querySelectorAll('nav a').forEach((a) => {
  a.addEventListener('click', () => {
    document.querySelectorAll('nav a').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('section.page').forEach((x) => x.classList.remove('active'));
    a.classList.add('active');
    $('page-' + a.dataset.page).classList.add('active');
  });
});

function renderAll() {
  renderProviders();
  renderModels();
  renderAgents();
  renderCapture();
  renderGeneral();
  markClean();
}

// ---------- 页内弹窗（替代原生 alert/confirm） ----------
function showDialog({ message, danger }) {
  return new Promise((resolve) => {
    const box = $('dialogBox');
    $('dlgMsg').textContent = message;
    $('dlgOk').textContent = window.i18n.t(danger ? 'ag.del' : 'dlg.ok');
    $('dlgCancel').style.display = danger ? 'inline-block' : 'none';
    if (danger) $('dlgCancel').textContent = window.i18n.t('pv.cancel');
    box.hidden = false;
    const done = (val) => {
      box.hidden = true;
      $('dlgOk').onclick = $('dlgOk').onkeydown = null;
      $('dlgCancel').onclick = null;
      box.onkeydown = null;
      box.onmousedown = null;
      resolve(val);
    };
    $('dlgOk').onclick = () => done(true);
    $('dlgCancel').onclick = () => done(false);
    // Enter/ESC/点击遮罩：alert 一律视为确认，confirm 的 ESC 视为取消
    box.onkeydown = (e) => {
      if (e.key === 'Enter') done(true);
      else if (e.key === 'Escape') done(!!danger ? false : true);
    };
    $('dlgOk').onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); done(true); }
    };
    box.onmousedown = (e) => { if (e.target === box) done(danger ? false : true); };
    $('dlgOk').focus();
  });
}
const dlgAlert = (msg) => showDialog({ message: msg });
const dlgConfirm = (msg) => showDialog({ message: msg, danger: true });

// ---------- 模型服务 ----------
function renderProviders() {
  const list = $('providerList');
  list.innerHTML = '';
  for (const p of Object.values(settings.providers)) {
    const item = document.createElement('div');
    item.className = 'model-item' + (settings.activeProviderId === p.id ? ' active' : '');
    item.innerHTML = `
      <input type="radio" name="provider" ${settings.activeProviderId === p.id ? 'checked' : ''} />
      <span class="grow">
        <div>${p.name} ${p.builtIn ? '<span class="badge builtin">' + window.i18n.t('pv.builtin') + '</span>' : ''}</div>
        <div class="mid">${p.baseURL}</div>
      </span>
      <span class="tag">${window.i18n.t('pv.modelCount', (p.models || []).length)}</span>
      ${p.builtIn ? '' : `
        <button class="small op-edit-provider">${window.i18n.t('pv.editModel')}</button>
        <button class="small danger op-del-provider">${window.i18n.t('pv.delModel')}</button>
      `}
    `;
    item.addEventListener('click', (e) => {
      if (e.target.closest('button')) return; // 行内按钮不触发切换
      if (settings.activeProviderId === p.id) return;
      settings.activeProviderId = p.id;
      const firstVision = (p.models || []).find((m) => m.vision) || (p.models || [])[0];
      if (firstVision && !isModelInProvider(settings.activeModelId)) settings.activeModelId = firstVision.id;
      renderProviders();
      renderModels();
      markDirty();
    });
    if (!p.builtIn) {
      item.querySelector('.op-edit-provider').addEventListener('click', () => openProviderEditor(p));
      item.querySelector('.op-del-provider').addEventListener('click', () => deleteProvider(p.id));
    }
    list.appendChild(item);
  }

  // 内置服务的密钥编辑
  const builtin = Object.values(settings.providers).find((p) => p.builtIn);
  $('builtinKeyCard').style.display = settings.activeProviderId === (builtin && builtin.id) ? 'block' : 'none';
  if (builtin) $('builtinKey').value = builtin.apiKey || '';
}

function isModelInProvider(modelId) {
  const p = settings.providers[settings.activeProviderId];
  return p && (p.models || []).some((m) => m.id === modelId);
}

function renderModels() {
  const p = settings.providers[settings.activeProviderId];
  const list = $('modelList');
  $('activeProviderBadge').textContent = p ? p.name : '';
  $('btnResetModels').style.display = p && p.builtIn ? 'inline-block' : 'none';
  list.innerHTML = '';
  if (!p) return;
  for (const m of p.models || []) {
    const item = document.createElement('div');
    item.className = 'model-item' + (settings.activeModelId === m.id ? ' active' : '');
    item.innerHTML = `
      <input type="radio" name="model" ${settings.activeModelId === m.id ? 'checked' : ''} />
      <span class="grow"><div>${m.name || m.id}</div><div class="mid">${m.id}</div></span>
      <span class="test-result"></span>
      ${m.vision ? '<span class="tag vision">' + window.i18n.t('pv.vision') + '</span>' : '<span class="tag">' + window.i18n.t('pv.text') + '</span>'}
      ${m.thinking ? '<span class="tag thinking">' + window.i18n.t('pv.thinking') + '</span>' : ''}
      <button class="small op-test">${window.i18n.t('pv.test')}</button>
      <button class="small op-edit-model">${window.i18n.t('pv.editModel')}</button>
      ${(p.models || []).length > 1 ? '<button class="small danger op-del-model">' + window.i18n.t('pv.delModel') + '</button>' : ''}
    `;
    item.addEventListener('click', (e) => {
      if (e.target.closest('button')) return; // 行内按钮不触发切换
      if (settings.activeModelId === m.id) return;
      settings.activeModelId = m.id;
      renderModels();
      markDirty();
    });
    const resultEl = item.querySelector('.test-result');
    item.querySelector('.op-test').addEventListener('click', async (e) => {
      e.target.disabled = true;
      resultEl.textContent = window.i18n.t('pv.testing');
      resultEl.className = 'test-result';
      const res = await bridge.invoke('settings:test-model', { provider: { baseURL: p.baseURL, apiKey: p.apiKey }, modelId: m.id, thinking: !!m.thinking });
      e.target.disabled = false;
      if (res && res.ok) {
        resultEl.textContent = window.i18n.t('pv.testOk', (res.latencyMs / 1000).toFixed(1));
        resultEl.className = 'test-result ok';
      } else {
        resultEl.textContent = window.i18n.t('pv.testFail', (res && res.error) || 'error');
        resultEl.className = 'test-result fail';
      }
    });
    item.querySelector('.op-edit-model').addEventListener('click', () => openModelEditor(p, m));
    const delBtn = item.querySelector('.op-del-model');
    if (delBtn)
      delBtn.addEventListener('click', async () => {
        if (!(await dlgConfirm(window.i18n.t('pv.delModelConfirm', m.name || m.id)))) return;
        p.models = p.models.filter((x) => x.id !== m.id);
        if (settings.activeModelId === m.id) {
          const next = p.models.find((x) => x.vision) || p.models[0];
          settings.activeModelId = next ? next.id : '';
        }
        renderModels();
        renderProviders();
        markDirty();
      });
    list.appendChild(item);
  }
}

let editingModel = null; // { provider, originalId }

function openModelEditor(p, m) {
  editingModel = { provider: p, originalId: m.id };
  $('meId').value = m.id;
  $('meName').value = m.name || '';
  $('meVision').checked = !!m.vision;
  $('meThinking').checked = !!m.thinking;
  $('modelEditor').style.display = 'block';
  $('meId').focus();
}

$('meCancel').addEventListener('click', () => ($('modelEditor').style.display = 'none'));

$('meSave').addEventListener('click', async () => {
  const id = $('meId').value.trim();
  if (!id) return dlgAlert(window.i18n.t('pv.alertModelId'));
  const { provider, originalId } = editingModel;
  const keep = provider.models.find((x) => x.id === originalId);
  Object.assign(keep, {
    id,
    name: $('meName').value.trim() || id,
    vision: $('meVision').checked,
    thinking: $('meThinking').checked,
  });
  if (settings.activeModelId === originalId) settings.activeModelId = id;
  $('modelEditor').style.display = 'none';
  renderModels();
  markDirty();
});

$('btnResetModels').addEventListener('click', async () => {
  if (!(await dlgConfirm(window.i18n.t('pv.resetModelsConfirm')))) return;
  const res = await bridge.invoke('settings:reset-builtin-models');
  if (res && res.settings) {
    settings = res.settings;
    renderAll();
  }
});

$('btnAddProvider').addEventListener('click', () => {
  editingProviderId = 'custom_' + Date.now();
  $('peTitle').textContent = window.i18n.t('pv.addTitle');
  $('peName').value = '';
  $('peBase').value = '';
  $('peKey').value = '';
  $('peModels').value = '';
  $('peDelete').style.display = 'none';
  $('providerEditor').style.display = 'block';
  $('peName').focus();
});

function openProviderEditor(p) {
  editingProviderId = p.id;
  $('peTitle').textContent = window.i18n.t('pv.editTitle');
  $('peName').value = p.name || '';
  $('peBase').value = p.baseURL || '';
  $('peKey').value = p.apiKey || '';
  $('peModels').value = (p.models || [])
    .map((m) => `${m.id} | ${m.name || m.id}${m.vision ? ' | v' : ''}${m.thinking ? ' | t' : ''}`)
    .join('\n');
  $('peDelete').style.display = 'inline-block';
  $('providerEditor').style.display = 'block';
  $('providerEditor').scrollIntoView({ behavior: 'smooth' });
}

$('peCancel').addEventListener('click', () => ($('providerEditor').style.display = 'none'));

$('peSave').addEventListener('click', async () => {
  const name = $('peName').value.trim();
  const base = $('peBase').value.trim().replace(/\/+$/, '');
  const key = $('peKey').value.trim();
  // 模型留空时直接采用输入框 placeholder 里的默认示例
  const modelsText = $('peModels').value.trim() || $('peModels').placeholder;
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
  if (!name || !base) return dlgAlert(window.i18n.t('pv.alertNameBase'));
  if (!/^https?:\/\//i.test(base)) return dlgAlert(window.i18n.t('pv.alertBadBase'));
  if (!models.length) return dlgAlert(window.i18n.t('pv.alertModels'));
  const existing = settings.providers[editingProviderId];
  if (existing) {
    // 编辑：保留原 id 键，避免旧条目变孤儿；模型列表整体替换
    Object.assign(existing, { name, baseURL: base, apiKey: key, models });
    if (settings.activeProviderId === existing.id && !isModelInProvider(settings.activeModelId)) {
      const next = models.find((m) => m.vision) || models[0];
      settings.activeModelId = next.id;
    }
  } else {
    settings.providers[editingProviderId] = { id: editingProviderId, name, baseURL: base, apiKey: key, models };
    if (!isModelInProvider(settings.activeModelId)) {
      settings.activeModelId = (models.find((m) => m.vision) || models[0]).id;
      settings.activeProviderId = editingProviderId;
    }
  }
  $('providerEditor').style.display = 'none';
  renderProviders();
  renderModels();
  markDirty();
});

$('peDelete').addEventListener('click', () => deleteProvider(editingProviderId));

async function deleteProvider(id) {
  if (!(await dlgConfirm(window.i18n.t('pv.delConfirm')))) return;
  delete settings.providers[id];
  if (settings.activeProviderId === id) {
    const builtin = Object.values(settings.providers).find((p) => p.builtIn);
    const fallback = builtin || Object.values(settings.providers)[0];
    if (fallback) {
      settings.activeProviderId = fallback.id;
      const next = (fallback.models || []).find((m) => m.vision) || (fallback.models || [])[0];
      settings.activeModelId = next ? next.id : '';
    }
    renderModels();
  }
  $('providerEditor').style.display = 'none';
  renderProviders();
  markDirty();
}

$('builtinKeySave').addEventListener('click', () => {
  const builtin = Object.values(settings.providers).find((p) => p.builtIn);
  if (builtin) {
    builtin.apiKey = $('builtinKey').value.trim();
    markDirty();
    saveNow();
  }
});

// ---------- 智能体 ----------
function renderAgents() {
  const list = $('agentList');
  list.innerHTML = '';
  for (const a of settings.agents) {
    const item = document.createElement('div');
    item.className = 'agent-item';
    item.innerHTML = `
      <span class="ico">${a.icon || '🤖'}</span>
      <span class="grow">
        <div class="name">${agentDisplayName(a)} ${a.id === settings.defaultAgentId ? '<span class="badge">' + window.i18n.t('ag.default') + '</span>' : ''} ${a.builtIn ? '<span class="badge builtin">' + window.i18n.t('ag.builtin') + '</span>' : ''}</span>
        <div class="prompt-preview">${agentDisplayPrompt(a).replace(/\n/g, ' ').slice(0, 80)}</div>
      </span>
      <span class="ops">
        <label class="switch" title="${window.i18n.t('ag.enabled')}"><input type="checkbox" ${a.enabled !== false ? 'checked' : ''} /></label>
        <button class="small op-default" title="${window.i18n.t('ag.setDefault')}">${window.i18n.t('ag.setDefault')}</button>
        <button class="small op-edit">${window.i18n.t('ag.edit')}</button>
        ${a.builtIn ? '' : '<button class="small danger op-del">' + window.i18n.t('ag.del') + '</button>'}
      </span>
    `;
    item.querySelector('input[type=checkbox]').addEventListener('change', (e) => {
      a.enabled = e.target.checked;
      markDirty();
    });
    item.querySelector('.op-default').addEventListener('click', () => {
      settings.defaultAgentId = a.id;
      renderAgents();
      renderCapture();
      markDirty();
    });
    item.querySelector('.op-edit').addEventListener('click', () => openAgentEditor(a));
    const del = item.querySelector('.op-del');
    if (del) del.addEventListener('click', async () => {
      if (!(await dlgConfirm(window.i18n.t('ag.delConfirm', agentDisplayName(a))))) return;
      settings.agents = settings.agents.filter((x) => x.id !== a.id);
      if (settings.defaultAgentId === a.id) settings.defaultAgentId = 'translate';
      renderAgents();
      renderCapture();
      markDirty();
    });
    list.appendChild(item);
  }
}

function openAgentEditor(a) {
  editingAgentId = a ? a.id : null;
  $('aeTitle').textContent = a ? window.i18n.t('ag.editTitle', agentDisplayName(a)) : window.i18n.t('ag.newTitle');
  $('aeIcon').value = a ? a.icon || '' : '';
  $('aeName').value = a ? agentDisplayName(a) : '';
  $('aePrompt').value = a ? agentDisplayPrompt(a) : '';
  // 模型下拉：跟随全局 + 当前服务的全部模型
  const sel = $('aeModel');
  sel.innerHTML = `<option value="">${window.i18n.t('ag.followGlobal')}</option>`;
  const p = settings.providers[settings.activeProviderId];
  if (p) {
    for (const m of p.models || []) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name || m.id}${m.vision ? ' 👁' : ''}`;
      if (a && a.model === m.id) opt.selected = true;
      sel.appendChild(opt);
    }
  }
  $('aeDelete').style.display = a && !a.builtIn ? 'inline-block' : 'none';
  $('agentEditor').style.display = 'block';
  $('agentEditor').scrollIntoView({ behavior: 'smooth' });
  if (!a) $('aeName').focus();
}

$('btnAddAgent').addEventListener('click', () => openAgentEditor(null));
$('aeCancel').addEventListener('click', () => ($('agentEditor').style.display = 'none'));

$('aeSave').addEventListener('click', async () => {
  const icon = $('aeIcon').value.trim() || '🤖';
  const name = $('aeName').value.trim();
  const prompt = $('aePrompt').value.trim();
  if (!name) return dlgAlert(window.i18n.t('ag.alertName'));
  if (!prompt) return dlgAlert(window.i18n.t('ag.alertPrompt'));
  const model = $('aeModel').value || undefined;
  const existing = settings.agents.find((x) => x.id === editingAgentId);
  if (existing) {
    Object.assign(existing, { icon, name, systemPrompt: prompt, model });
  } else {
    const id = 'agent_' + Date.now();
    settings.agents.push({ id, icon, name, systemPrompt: prompt, model, enabled: true });
  }
  $('agentEditor').style.display = 'none';
  renderAgents();
  renderCapture();
  markDirty();
});

$('aeDelete').addEventListener('click', async () => {
  const target = settings.agents.find((x) => x.id === editingAgentId);
  if (!(await dlgConfirm(window.i18n.t('ag.delConfirm', target ? agentDisplayName(target) : editingAgentId)))) return;
  settings.agents = settings.agents.filter((x) => x.id !== editingAgentId);
  if (settings.defaultAgentId === editingAgentId) settings.defaultAgentId = 'translate';
  $('agentEditor').style.display = 'none';
  renderAgents();
  renderCapture();
  markDirty();
});

$('btnResetAgents').addEventListener('click', async () => {
  if (!(await dlgConfirm(window.i18n.t('ag.resetConfirm')))) return;
  const res = await bridge.invoke('settings:reset-agents');
  settings = res.settings;
  renderAll();
});

// ---------- 截图行为 ----------
function renderCapture() {
  const sel = $('defaultAgent');
  sel.innerHTML = '';
  for (const a of settings.agents) {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = `${a.icon || '🤖'} ${agentDisplayName(a)}`;
    if (a.id === settings.defaultAgentId) opt.selected = true;
    sel.appendChild(opt);
  }
  $('autoAnalyze').checked = !!settings.autoAnalyze;
  $('shortcutDisplay').textContent = formatShortcut(pendingShortcut || settings.shortcut);
}

$('defaultAgent').addEventListener('change', (e) => {
  settings.defaultAgentId = e.target.value;
  renderAgents();
  markDirty();
});
$('autoAnalyze').addEventListener('change', (e) => {
  settings.autoAnalyze = e.target.checked;
  markDirty();
});

$('btnRecord').addEventListener('click', () => {
  recording = true;
  $('btnRecord').textContent = window.i18n.t('cap.recording');
});
document.addEventListener('keydown', (e) => {
  if (!recording) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') {
    recording = false;
    $('btnRecord').textContent = window.i18n.t('cap.record');
    return;
  }
  const combo = buildAccelerator(e);
  if (!combo) return;
  recording = false;
  pendingShortcut = combo;
  settings.shortcut = combo;
  $('btnRecord').textContent = window.i18n.t('cap.record');
  $('shortcutDisplay').textContent = formatShortcut(combo);
  markDirty();
});

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

// ---------- 通用 ----------
function renderGeneral() {
  $('openAtLogin').checked = !!settings.openAtLogin;
  $('language').value = settings.language || 'zh';
  $('theme').value = settings.theme || 'system';
  $('aboutText').textContent = window.i18n.t('gen.about', '1.0.0');
}
$('openAtLogin').addEventListener('change', (e) => {
  settings.openAtLogin = e.target.checked;
  markDirty();
});
$('language').addEventListener('change', (e) => {
  settings.language = e.target.value;
  markDirty();
});
$('theme').addEventListener('change', (e) => {
  settings.theme = e.target.value;
  markDirty();
});

// ---------- 保存 ----------
function markDirty() {
  dirty = true;
  $('dirtyTip').style.display = 'inline';
}
function markClean() {
  dirty = false;
  $('dirtyTip').style.display = 'none';
}

$('btnSaveAll').addEventListener('click', saveNow);

async function saveNow() {
  const res = await bridge.invoke('settings:save', { settings });
  if (res && res.settings) {
    settings = res.settings;
    renderAll();
    const tip = $('saveTip'); tip.classList.add('show');
    setTimeout(() => tip.classList.remove('show'), 1600);
  }
}

// ---------- 自定义标题栏窗口控制 + ESC 关闭 ----------
$('winMin').addEventListener('click', () => bridge.invoke('win:control', { action: 'minimize' }));
$('winMax').addEventListener('click', () => bridge.invoke('win:control', { action: 'maximize' }));
$('winClose').addEventListener('click', () => bridge.invoke('win:control', { action: 'close' }));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || recording) return;
  if (!$('dialogBox').hidden) return; // 页内弹窗打开时由弹窗自行处理 ESC
  const t = document.activeElement;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (!typing) bridge.invoke('win:control', { action: 'close' });
});
