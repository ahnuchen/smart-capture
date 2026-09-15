/* 浮动工具条：完成 / 下载 / 设置 / 退出 + 智能体按钮，渲染后向主进程上报尺寸 */
const bridge = window.api;

const rowActions = document.getElementById('rowActions');
const rowAgents = document.getElementById('rowAgents');

function btn({ icon, label, cls, title, onClick }) {
  const b = document.createElement('button');
  b.className = cls || '';
  b.title = title || label;
  b.innerHTML = (icon ? `<span class="ico">${icon}</span>` : '') + (label ? `<span>${label}</span>` : '');
  b.addEventListener('click', onClick);
  return b;
}

function sep() {
  const s = document.createElement('div');
  s.className = 'sep';
  return s;
}

bridge.on('toolbar:init', ({ agents, defaultAgentId, autoAnalyze }) => {
  rowActions.innerHTML = '';
  rowAgents.innerHTML = '';

  try {
    rowActions.appendChild(
      btn({
        icon: '✔', label: window.i18n.t('tb.done'), cls: 'primary',
        title: window.i18n.t('tb.doneTitle'),
        onClick: () => act({ type: 'done' }),
      })
    );
    rowActions.appendChild(
      btn({ icon: '⬇', label: window.i18n.t('tb.download'), title: window.i18n.t('tb.downloadTitle'), onClick: () => act({ type: 'download' }) })
    );
    rowActions.appendChild(sep());
    rowActions.appendChild(
      btn({ icon: '', label: window.i18n.t('tb.settings'), title: window.i18n.t('tb.settingsTitle'), onClick: () => act({ type: 'settings' }) })
    );
    rowActions.appendChild(
      btn({ icon: '✕', label: window.i18n.t('tb.exit'), cls: 'exit', title: window.i18n.t('tb.exitTitle'), onClick: () => act({ type: 'exit' }) })
    );
  } catch (e) {
    console.error('[toolbar] i18n error:', e);
  }

  if (!agents.length) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = window.i18n.t('tb.noAgents');
    rowAgents.appendChild(hint);
  } else {
    for (const a of agents) {
      const isDefault = a.id === defaultAgentId;
      rowAgents.appendChild(
        btn({
          icon: a.icon || '🤖',
          label: a.name,
          cls: 'agent' + (isDefault ? ' default' : ''),
          title: (a.systemPrompt || '').slice(0, 120) + (isDefault ? '\n' + window.i18n.t(autoAnalyze ? 'tb.defaultAuto' : 'tb.default') : ''),
          onClick: () => act({ type: 'agent', agentId: a.id }),
        })
      );
    }
    if (autoAnalyze) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = window.i18n.t('tb.autoHint');
      rowAgents.appendChild(hint);
    }
  }

  // 上报内容尺寸，主进程据此定位并显示窗口
  requestAnimationFrame(() => {
    const bar = document.getElementById('bar');
    bridge.invoke('toolbar:size', {
      w: bar.offsetWidth + 4,
      h: bar.offsetHeight + 4,
    });
  });
});

function act(payload) {
  bridge.invoke('toolbar:action', payload);
}
