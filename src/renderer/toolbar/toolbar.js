/* 浮动工具条：三段式布局
 * 第一行 标注工具（选区/矩形/椭圆/直线/箭头/画笔/荧光笔/马赛克）
 * 第二行 控制（颜色 / 线宽 / 撤销 / 重做 / 清除）
 * 第三行 输出（✕ 退出 / 下载 / 设置 / ✔ 完成）+ 智能体行
 * 工具类动作通过 toolbar:action 转发给覆盖窗（主进程 sendToActiveOverlay）。
 */
const bridge = window.api;
const t = (k) => window.i18n.t(k);

const rowTools = document.getElementById('rowTools');
const rowControls = document.getElementById('rowControls');
const panel = document.getElementById('panel');
const rowOutput = document.getElementById('rowOutput');
const rowAgents = document.getElementById('rowAgents');

const TOOLS = [
  { id: 'select', icon: '⬚', key: 'tb.select' },
  { id: 'rect', icon: '▭', key: 'tb.rect' },
  { id: 'ellipse', icon: '◯', key: 'tb.ellipse' },
  { id: 'line', icon: '╱', key: 'tb.line' },
  { id: 'arrow', icon: '➚', key: 'tb.arrow' },
  { id: 'pencil', icon: '✎', key: 'tb.pencil' },
  { id: 'highlighter', icon: '▛', key: 'tb.highlight' },
  { id: 'mosaic', icon: '▦', key: 'tb.mosaic' },
];
const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#5856d6', '#ffffff'];
const WIDTHS = [2, 4, 7];

let activeTool = 'select';
let activeColor = '#ff3b30';
let activeWidth = 4;

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
  requestAnimationFrame(() => {
    const bar = document.getElementById('bar');
    bridge.invoke('toolbar:size', { w: bar.offsetWidth + 4, h: bar.offsetHeight + 4 });
  });
}

function renderTools() {
  rowTools.innerHTML = '';
  for (const tool of TOOLS) {
    rowTools.appendChild(
      btn({
        icon: tool.icon, cls: 'tool' + (tool.id === activeTool ? ' active' : ''), title: t(tool.key),
        onClick: () => {
          activeTool = tool.id;
          renderTools();
          act({ type: 'tool', value: tool.id });
        },
      })
    );
  }
}

function renderControls() {
  rowControls.innerHTML = '';
  rowControls.appendChild(
    btn({
      icon: '<span style="display:inline-block;width:13px;height:13px;border-radius:3px;background:' + activeColor + ';border:1px solid rgba(255,255,255,.5)"></span>',
      cls: 'control' + (panel.classList.contains('show') ? ' active' : ''), title: t('tb.color'),
      onClick: togglePanel,
    })
  );
  rowControls.appendChild(sep());
  rowControls.appendChild(btn({ icon: '↺', cls: 'control', title: t('tb.undo'), onClick: () => act({ type: 'undo' }) }));
  rowControls.appendChild(btn({ icon: '↻', cls: 'control', title: t('tb.redo'), onClick: () => act({ type: 'redo' }) }));
  rowControls.appendChild(btn({ icon: '🗑', cls: 'control', title: t('tb.clear'), onClick: () => act({ type: 'clear' }) }));
}

function togglePanel() {
  const open = !panel.classList.contains('show');
  panel.classList.toggle('show', open);
  if (open) renderPanel();
  renderControls();
  reportSize();
}

function renderPanel() {
  panel.innerHTML = '';
  for (const c of COLORS) {
    const s = document.createElement('span');
    s.className = 'swatch' + (c === activeColor ? ' active' : '');
    s.style.background = c;
    s.addEventListener('click', () => {
      activeColor = c;
      act({ type: 'color', value: c });
      renderPanel();
      renderControls();
    });
    panel.appendChild(s);
  }
    const wrap = document.createElement('div');
  wrap.className = 'widths';
  for (const w of WIDTHS) {
    const d = document.createElement('span');
    d.className = 'wdot' + (w === activeWidth ? ' active' : '');
    const px = 4 + w * 2;
    d.style.width = px + 'px';
    d.style.height = px + 'px';
    d.addEventListener('click', () => {
      activeWidth = w;
      act({ type: 'width', value: w });
      renderPanel();
    });
    wrap.appendChild(d);
  }
  panel.appendChild(wrap);
}

function renderOutput() {
  rowOutput.innerHTML = '';
  rowOutput.appendChild(btn({ icon: '✕', cls: 'exit', title: t('tb.exitTitle'), onClick: () => act({ type: 'exit' }) }));
  rowOutput.appendChild(btn({ icon: '⬇', cls: 'plain', title: t('tb.downloadTitle'), onClick: () => act({ type: 'download' }) }));
  rowOutput.appendChild(btn({ icon: '⚙', cls: 'plain', title: t('tb.settingsTitle'), onClick: () => act({ type: 'settings' }) }));
  rowOutput.appendChild(btn({ icon: '✔', label: t('tb.done'), cls: 'primary', title: t('tb.doneTitle'), onClick: () => act({ type: 'done' }) }));
}

bridge.on('toolbar:init', ({ agents, defaultAgentId, autoAnalyze }) => {
  renderTools();
  renderControls();
  renderOutput();
  renderAgents(agents, defaultAgentId, autoAnalyze);
  reportSize();
});

function renderAgents(agents, defaultAgentId, autoAnalyze) {
  rowAgents.innerHTML = '';
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
