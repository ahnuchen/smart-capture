/* 结果窗口：接收流式输出，渲染 Markdown + KaTeX，支持追问与切换智能体 */
const bridge = window.api;
const i18n = window.i18n;

const el = {
  agentChip: document.getElementById('agentChip'),
  modelMeta: document.getElementById('modelMeta'),
  status: document.getElementById('status'),
  statusText: document.getElementById('statusText'),
  previewWrap: document.getElementById('previewWrap'),
  preview: document.getElementById('preview'),
  content: document.getElementById('content'),
  reasoning: document.getElementById('reasoning'),
  reasoningText: document.getElementById('reasoningText'),
  errorBox: document.getElementById('errorBox'),
  streamTip: document.getElementById('streamTip'),
  answer: document.getElementById('answer'),
  agentSelect: document.getElementById('agentSelect'),
  followupInput: document.getElementById('followupInput'),
  btnSend: document.getElementById('btnSend'),
  btnReanalyze: document.getElementById('btnReanalyze'),
  btnStop: document.getElementById('btnStop'),
  btnCopyResult: document.getElementById('btnCopyResult'),
  btnSaveImage: document.getElementById('btnSaveImage'),
  btnCopyImage: document.getElementById('btnCopyImage'),
};

const state = {
  agents: [],
  streaming: false,
  content: '',
  reasoning: '',
  renderPending: false,
  lastKatex: 0,
  followupMode: false, // 追问时不清空已有内容，续写在新答案后
};

marked.setOptions({ breaks: true, gfm: true });

bridge.on('result:init', (payload) => {
  el.agentChip.textContent = `${payload.agent.icon || '🤖'} ${payload.agent.name}`;
  el.modelMeta.textContent = `${payload.providerName} · ${payload.modelName}` + (payload.vision ? '' : ' · ⚠ 非视觉模型，可能无法读图');
  el.preview.src = payload.imageFull;
  state.agents = payload.agents || [];
  rebuildAgentSelect(payload.agent.id);
  if (!payload.vision) {
    showError(i18n.t('res.visionWarn'));
  }
});

function rebuildAgentSelect(currentId) {
  el.agentSelect.innerHTML = '';
  for (const a of state.agents) {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = `${a.icon || '🤖'} ${a.name}`;
    if (a.id === currentId) opt.selected = true;
    el.agentSelect.appendChild(opt);
  }
}

bridge.on('result:stream', ({ kind, delta, message }) => {
  if (kind === 'start') {
    state.streaming = true;
    if (state.followupMode) {
      // 追问：保留历史内容，继续追加
      el.errorBox.style.display = 'none';
      el.streamTip.style.display = 'flex';
    } else {
      state.content = '';
      state.reasoning = '';
      el.answer.style.display = 'none';
      el.answer.innerHTML = '';
      el.errorBox.style.display = 'none';
      el.reasoning.style.display = 'none';
      el.reasoningText.textContent = '';
      el.streamTip.style.display = 'flex';
    }
    setStatus('running', i18n.t('res.analyzing'));
    setInputs(false);
  } else if (kind === 'reasoning') {
    state.reasoning += delta;
    el.reasoning.style.display = 'block';
    el.reasoningText.textContent = state.reasoning;
  } else if (kind === 'content') {
    if (state.content === '' && delta) {
      el.streamTip.style.display = 'none';
      el.answer.style.display = 'block';
    }
    state.content += delta;
    scheduleRender();
  } else if (kind === 'done') {
    state.streaming = false;
    state.followupMode = false;
    el.streamTip.style.display = 'none';
    renderAnswer(true);
    setStatus('', i18n.t('res.done'));
    setInputs(true);
  } else if (kind === 'error') {
    state.streaming = false;
    state.followupMode = false;
    el.streamTip.style.display = 'none';
    setStatus('error', i18n.t('res.error'));
    showError(message || 'Unknown error');
    setInputs(true);
  }
});

function showError(msg) {
  el.errorBox.style.display = 'block';
  el.errorBox.innerHTML = '';
  const p = document.createElement('div');
  p.textContent = msg;
  el.errorBox.appendChild(p);
  if (true) {
    const btn = document.createElement('button');
    btn.textContent = i18n.t('res.retry');
    btn.addEventListener('click', () => act({ type: 'reanalyze' }));
    el.errorBox.appendChild(btn);
  }
}

function setStatus(cls, text) {
  el.status.className = 'status ' + (cls || '');
  el.statusText.textContent = text;
}

function setInputs(enabled) {
  el.btnSend.disabled = !enabled;
  el.btnReanalyze.disabled = !enabled;
  el.btnStop.style.display = enabled ? 'none' : 'inline-block';
  el.agentSelect.disabled = false;
  el.followupInput.disabled = false;
}

// 节流渲染流式 markdown
function scheduleRender() {
  if (state.renderPending) return;
  state.renderPending = true;
  requestAnimationFrame(() => {
    state.renderPending = false;
    renderAnswer(false);
  });
}

function renderAnswer(final) {
  const nearBottom = el.content.scrollHeight - el.content.scrollTop - el.content.clientHeight < 90;
  const html = DOMPurify.sanitize(marked.parse(state.content || (final ? i18n.t('res.emptyContent') : '')));
  el.answer.innerHTML = html;
  // KaTeX 渲染（流式期间每 600ms 一次，结束时必渲）
  const now = Date.now();
  if (typeof renderMathInElement === 'function' && (final || now - state.lastKatex > 600)) {
    state.lastKatex = now;
    try {
      renderMathInElement(el.answer, {
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
  if (nearBottom) el.content.scrollTop = el.content.scrollHeight;
}

// ---- 交互 ----
el.previewWrap.addEventListener('click', () => {
  document.body.classList.toggle('preview-full');
  if (document.body.classList.contains('preview-full')) {
    document.body.style.overflow = 'auto';
    el.content.style.display = 'none';
  } else {
    document.body.style.overflow = 'hidden';
    el.content.style.display = 'block';
  }
});

el.btnSend.addEventListener('click', sendFollowup);
el.followupInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendFollowup();
  }
});

function sendFollowup() {
  const text = el.followupInput.value.trim();
  if (!text || state.streaming) return;
  el.followupInput.value = '';
  // 在界面上把追问追加到答案后面，随后模型回复继续接在其后
  state.content += `\n\n---\n\n**我：** ${text.replace(/\n/g, ' ')}\n\n`;
  state.followupMode = true;
  el.answer.style.display = 'block';
  renderAnswer(true);
  bridge.invoke('result:followup', { text });
}

el.agentSelect.addEventListener('change', () => {
  if (state.streaming) {
    act({ type: 'stop' });
  }
  act({ type: 'switch-agent', agentId: el.agentSelect.value });
});

el.btnReanalyze.addEventListener('click', () => act({ type: 'reanalyze' }));
el.btnStop.addEventListener('click', () => act({ type: 'stop' }));

el.btnCopyResult.addEventListener('click', () => {
  const text = state.content;
  if (!text) return;
  bridge.invoke('result:action', { type: 'copy-result', text });
  flashButton(el.btnCopyResult, i18n.t('res.copied'));
});
el.btnSaveImage.addEventListener('click', () => act({ type: 'save-image' }));
el.btnCopyImage.addEventListener('click', () => {
  act({ type: 'copy-image' });
  flashButton(el.btnCopyImage, i18n.t('res.copied'));
});

function flashButton(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  btn.classList.add('copied-flash');
  setTimeout(() => {
    btn.textContent = old;
    btn.classList.remove('copied-flash');
  }, 1200);
}

function act(payload) {
  bridge.invoke('result:action', payload);
}

// ---- 自定义标题栏窗口控制 ----
document.getElementById('winMin').addEventListener('click', () => bridge.invoke('win:control', { action: 'minimize' }));
document.getElementById('winClose').addEventListener('click', () => bridge.invoke('win:control', { action: 'close' }));

// ESC 关闭（输入框聚焦时不触发）
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const t = document.activeElement;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  if (!typing) bridge.invoke('win:control', { action: 'close' });
});

// 通知主进程渲染层就绪
bridge.invoke('result:ready');
