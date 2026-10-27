// 分析会话：结果窗口 + 多轮对话 + 流式输出
const { BrowserWindow, clipboard, nativeImage, dialog, screen, nativeTheme } = require('electron');
const path = require('path');
const crypto = require('crypto');
const { chatStream } = require('./ai');
const { t } = require('../shared/i18n');
const { agentName, agentPrompt } = require('../shared/agents');

const PRELOAD = path.join(__dirname, '../preload/preload.js');

class AnalysisManager {
  constructor(store) {
    this.store = store;
    this.resultWin = null;
    this.session = null; // {id, imageFull, imageApi, agent, providerId, modelId, messages, sourceRect}
    this.abortCtrl = null;
  }

  resolveModel(agent) {
    const s = this.store.data;
    const provider = this.store.getActiveProvider();
    const modelId = (agent && agent.model) || s.activeModelId;
    const meta = (provider.models || []).find((m) => m.id === modelId);
    return {
      provider,
      modelId,
      modelName: meta ? meta.name : modelId,
      vision: meta ? !!meta.vision : true,
      thinking: meta ? !!meta.thinking : false,
    };
  }

  buildInitialMessages(session) {
    const lang = this.store.data.language || 'zh';
    return [
      { role: 'system', content: agentPrompt(session.agent, lang) || '你是一个乐于助人的图片分析助手。' },
      {
        role: 'user',
        content: [
          { type: 'text', text: lang === 'en' ? 'Please analyze this screenshot.' : '请分析这张截图。' },
          { type: 'image_url', image_url: { url: session.imageApi } },
        ],
      },
    ];
  }

  start({ imageFull, imageApi, agentId, sourceRect, source }) {
    const agent = this.store.getAgent(agentId);
    if (!agent) return;
    const lang = this.store.data.language || 'zh';
    const { provider, modelId, modelName, vision, thinking } = this.resolveModel(agent);
    const session = {
      id: crypto.randomUUID(),
      imageFull,
      imageApi,
      agent,
      agentDisplayName: agentName(agent, lang),
      provider,
      modelId,
      modelName,
      vision,
      thinking,
      sourceRect: sourceRect || null,
      source: source || 'manual',
      messages: this.buildInitialMessages({ agent, imageApi }),
      streaming: false,
    };
    this.session = session;
    this.createWindow(session);
  }

  createWindow(session) {
    if (this.resultWin && !this.resultWin.isDestroyed()) {
      this.abort();
      this.resultWin.close();
    }
    const win = new BrowserWindow({
      width: 620,
      height: 740,
      minWidth: 420,
      minHeight: 420,
      show: false,
      frame: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#15171f' : '#f5f6fa',
      title: t('win.result', session.agentDisplayName || session.agent.name),
      icon: path.join(__dirname, '../../assets/icon.png'),
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setMenu(null);
    // 截图会话期间置顶在覆盖窗之上，保证自动分析结果自己弹出可见
    win.setAlwaysOnTop(true, 'screen-saver');
    this.resultWin = win;

    // 尽量放在选区右侧，放不下则靠左 / 居中
    try {
      if (session.sourceRect) {
        const r = session.sourceRect;
        const display = screen.getDisplayNearestPoint({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });
        const wa = display.workArea;
        let x = r.x + r.w + 16;
        if (x + 620 > wa.x + wa.width) x = r.x - 620 - 16;
        if (x < wa.x) x = Math.min(r.x + r.w + 16, wa.x + Math.max(0, wa.width - 620));
        let y = Math.max(wa.y, Math.min(r.y, wa.y + wa.height - 480));
        win.setBounds({ x, y, width: 620, height: Math.min(720, wa.height) });
      }
    } catch (_) { /* 位置失败时使用默认居中 */ }

    win.on('closed', () => {
      if (this.resultWin === win) this.resultWin = null;
      this.abort();
      if (this.session && this.session.resultWin === win) this.session = null;
    });

    win.loadFile(path.join(__dirname, '../renderer/result/index.html'), { query: { session: session.id } });
    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed()) return;
      const lang = this.store.data.language || 'zh';
      win.webContents.send('result:init', {
        sessionId: session.id,
        imageFull: session.imageFull,
        agent: { id: session.agent.id, icon: session.agent.icon, name: session.agentDisplayName || agentName(session.agent, lang) },
        providerName: session.provider.name,
        modelName: session.modelName,
        modelId: session.modelId,
        vision: session.vision,
        agents: this.store.getEnabledAgents().map((a) => ({ id: a.id, icon: a.icon, name: agentName(a, lang) })),
        autoRun: true,
      });
      win.show();
      win.focus();
      this.run(session);
    });
  }

  run(session) {
    if (!this.resultWin || this.resultWin.isDestroyed()) return;
    this.abort();
    session.streaming = true;
    const ctrl = new AbortController();
    this.abortCtrl = ctrl;
    const send = (payload) => {
      if (this.resultWin && !this.resultWin.isDestroyed()) {
        this.resultWin.webContents.send('result:stream', { sessionId: session.id, ...payload });
      }
    };
    send({ kind: 'start' });

    chatStream({
      provider: session.provider,
      model: session.modelId,
      thinking: session.thinking,
      messages: session.messages,
      signal: ctrl.signal,
      onDelta: (kind, delta, full) => {
        if (process.argv.includes('--selftest')) {
          if (kind === 'content' && full.length <= delta.length) console.log('[analysis] first content delta:', JSON.stringify(delta.slice(0, 100)));
          if (kind === 'reasoning' && full.length <= delta.length) console.log('[analysis] first reasoning delta');
        }
        send({ kind, delta, full });
      },
    })
      .then(({ content }) => {
        if (ctrl.signal.aborted) return;
        console.log('[analysis] done, content length:', (content || '').length, 'preview:', JSON.stringify((content || '').slice(0, 120)));
        session.messages.push({ role: 'assistant', content });
        session.streaming = false;
        send({ kind: 'done', content });
      })
      .catch((e) => {
        if (e.name === 'AbortError' || ctrl.signal.aborted) return;
        console.error('[analysis] error:', e.message);
        session.streaming = false;
        send({ kind: 'error', message: e.message });
      });
  }

  abort() {
    if (this.abortCtrl) {
      this.abortCtrl.abort();
      this.abortCtrl = null;
    }
  }

  // 取消所有动作：中止流式分析并关闭结果窗口（工具条「退出」/ESC 使用）
  cancelAll() {
    this.abort();
    this.session = null;
    if (this.resultWin && !this.resultWin.isDestroyed()) this.resultWin.close();
  }

  // 截图会话结束：解除结果窗口置顶，恢复为普通窗口
  onShotFinished() {
    if (this.resultWin && !this.resultWin.isDestroyed() && this.resultWin.isAlwaysOnTop()) {
      this.resultWin.setAlwaysOnTop(false);
      // 保持在最前一次点击，避免被其它窗口压住
      if (this.resultWin.isVisible()) this.resultWin.focus();
    }
  }

  // ---- 来自结果窗口的事件 ----
  handleReady() {
    /* init 已在 did-finish-load 时发送，此处预留 */
  }

  handleFollowup({ text }) {
    const session = this.session;
    if (!session || !text || !text.trim()) return;
    session.messages.push({ role: 'user', content: text.trim() });
    this.run(session);
  }

  handleAction({ type, agentId, text }) {
    const session = this.session;
    switch (type) {
      case 'reanalyze':
        if (session) {
          session.messages = this.buildInitialMessages(session);
          this.run(session);
        }
        break;
      case 'switch-agent': {
        const agent = this.store.getAgent(agentId);
        if (session && agent) {
          session.agent = agent;
          const lang = this.store.data.language || 'zh';
          session.agentDisplayName = agentName(agent, lang);
          const { provider, modelId, modelName, vision, thinking } = this.resolveModel(agent);
          Object.assign(session, { provider, modelId, modelName, vision, thinking });
          session.messages = this.buildInitialMessages(session);
          if (this.resultWin && !this.resultWin.isDestroyed()) {
            this.resultWin.webContents.send('result:init', {
              sessionId: session.id,
              imageFull: session.imageFull,
              agent: { id: agent.id, icon: agent.icon, name: session.agentDisplayName },
              providerName: provider.name,
              modelName,
              modelId,
              vision,
              agents: this.store.getEnabledAgents().map((a) => ({ id: a.id, icon: a.icon, name: agentName(a, lang) })),
              autoRun: true,
            });
          }
          this.run(session);
        }
        break;
      }
      case 'stop':
        this.abort();
        break;
      case 'copy-result':
        if (text) clipboard.writeText(text);
        break;
      case 'copy-image':
        if (session) clipboard.writeImage(nativeImage.createFromDataURL(session.imageFull));
        break;
      case 'save-image': {
        if (!session) break;
        const ts = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const name = `SmartCapture_${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.png`;
        dialog
          .showSaveDialog(this.resultWin, { title: t('dialog.save.title'), defaultPath: name, filters: [{ name: 'PNG', extensions: ['png'] }] })
          .then(({ canceled, filePath }) => {
            if (!canceled && filePath) {
              require('fs').writeFileSync(filePath, nativeImage.createFromDataURL(session.imageFull).toPNG());
            }
          })
          .catch(() => { /* 忽略 */ });
        break;
      }
    }
  }

  notifySettingsUpdated() {
    if (this.resultWin && !this.resultWin.isDestroyed()) {
      this.resultWin.webContents.send('settings:updated', { settings: this.store.data });
    }
  }
}

module.exports = { AnalysisManager };
