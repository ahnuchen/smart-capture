/* 设置窗口逻辑：模型服务 / 智能体 CRUD / 截图行为 / 通用 */
const bridge = window.api;


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

// ---------- 模型服务 ----------
function renderProviders() {
  const list = $('providerList');
  list.innerHTML = '';
  for (const p of Object.values(settings.providers)) {
    const item = document.createElement('label');
    item.className = 'model-item' + (settings.activeProviderId === p.id ? ' active' : '');
    item.innerHTML = `
      <input type="radio" name="provider" ${settings.activeProviderId === p.id ? 'checked' : ''} />
      <span class="grow">
        <div>${p.name} ${p.builtIn ? '<span class="badge builtin">内置免费</span>' : ''}</div>
        <div class="mid">${p.baseURL}</div>
      </span>
      <span class="tag">${(p.models || []).length} 个模型</span>
    `;
    item.querySelector('input').addEventListener('change', () => {
      settings.activeProviderId = p.id;
      const firstVision = (p.models || []).find((m) => m.vision) || (p.models || [])[0];
      if (firstVision && !isModelInProvider(settings.activeModelId)) settings.activeModelId = firstVision.id;
      renderProviders();
      renderModels();
      markDirty();
    });
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
  list.innerHTML = '';
  if (!p) return;
  for (const m of p.models || []) {
    const item = document.createElement('label');
    item.className = 'model-item' + (settings.activeModelId === m.id ? ' active' : '');
    item.innerHTML = `
      <input type="radio" name="model" ${settings.activeModelId === m.id ? 'checked' : ''} />
      <span class="grow"><div>${m.name || m.id}</div><div class="mid">${m.id}</div></span>
      ${m.vision ? '<span class="tag vision">视觉</span>' : '<span class="tag">文本</span>'}
    `;
    item.querySelector('input').addEventListener('change', () => {
      settings.activeModelId = m.id;
      renderModels();
      markDirty();
    });
    list.appendChild(item);
  }
}

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

$('peCancel').addEventListener('click', () => ($('providerEditor').style.display = 'none'));

$('peSave').addEventListener('click', () => {
  const name = $('peName').value.trim();
  const base = $('peBase').value.trim().replace(/\/+$/, '');
  const key = $('peKey').value.trim();
  const models = $('peModels').value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, label, flag] = line.split('|').map((x) => (x || '').trim());
      return { id, name: label || id, vision: (flag || '').toLowerCase() === 'v' };
    })
    .filter((m) => m.id);
  if (!name || !base) return alert(window.i18n.t('pv.alertNameBase'));
  if (!models.length) return alert(window.i18n.t('pv.alertModels'));
  settings.providers[editingProviderId] = { id: editingProviderId, name, baseURL: base, apiKey: key, models };
  if (!isModelInProvider(settings.activeModelId)) {
    settings.activeModelId = (models.find((m) => m.vision) || models[0]).id;
    settings.activeProviderId = editingProviderId;
  }
  $('providerEditor').style.display = 'none';
  renderProviders();
  renderModels();
  markDirty();
});

$('peDelete').addEventListener('click', () => {
  if (!confirm(window.i18n.t('pv.delConfirm'))) return;
  delete settings.providers[editingProviderId];
  if (settings.activeProviderId === editingProviderId) {
    settings.activeProviderId = Object.keys(settings.providers)[0];
    settings.activeModelId = (settings.providers[settings.activeProviderId].models || [])[0].id;
  }
  $('providerEditor').style.display = 'none';
  renderProviders();
  renderModels();
  markDirty();
});

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
        <div class="name">${a.name} ${a.id === settings.defaultAgentId ? '<span class="badge">' + window.i18n.t('ag.default') + '</span>' : ''} ${a.builtIn ? '<span class="badge builtin">' + window.i18n.t('ag.builtin') + '</span>' : ''}</span>
        <div class="prompt-preview">${(a.systemPrompt || '').replace(/\n/g, ' ').slice(0, 80)}</div>
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
    if (del) del.addEventListener('click', () => {
      if (!confirm(window.i18n.t('ag.delConfirm', a.name))) return;
      settings.agents = settings.agents.filter((x) => x.id !== a.id);
      if (settings.defaultAgentId === a.id) settings.defaultAgentId = 'general';
      renderAgents();
      renderCapture();
      markDirty();
    });
    list.appendChild(item);
  }
}

function openAgentEditor(a) {
  editingAgentId = a ? a.id : null;
  $('aeTitle').textContent = a ? window.i18n.t('ag.editTitle', a.name) : window.i18n.t('ag.newTitle');
  $('aeIcon').value = a ? a.icon || '' : '';
  $('aeName').value = a ? a.name : '';
  $('aePrompt').value = a ? a.systemPrompt || '' : '';
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

$('aeSave').addEventListener('click', () => {
  const icon = $('aeIcon').value.trim() || '🤖';
  const name = $('aeName').value.trim();
  const prompt = $('aePrompt').value.trim();
  const model = $('aeModel').value || undefined;
  if (!name) return alert(window.i18n.t('ag.alertName'));
  if (!prompt) return alert(window.i18n.t('ag.alertPrompt'));
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

$('aeDelete').addEventListener('click', () => {
  if (!confirm('确定删除该智能体？')) return;
  settings.agents = settings.agents.filter((x) => x.id !== editingAgentId);
  if (settings.defaultAgentId === editingAgentId) settings.defaultAgentId = 'general';
  $('agentEditor').style.display = 'none';
  renderAgents();
  renderCapture();
  markDirty();
});

$('btnResetAgents').addEventListener('click', async () => {
  if (!confirm(window.i18n.t('ag.resetConfirm'))) return;
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
    opt.textContent = `${a.icon || '🤖'} ${a.name}`;
    if (a.id === settings.defaultAgentId) opt.selected = true;
    sel.appendChild(opt);
  }
  $('autoAnalyze').checked = !!settings.autoAnalyze;
  $('shortcutDisplay').textContent = pendingShortcut || settings.shortcut;
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
  $('btnRecord').textContent = '请按下组合键…（ESC 取消）';
});
document.addEventListener('keydown', (e) => {
  if (!recording) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') {
    recording = false;
    $('btnRecord').textContent = '点击后按下组合键';
    return;
  }
  const combo = buildAccelerator(e);
  if (!combo) return;
  recording = false;
  pendingShortcut = combo;
  settings.shortcut = combo;
  $('btnRecord').textContent = '点击后按下组合键';
  $('shortcutDisplay').textContent = combo;
  markDirty();
});

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
  const t = document.activeElement;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (!typing) bridge.invoke('win:control', { action: 'close' });
});
