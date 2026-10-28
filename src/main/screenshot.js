// 截图会话编排：屏幕捕获 → 覆盖窗选区 → 浮动工具条 → 分析
const { BrowserWindow, desktopCapturer, screen, dialog, clipboard, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const { t } = require('../shared/i18n');
const { agentName } = require('../shared/agents');

const PRELOAD = path.join(__dirname, '../preload/preload.js');
const DEBUG = !!process.argv.find((a) => a === '--selftest' || a === '--dev');

function attachConsoleTag(win, tag) {
  if (!DEBUG) return;
  // Electron 33: (event, messageDetails)，字段在第二个参数上（旧的 5 位置参数写法已失效）
  win.webContents.on('console-message', (_e, d) => {
    if (!d) return;
    console.log(`[${tag}]:`, d.message, `(${d.sourceUrl}:${d.lineNumber})`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[${tag}] 页面加载失败:`, code, desc, url);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.error(`[${tag}] 渲染进程消失:`, JSON.stringify(d));
  });
}

// 覆盖窗/工具条是隐形的透明窗，出问题时才需要 devtools。
// 注意：必须显式 --devtools 才开 —— 分离式 devtools 窗口会改变置顶顺序，
// 把覆盖窗顶到工具条上面，导致工具条点击全部被吞（已实测复现）。
const DEVTOOLS = !!process.argv.find((a) => a === '--devtools');
function attachDevtools(win, tag) {
  if (!DEVTOOLS) return;
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.openDevTools({ mode: 'detach' });
    }, 800);
  });
}

class ScreenshotManager {
  constructor({ store, analysis, getSettingsWindow, onOpenSettings }) {
    this.store = store;
    this.analysis = analysis;
    this.getSettingsWindow = getSettingsWindow;
    this.onOpenSettings = onOpenSettings;
    this.overlays = []; // {win, display}
    this.toolbar = null;
    this.active = false; // 截图会话进行中
    this.selection = null; // {displayId, rect(global), fullPng, apiImg}
    this.hiddenWindows = []; // 截图期间临时隐藏的窗口
    this.autoFired = false;
  }

  isActive() {
    return this.active;
  }

  async start(options = {}) {
    if (this.active) return;
    this.active = true;
    this.autoFired = false;
    this.selection = null;

    // 隐藏本应用窗口，避免被拍进画面
    this.hiddenWindows = [];
    const settingsWin = this.getSettingsWindow && this.getSettingsWindow();
    if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible()) {
      settingsWin.hide();
      this.hiddenWindows.push(settingsWin);
    }
    if (this.analysis.resultWin && !this.analysis.resultWin.isDestroyed() && this.analysis.resultWin.isVisible()) {
      this.analysis.resultWin.hide();
      this.hiddenWindows.push(this.analysis.resultWin);
    }

    try {
      const captures = options.fakeImage
        ? [{ display: screen.getPrimaryDisplay(), image: options.fakeImage }]
        : await this.captureDisplays();
      if (!captures.length) {
        throw new Error(t('err.noCapture'));
      }
      this.createOverlays(captures);
      this.registerTempKeys();
    } catch (e) {
      console.error('[screenshot] 启动失败:', e);
      this.finish();
      dialog.showErrorBox(t('dialog.captureFail.title'), t('dialog.captureFail.msg', e.message));
    }
  }

  async captureDisplays() {
    const displays = screen.getAllDisplays();
    const out = [];
    for (const d of displays) {
      const sf = d.scaleFactor || 1;
      const w = Math.round(d.size.width * sf);
      const h = Math.round(d.size.height * sf);
      let source = null;
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: w, height: h },
        });
        source = sources.find((s) => s.display_id === String(d.id)) || sources[0] || null;
      } catch (e) {
        console.error('[screenshot] 捕获显示器失败:', e.message);
      }
      if (source && !source.thumbnail.isEmpty()) {
        out.push({ display: d, image: source.thumbnail.toDataURL() });
      }
    }
    return out;
  }

  createOverlays(captures) {
    for (const { display, image } of captures) {
      const win = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        show: false,
        webPreferences: {
          preload: PRELOAD,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      win.setMenu(null);
      win.setAlwaysOnTop(true, 'screen-saver');
      attachConsoleTag(win, `overlay-${display.id}`);
      attachDevtools(win, `overlay-${display.id}`);
      const entry = { win, display };
      this.overlays.push(entry);
      win.loadFile(path.join(__dirname, '../renderer/overlay/index.html'));
      win.once('ready-to-show', () => {
        if (win.isDestroyed()) return;
        win.setBounds(display.bounds);
        win.show();
      });
      win.webContents.once('did-finish-load', () => {
        if (win.isDestroyed()) return;
        win.webContents.send('overlay:init', { image, displayId: display.id });
        win.focus();
      });
      win.on('closed', () => {
        this.overlays = this.overlays.filter((o) => o.win !== win);
      });
    }
  }

  // 截图期间临时接管 Escape / Enter（覆盖窗失焦时依然可用）
  registerTempKeys() {
    try {
      globalShortcut.register('Escape', () => this.broadcastOverlay('overlay:escape'));
      globalShortcut.register('Return', () => this.broadcastOverlay('overlay:enter'));
    } catch (e) {
      console.warn('[screenshot] 临时快捷键注册失败:', e.message);
    }
  }

  unregisterTempKeys() {
    try {
      globalShortcut.unregister('Escape');
      globalShortcut.unregister('Return');
    } catch (_) { /* 忽略 */ }
  }

  broadcastOverlay(channel) {
    for (const o of this.overlays) {
      if (!o.win.isDestroyed()) o.win.webContents.send(channel);
    }
  }

  get activeOverlay() {
    return this.overlays.find((o) => o.display.id === (this.selection && this.selection.displayId)) || this.overlays[0];
  }

  // ---- 来自覆盖窗渲染进程的事件 ----
  handleSelection({ displayId, rect, fullPng, apiImg }) {
    console.log('[screenshot] selection:', JSON.stringify({ displayId, rect, fullLen: fullPng && fullPng.length, apiLen: apiImg && apiImg.length }));
    if (!this.active) return;
    // 同一显示器重复上报 = 会话仍在，按增量更新处理，绝不能当成"重新选区"把会话拆掉
    if (this.selection && this.selection.displayId === displayId) {
      return this.handleSelectionUpdate({ rect, fullPng, apiImg });
    }
    if (this.selection) this.handleReselect(); // 在另一块屏上拖拽 = 真的重新选区
    const entry = this.overlays.find((o) => o.display.id === displayId);
    if (!entry) return;
    const b = entry.display.bounds;
    this.selection = {
      displayId,
      rect: { x: b.x + rect.x, y: b.y + rect.y, w: rect.w, h: rect.h },
      fullPng,
      apiImg,
    };
    // 关闭其它显示器的覆盖窗，只保留当前
    for (const o of this.overlays) {
      if (o.display.id !== displayId && !o.win.isDestroyed()) o.win.close();
    }
    this.showToolbar();

    const s = this.store.data;
    if (s.autoAnalyze && !this.autoFired) {
      const agent = this.store.getAgent(s.defaultAgentId);
      if (agent) {
        this.autoFired = true;
        this.startAnalysis(agent.id, 'auto');
      }
    }
  }

  handleReselect() {
    this.closeToolbar();
    this.selection = null;
    // 不论 ESC 是从覆盖窗还是工具条发出的，都让覆盖窗回到可重新框选的状态
    this.broadcastOverlay('overlay:reset');
  }

  // 选区/标注变化：仅更新图片与位置，不重开工具条、不触发自动分析
  handleSelectionUpdate({ rect, fullPng, apiImg }) {
    if (!this.selection || !rect) return { lost: true }; // 会话已被 reselect 清掉，渲染层需重新上报
    const entry = this.overlays.find((o) => o.display.id === this.selection.displayId);
    const b = entry ? entry.display.bounds : { x: 0, y: 0 };
    this.selection.rect = { x: b.x + rect.x, y: b.y + rect.y, w: rect.w, h: rect.h };
    if (fullPng) this.selection.fullPng = fullPng;
    if (apiImg) this.selection.apiImg = apiImg;
    if (this.toolbar && !this.toolbar.isDestroyed() && this._lastToolbarSize) {
      this.layoutToolbar(this._lastToolbarSize);
    }
    return { lost: false };
  }

  sendToActiveOverlay(payload) {
    const o = this.activeOverlay;
    if (DEBUG) console.log('[screenshot] -> overlay:', payload.type, 'found=', !!o, 'overlays=', this.overlays.length);
    if (o && !o.win.isDestroyed()) o.win.webContents.send('overlay:tool', payload);
  }

  handleCanceled() {
    // 取消所有动作与 AI 分析
    this.analysis.cancelAll();
    this.finish();
  }

  handleCopyFinish() {
    if (!this.selection) return;
    clipboard.writeImage(nativeImage.createFromDataURL(this.selection.fullPng));
    this.finish();
  }

  // ---- 浮动工具条 ----
  showToolbar() {
    if (!this.selection) return;
    this.closeToolbar();
    const s = this.store.data;
    const win = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false, // 不抢覆盖窗焦点
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    win.setMenu(null);
    win.setAlwaysOnTop(true, 'screen-saver');
    attachConsoleTag(win, 'toolbar');
    attachDevtools(win, 'toolbar');
    this._lastToolbarSize = null; // 新一轮工具条，等待渲染层上报尺寸
    this._toolbarAnchor = null; // 新工具条重新计算摆放位置
    this.toolbar = win;
    win.loadFile(path.join(__dirname, '../renderer/toolbar/index.html'));
    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed()) return;
      const lang = this.store.data.language || 'zh';
      win.webContents.send('toolbar:init', {
        agents: this.store.getEnabledAgents().map((a) => ({ ...a, name: agentName(a, lang) })),
        defaultAgentId: s.defaultAgentId,
        autoAnalyze: s.autoAnalyze,
      });
      // 兜底：渲染层没上报尺寸也要让窗口可见，否则表现为"拖完框什么都没有"
      setTimeout(() => {
        if (win.isDestroyed() || this._lastToolbarSize) return;
        console.warn('[screenshot] toolbar size 未上报，使用兜底尺寸显示');
        this.layoutToolbar({ w: 380, h: 120 });
      }, 700);
    });
    win.on('closed', () => {
      if (this.toolbar === win) this.toolbar = null;
    });
  }

  layoutToolbar({ w, h }) {
    const win = this.toolbar;
    console.log('[screenshot] layoutToolbar:', JSON.stringify({ w, h, has: !!win }));
    if (!win || win.isDestroyed() || !this.selection) return;
    this._lastToolbarSize = { w, h };
    const entry = this.overlays.find((o) => o.display.id === this.selection.displayId);
    const wa = entry ? entry.display.workArea : screen.getPrimaryDisplay().workArea;
    const sel = this.selection.rect;
    const INSET = 8, GAP = 10;
    const rectKey = `${sel.x},${sel.y},${sel.w},${sel.h}`;
    // 位置锚点只在选区变化时重算：工具栏自身长高/变矮（展开颜色面板等）只改尺寸，绝不挪位
    let anchor = this._toolbarAnchor;
    if (!anchor || anchor.rectKey !== rectKey) {
      const below = sel.y + sel.h + GAP;
      const above = sel.y - h - GAP;
      let x, y;
      if (below + h <= wa.y + wa.height - INSET) {
        x = sel.x + sel.w - w; y = below; // 优先选区外侧下方
      } else if (above >= wa.y + INSET) {
        x = sel.x + sel.w - w; y = above; // 其次外侧上方
      } else if (sel.w >= w + INSET * 2 && sel.h >= h + INSET * 2) {
        x = sel.x + sel.w - w - INSET; y = sel.y + sel.h - h - INSET; // 外侧放不下才进选区内部
      } else {
        x = sel.x + sel.w - w; y = Math.min(below, wa.y + wa.height - h - INSET);
      }
      x = Math.min(Math.max(x, wa.x + INSET), wa.x + wa.width - w - INSET);
      y = Math.min(Math.max(y, wa.y + INSET), wa.y + wa.height - h - INSET);
      anchor = { rectKey, x: Math.round(x), y: Math.round(y) };
      this._toolbarAnchor = anchor;
    }
    const x = Math.round(anchor.x);
    // 尺寸变大时只在必要时上移，保证不超出工作区；横向保持锚点
    const y = Math.round(Math.min(anchor.y, wa.y + wa.height - h - INSET));
    const next = { x, y, width: Math.ceil(w), height: Math.ceil(h) };
    const cur = win.getBounds();
    const moved = cur.x !== next.x || cur.y !== next.y;
    if (moved || cur.width !== next.width || cur.height !== next.height) {
      win.setBounds(next);
    }
    // 只在首次显示或位置变化时重申置顶/重排，纯尺寸变化（切换工具导致样式行显隐）不再打扰窗口
    if (!win.isVisible()) {
      win.setAlwaysOnTop(false);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.showInactive();
      win.moveTop();
    } else if (moved) {
      win.moveTop();
    }
    this.syncToolbarRectToOverlay(); // 让覆盖窗知道工具条位置，用于鼠标穿透
  }

  closeToolbar() {
    // 关工具条前把覆盖窗的鼠标穿透还原，否则整块屏幕仍然点不动
    this.clearToolbarPassthrough();
    if (this.toolbar && !this.toolbar.isDestroyed()) this.toolbar.close();
    this.toolbar = null;
  }

  // 把工具条矩形（覆盖窗本地坐标）告诉覆盖窗；null 表示工具条已关闭
  syncToolbarRectToOverlay() {
    const o = this.activeOverlay;
    if (!o || o.win.isDestroyed()) return;
    const win = this.toolbar;
    if (!win || win.isDestroyed() || !this.selection) {
      o.win.webContents.send('overlay:toolbar-rect', null);
      return;
    }
    const b = win.getBounds();
    const d = o.display.bounds;
    o.win.webContents.send('overlay:toolbar-rect', { x: b.x - d.x, y: b.y - d.y, w: b.width, h: b.height });
  }

  clearToolbarPassthrough() {
    for (const o of this.overlays) {
      if (o.win.isDestroyed()) continue;
      o.win.webContents.send('overlay:toolbar-rect', null);
      try { o.win.setIgnoreMouseEvents(false); } catch (_) { /* 忽略 */ }
    }
  }

  // 覆盖窗在工具条矩形范围内临时让鼠标穿透，保证工具条一定能点到
  setOverlayPassthrough(sender, on) {
    const o = this.overlays.find((x) => x.win.webContents === sender);
    if (!o || o.win.isDestroyed()) return;
    try { o.win.setIgnoreMouseEvents(!!on, { forward: true }); } catch (_) { /* 忽略 */ }
    if (on && this.toolbar && !this.toolbar.isDestroyed()) {
      // 同时把工具条顶到最上面，点击落到它身上
      this.toolbar.setAlwaysOnTop(true, 'screen-saver');
      this.toolbar.moveTop();
    }
    if (DEBUG) console.log('[screenshot] overlay passthrough:', !!on);
  }

  // ---- 工具条动作 ----
  async handleToolbarAction({ type, agentId, ...rest }) {
    if (DEBUG) console.log('[screenshot] toolbar action:', JSON.stringify({ type, agentId, ...rest }));
    switch (type) {
      // 标注指令：转发给覆盖窗，保持截图会话不结束
      case 'tool':
      case 'color':
      case 'width':
      case 'undo':
      case 'redo':
      case 'clear':
        this.sendToActiveOverlay({ type, ...rest });
        return;
      case 'agent': {
        const agent = this.store.getAgent(agentId);
        if (!agent) return;
        this.startAnalysis(agent.id, 'manual');
        this.finish(); // 关闭覆盖窗与工具条，结果窗口接管
        break;
      }
      case 'done':
        // 完成：复制到剪贴板并收起截图（若有分析结果则保留展示）
        if (!this.selection) return;
        clipboard.writeImage(nativeImage.createFromDataURL(this.selection.fullPng));
        this.finish();
        break;
      case 'exit':
        // 退出：取消所有动作与 AI 分析
        this.analysis.cancelAll();
        this.finish();
        break;
      case 'download': {
        if (!this.selection) return;
        const png = this.selection.fullPng;
        // 先备份到剪贴板，避免用户取消保存后丢失截图
        clipboard.writeImage(nativeImage.createFromDataURL(png));
        this.finish();
        const ts = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const name = `SmartCapture_${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.png`;
        const { canceled, filePath } = await dialog.showSaveDialog({
          title: t('dialog.save.title'),
          defaultPath: name,
          filters: [{ name: 'PNG', extensions: ['png'] }],
        });
        if (!canceled && filePath) {
          try {
            require('fs').writeFileSync(filePath, nativeImage.createFromDataURL(png).toPNG());
          } catch (e) {
            dialog.showErrorBox(t('dialog.saveError.title'), t('dialog.saveError.msg', e.message));
          }
        }
        break;
      }
      case 'settings':
        this.finish();
        if (this.onOpenSettings) this.onOpenSettings();
        break;
      case 'close':
        // 兼容旧调用：等同退出
        this.analysis.cancelAll();
        this.finish();
        break;
    }
  }

  startAnalysis(agentId, source) {
    if (!this.selection) return;
    this.analysis.start({
      imageFull: this.selection.fullPng,
      imageApi: this.selection.apiImg,
      agentId,
      sourceRect: this.selection.rect,
      source,
    });
  }

  // ---- 收尾：恢复隐藏窗口（已被销毁的自动跳过） ----
  finish() {
    this.unregisterTempKeys();
    for (const o of this.overlays) {
      if (!o.win.isDestroyed()) o.win.close();
    }
    this.overlays = [];
    this.closeToolbar();
    this.selection = null;
    this.active = false;
    this.analysis.onShotFinished();
    for (const w of this.hiddenWindows) {
      if (!w.isDestroyed()) w.show();
    }
    this.hiddenWindows = [];
  }
}

module.exports = { ScreenshotManager };
