/* 浮动工具条：单行 = 标注工具 | 颜色·线宽·撤销·重做·清除 | ✕ 保存 ✔
 * 智能体单独一行。颜色/线宽用浮层，不改变工具条高度。
 * 工具类动作经 toolbar:action 转发给覆盖窗（主进程 sendToActiveOverlay）。
 */
const bridge = window.api;
const t = (k) => window.i18n.t(k);

const rowMain = document.getElementById('rowMain');
const rowAgents = document.getElementById('rowAgents');
const flyout = document.getElementById('flyout');

const svg = (d, vb = '0 0 16 16') =>
  `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`;

const ICON = {
  rect: svg('M2.2 3.4 h11.6 a0.9 0.9 0 0 1 0.9 0.9 v7.4 a0.9 0.9 0 0 1 -0.9 0.9 h-11.6 a0.9 0.9 0 0 1 -0.9 -0.9 v-7.4 a0.9 0.9 0 0 1 0.9 -0.9 z M3.2 5.2 v6.4 h9.6 v-6.4 z'),
  ellipse: svg('M8 2.9 C4.6 2.9 1.9 5.1 1.9 8 c0 2.9 2.7 5.1 6.1 5.1 s6.1 -2.2 6.1 -5.1 c0 -2.9 -2.7 -5.1 -6.1 -5.1 z M8 4.4 c3.1 0 4.6 1.8 4.6 3.6 s-1.5 3.6 -4.6 3.6 s-4.6 -1.8 -4.6 -3.6 s1.5 -3.6 4.6 -3.6 z'),
  line: svg('M2.6 13.4 L13.4 2.6 L14.2 3.4 L3.4 14.2 z'),
  arrow: svg('M2.4 13.9 L12.3 4.0 L10.3 4.0 L10.3 2.3 L15.0 2.3 L15.0 7.0 L13.3 7.0 L13.3 5.0 L3.4 14.9 z'),
  pencil: svg('M11.2 1.9 l2.9 2.9 -8.4 8.4 -3.7 0.8 0.8 -3.7 z M10.4 3.4 l-6.6 6.6 -0.4 1.6 1.6 -0.4 6.6 -6.6 -1.2 -1.2 z'),
  highlighter: svg('M3.0 9.0 l6.0 -6.0 3.0 3.0 -6.0 6.0 -3.6 0.6 z M1.8 13.4 h12.4 v1.4 h-12.4 z'),
  mosaic: svg('M1.8 1.8 h3.4 v3.4 h-3.4 z M6.3 1.8 h3.4 v3.4 h-3.4 z M10.8 1.8 h3.4 v3.4 h-3.4 z M1.8 6.3 h3.4 v3.4 h-3.4 z M10.8 6.3 h3.4 v3.4 h-3.4 z M6.3 10.8 h3.4 v3.4 h-3.4 z M1.8 10.8 h3.4 v3.4 h-3.4 z M10.8 10.8 h3.4 v3.4 h-3.4 z'),
  text: svg('M3.4 1.8 h9.2 v2.6 h-1.5 v-1.1 h-2.5 v10.2 h1.6 v1.5 h-4.6 v-1.5 h1.6 v-10.2 h-2.5 v1.1 h-1.5 z'),
  save: svg('M2.2 1.7 h9.2 l2.4 2.4 v8.2 a1.2 1.2 0 0 1 -1.2 1.2 h-10.4 a1.2 1.2 0 0 1 -1.2 -1.2 v-9.4 a1.2 1.2 0 0 1 1.2 -1.2 z M4.2 2.9 v2.6 h6.4 v-2.6 z M4.6 11.4 h6.8 v3.0 h-6.8 z M3.5 7.0 h9.0 v3.2 h-9.0 z M4.7 8.2 v0.9 h6.6 v-0.9 z'),
  undo: svg('M6.2 4.6 L2.6 8.0 L6.2 11.4 L7.4 10.2 L5.8 8.6 h4.2 a2.6 2.6 0 0 0 0 -5.2 h-2.2 v1.6 h2.2 a1.0 1.0 0 0 1 0 2.0 h-4.2 l1.6 -1.6 z'),
  redo: svg('M9.8 4.6 L13.4 8.0 L9.8 11.4 L8.6 10.2 L10.2 8.6 h-4.2 a2.6 2.6 0 0 1 0 -5.2 h2.2 v1.6 h-2.2 a1.0 1.0 0 0 0 0 2.0 h4.2 l-1.6 -1.6 z'),
  clear: svg('M5.4 1.8 h5.2 l0.9 1.4 h3.1 v1.6 h-1.8 v8.0 a1.2 1.2 0 0 1 -1.2 1.2 h-5.6 a1.2 1.2 0 0 1 -1.2 -1.2 v-8.0 h-1.8 v-1.6 h3.1 z M6.6 4.8 v6.6 h1.2 v-6.6 z M8.8 4.8 v6.6 h1.2 v-6.6 z'),
};

const TOOLS = [
  { id: 'rect', icon: ICON.rect, key: 'tb.rect' },
  { id: 'ellipse', icon: ICON.ellipse, key: 'tb.ellipse' },
  { id: 'line', icon: ICON.line, key: 'tb.line' },
  { id: 'arrow', icon: ICON.arrow, key: 'tb.arrow' },
  { id: 'pencil', icon: ICON.pencil, key: 'tb.pencil' },
  { id: 'highlighter', icon: ICON.highlighter, key: 'tb.highlight' },
  { id: 'mosaic', icon: ICON.mosaic, key: 'tb.mosaic' },
  { id: 'text', icon: ICON.text, key: 'tb.text' },
];
const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#5856d6', '#ffffff'];
const WIDTHS = [2, 4, 7];

let activeTool = 'rect';
let activeColor = '#ff3b30';
let activeWidth = 4;
let flyoutOpen = false;

function btn({ icon, label, cls, title, onClick }) {
  const b = document.createElement('button');
  b.className = cls || '';
  b.title = title || label || '';
  b.innerHTML = (icon ? `<span class="ico">${icon}</span>` : '') + (label ? `<span>${label}</span>` : '');
  b.addEventListener('click', onClick);
  return b;
}

function sep() {
  const s = document.createElement('div');
  s.className = 'sep';
  return s;
}

function act(payload) {
  bridge.invoke('toolbar:action', payload);
}

function reportSize() {
  const bar = document.getElementById('bar');
  const size = { w: bar.offsetWidth + 4, h: bar.offsetHeight + 4 };
  console.log('[toolbar] reportSize', JSON.stringify(size));
  bridge.invoke('toolbar:size', size);
}

function renderMain() {
  rowMain.innerHTML = '';
  for (const tool of TOOLS) {
    rowMain.appendChild(
      btn({
        icon: tool.icon, cls: 'tool' + (tool.id === activeTool ? ' active' : ''), title: t(tool.key),
        onClick: () => { activeTool = tool.id; renderMain(); act({ type: 'tool', value: tool.id }); },
      })
    );
  }
  rowMain.appendChild(sep());
  const cb = btn({
    icon: `<span class="sw" style="background:${activeColor}"></span>`, cls: 'tool', title: t('tb.color'),
    onClick: () => toggleFlyout('color'),
  });
  cb.id = 'btnColor';
  rowMain.appendChild(cb);
  const wb = btn({
    icon: `<span class="dot" style="width:${4 + activeWidth}px;height:${4 + activeWidth}px"></span>`, cls: 'tool', title: t('tb.width'),
    onClick: () => toggleFlyout('width'),
  });
  wb.id = 'btnWidth';
  rowMain.appendChild(wb);
  rowMain.appendChild(btn({ icon: ICON.undo, cls: 'tool', title: t('tb.undo'), onClick: () => act({ type: 'undo' }) }));
  rowMain.appendChild(btn({ icon: ICON.redo, cls: 'tool', title: t('tb.redo'), onClick: () => act({ type: 'redo' }) }));
  rowMain.appendChild(btn({ icon: ICON.clear, cls: 'tool', title: t('tb.clear'), onClick: () => act({ type: 'clear' }) }));
  rowMain.appendChild(sep());
  rowMain.appendChild(btn({ icon: '✕', cls: 'tool exit', title: t('tb.exitTitle'), onClick: () => act({ type: 'exit' }) }));
  rowMain.appendChild(btn({ icon: ICON.save, cls: 'tool', title: t('tb.downloadTitle'), onClick: () => act({ type: 'download' }) }));
  rowMain.appendChild(btn({ icon: '✔', cls: 'primary tool', title: t('tb.doneTitle'), onClick: () => act({ type: 'done' }) }));
}

function toggleFlyout(kind) {
  const next = !flyoutOpen || flyout.kind !== kind;
  flyoutOpen = next;
  flyout.classList.toggle('show', flyoutOpen);
  if (flyoutOpen) renderFlyout(kind);
}

function renderFlyout(kind) {
  flyout.kind = kind;
  flyout.innerHTML = '';
  if (kind === 'color') {
    for (const c of COLORS) {
      const s = document.createElement('span');
      s.className = 'swatch' + (c === activeColor ? ' active' : '');
      s.style.background = c;
      s.addEventListener('click', () => {
        activeColor = c;
        act({ type: 'color', value: c });
        renderFlyout('color');
        renderMain();
      });
      flyout.appendChild(s);
    }
  } else {
    for (const w of WIDTHS) {
      const d = document.createElement('span');
      d.className = 'wdot' + (w === activeWidth ? ' active' : '');
      const px = 4 + w * 2;
      d.style.width = px + 'px';
      d.style.height = px + 'px';
      d.addEventListener('click', () => {
        activeWidth = w;
        act({ type: 'width', value: w });
        renderFlyout('width');
        renderMain();
      });
      flyout.appendChild(d);
    }
  }
}

bridge.on('toolbar:init', ({ agents, defaultAgentId, autoAnalyze }) => {
  try {
    renderMain();
    renderAgents(agents, defaultAgentId, autoAnalyze);
  } catch (e) {
    console.error('[toolbar] 渲染失败:', e);
  }
  // 尺寸必须上报，否则主进程永远不 show
  reportSize();
});

function renderAgents(agents, defaultAgentId, autoAnalyze) {
  rowAgents.innerHTML = '';
  rowAgents.style.marginTop = '6px';
  if (!agents.length) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = t('tb.noAgents');
    rowAgents.appendChild(hint);
    return;
  }
  for (const a of agents) {
    const isDefault = a.id === defaultAgentId;
    rowAgents.appendChild(
      btn({
        icon: a.icon || '🤖',
        label: a.name,
        cls: 'agent' + (isDefault ? ' default' : ''),
        title: (a.systemPrompt || '').slice(0, 120) + (isDefault ? '\n' + t(autoAnalyze ? 'tb.defaultAuto' : 'tb.default') : ''),
        onClick: () => act({ type: 'agent', agentId: a.id }),
      })
    );
  }
  if (autoAnalyze) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = t('tb.autoHint');
    rowAgents.appendChild(hint);
  }
}
