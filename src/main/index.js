// 应用入口：生命周期、托盘、全局快捷键、IPC 装配
const { app, Tray, Menu, globalShortcut, BrowserWindow, ipcMain, dialog, nativeImage, systemPreferences, nativeTheme, shell } = require('electron');
const path = require('path');
const { Store } = require('./store');
const { ScreenshotManager } = require('./screenshot');
const { AnalysisManager } = require('./analysis');
const { chatStream } = require('./ai');
const { BUILTIN_PROVIDER, BUILTIN_PROVIDER_ID } = require('../shared/providers');
const { setLang, getLang, t, getDict } = require('../shared/i18n');

const IS_DEV = !!process.argv.find((a) => a === '--dev');
const PRELOAD = path.join(__dirname, '../preload/preload.js');
const ICON = path.join(__dirname, '../../assets/icon.png');

let store = null;
let analysis = null;
let screenshot = null;
let tray = null;
let settingsWin = null;

// ---------- 主题 ----------
function applyTheme() {
  const theme = ['system', 'dark', 'light'].includes(store.data.theme) ? store.data.theme : 'system';
  nativeTheme.themeSource = theme;
}

// ---------- 设置窗口 ----------
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 860,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#15171f' : '#f5f6fa',
    title: t('win.settings'),
    icon: ICON,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, '../renderer/settings/index.html'));
  const openExternalSafe = (url) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(url);
    } catch (_) { /* 忽略 */ }
  };
  settingsWin.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  settingsWin.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file://')) return;
    e.preventDefault();
    openExternalSafe(url);
  });
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => (settingsWin = null));
  if (IS_DEV) settingsWin.webContents.openDevTools({ mode: 'detach' });
}

// ---------- 全局快捷键 ----------
function registerShortcut() {
  try {
    globalShortcut.unregisterAll();
    const ok = globalShortcut.register(store.data.shortcut, () => screenshot.start());
    if (!ok) console.warn('[shortcut] 注册失败:', store.data.shortcut);
  } catch (e) {
    console.warn('[shortcut] 注册异常:', e.message);
  }
}

// ---------- 快捷键展示 ----------
// 存储值保持 Electron accelerator 格式（CommandOrControl+...），展示时翻译成当前平台的按键名
const KEY_NAMES = {
  win: { CommandOrControl: 'Ctrl', Command: 'Win', Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Space: 'Space' },
  mac: { CommandOrControl: '\u2318', Command: '\u2318', Control: '\u2303', Alt: '\u2325', Shift: '\u21e7', Space: '\u2423' },
};
function formatAccelerator(accel) {
  const names = KEY_NAMES[process.platform === 'darwin' ? 'mac' : 'win'];
  return String(accel || '')
    .split('+')
    .map((part) => names[part] || (part.length === 1 ? part.toUpperCase() : part))
    .join(process.platform === 'darwin' ? '' : '+');
}

// ---------- 托盘 ----------
function createTray() {
  let image = nativeImage.createFromPath(ICON);
  if (image.isEmpty()) image = nativeImage.createEmpty();
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  rebuildTrayMenu();
  tray.on('double-click', () => screenshot.start());
}

function rebuildTrayMenu() {
  if (!tray) return;
  const s = store.data;
  const menu = Menu.buildFromTemplate([
    { label: t('tray.capture'), click: () => screenshot.start() },
    { label: t('tray.shortcut', formatAccelerator(s.shortcut)), enabled: false },
    { type: 'separator' },
    {
      label: t('tray.autoAnalyze'),
      type: 'checkbox',
      checked: !!s.autoAnalyze,
      click: (item) => {
        store.patch({ autoAnalyze: item.checked });
        rebuildTrayMenu();
        broadcastSettings();
      },
    },
    { type: 'separator' },
    { label: t('tray.settings'), click: () => openSettings() },
    { label: t('tray.quit'), click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(t('tray.tooltip', formatAccelerator(s.shortcut)));
}

function broadcastSettings() {
  const payload = JSON.parse(JSON.stringify(store.data));
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:updated', { settings: payload });
  analysis.notifySettingsUpdated();
  rebuildTrayMenu();
}

// ---------- IPC ----------
function setupIpc() {
  // 截图覆盖窗
  ipcMain.handle('shot:selection', (_e, payload) => screenshot.handleSelection(payload));
  ipcMain.handle('shot:selection-update', (_e, payload) => screenshot.handleSelectionUpdate(payload));
  ipcMain.handle('shot:reselect', () => screenshot.handleReselect());
  ipcMain.handle('shot:canceled', () => screenshot.handleCanceled());
  ipcMain.handle('shot:copy-finish', () => screenshot.handleCopyFinish());
  // 覆盖窗在工具条矩形内让鼠标穿透，避免全屏覆盖窗吞掉工具条点击
  ipcMain.handle('overlay:passthrough', (e, { on }) => screenshot.setOverlayPassthrough(e.sender, on));

  // 工具条
  ipcMain.handle('toolbar:size', (_e, payload) => screenshot.layoutToolbar(payload));
  ipcMain.handle('toolbar:action', (_e, payload) => screenshot.handleToolbarAction(payload));

  // 结果窗口
  ipcMain.handle('result:ready', () => analysis.handleReady());
  ipcMain.handle('result:followup', (_e, payload) => analysis.handleFollowup(payload));
  ipcMain.handle('result:action', (_e, payload) => analysis.handleAction(payload));

  // 设置
  ipcMain.handle('settings:get', () => JSON.parse(JSON.stringify(store.data)));
  ipcMain.handle('settings:save', (_e, { settings }) => {
    const prevShortcut = store.data.shortcut;
    const prevLogin = store.data.openAtLogin;
    const prevLang = store.data.language;
    const prevTheme = store.data.theme;
    store.data = store.patch(normalizeSettings(settings));
    if (store.data.language !== prevLang) setLang(store.data.language);
    if (store.data.theme !== prevTheme) applyTheme();
    if (store.data.shortcut !== prevShortcut) registerShortcut();
    if (store.data.openAtLogin !== prevLogin) {
      applyTheme();
    app.setLoginItemSettings({ openAtLogin: !!store.data.openAtLogin });
    }
    broadcastSettings();
    return { ok: true, settings: JSON.parse(JSON.stringify(store.data)) };
  });
  ipcMain.handle('settings:reset-agents', () => {
    store.resetAgents();
    broadcastSettings();
    return { ok: true, settings: JSON.parse(JSON.stringify(store.data)) };
  });
  ipcMain.handle('settings:reset-builtin-models', () => {
    const p = store.data.providers[BUILTIN_PROVIDER_ID];
    if (p) p.models = BUILTIN_PROVIDER.models.map((m) => ({ ...m }));
    store.save();
    broadcastSettings();
    return { ok: true, settings: JSON.parse(JSON.stringify(store.data)) };
  });
  ipcMain.handle('settings:test-model', async (_e, { provider: cfg, modelId, thinking }) => {
    if (!cfg || !modelId) return { ok: false, error: t('pv.testNoConfig') };
    let base;
    try {
      base = new URL(String(cfg.baseURL || ''));
    } catch (_) {
      return { ok: false, error: t('pv.testBadBase') };
    }
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return { ok: false, error: t('pv.testBadBase') };
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const { content } = await chatStream({
        provider: { baseURL: cfg.baseURL, apiKey: cfg.apiKey },
        model: modelId,
        thinking: !!thinking,
        messages: [{ role: 'user', content: 'ping' }],
        onDelta: () => {},
        signal: ctrl.signal,
      });
      return { ok: true, latencyMs: Date.now() - started, reply: String(content || '').slice(0, 60) };
    } catch (err) {
      return { ok: false, error: err.name === 'AbortError' ? t('pv.testTimeout') : err.message };
    } finally {
      clearTimeout(timer);
    }
  });

  // 打开外部链接（仅允许 http/https）
  ipcMain.handle('app:open-external', (_e, { url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(url);
    } catch (_) {
      /* 非法 URL 忽略 */
    }
  });

  // 应用级
  ipcMain.handle('app:open-settings', () => openSettings());
  ipcMain.handle('app:quit', () => app.quit());

  // 无边框窗口的自定义标题栏控制
  ipcMain.handle('win:control', (e, { action }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
  });

  // 渲染层同步获取当前语言（preload sendSync）
  ipcMain.on('i18n:lang', (e) => {
    e.returnValue = (store && store.data.language) || 'zh';
  });

  // 渲染层同步获取翻译文本
  ipcMain.on('i18n:t', (e, { key, args }) => {
    e.returnValue = t(key, ...(args || []));
  });

  // 渲染层一次性取整套词典（Vue 模板用，避免每帧上百次 sendSync）
  ipcMain.on('i18n:dict', (e) => {
    const lang = getLang();
    e.returnValue = { lang, dict: getDict(lang) };
  });
}

// 保存前的兜底校验，防止设置损坏导致应用不可用
function normalizeSettings(s) {
  if (!s || typeof s !== 'object') return {};
  if (s.language !== 'en' && s.language !== 'zh') s.language = 'zh';
  if (!['system', 'dark', 'light'].includes(s.theme)) s.theme = 'system';
  if (!s.providers || typeof s.providers !== 'object' || !Object.keys(s.providers).length) delete s.providers;
  if (!Array.isArray(s.agents) || !s.agents.length) delete s.agents;
  if (s.defaultAgentId && !(s.agents || store.data.agents).some((a) => a.id === s.defaultAgentId)) {
    s.defaultAgentId = 'translate';
  }
  return s;
}

// ---------- 生命周期 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => openSettings());

  app.whenReady().then(async () => {
    store = new Store();
    analysis = new AnalysisManager(store);
    screenshot = new ScreenshotManager({
      store,
      analysis,
      getSettingsWindow: () => settingsWin,
      onOpenSettings: () => openSettings(),
    });

    // macOS 屏幕录制权限检查
    if (process.platform === 'darwin') {
      try {
        const status = systemPreferences.getMediaAccessStatus('screen');
        if (status !== 'granted') {
          dialog.showMessageBox({
            type: 'warning',
            title: t('dialog.macScreen.title'),
            message: t('dialog.macScreen.msg'),
            buttons: ['OK'],
          });
        }
      } catch (_) { /* 忽略 */ }
    }

    applyTheme();
    app.setLoginItemSettings({ openAtLogin: !!store.data.openAtLogin });
    createTray();
    registerShortcut();
    setupIpc();
    if (IS_DEV) openSettings();
    if (process.argv.includes('--selftest')) runSelfTest();

    app.on('activate', () => {
      if (process.platform === 'darwin') openSettings();
    });
  });

  // ---------- 自测模式：electron . --selftest [--fake-screen] ----------
  process.on('unhandledRejection', (e) => console.error('[selftest] unhandledRejection:', e));
  async function runSelfTest() {
    const fs = require('fs');
    const dir = path.join(process.cwd(), 'test-artifacts');
    fs.mkdirSync(dir, { recursive: true });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const snap = async (win, name) => {
      if (!win || win.isDestroyed()) return;
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(dir, name), img.toPNG());
        console.log('[selftest] captured', name);
      } catch (e) {
        console.error('[selftest] capture failed:', name, e.message);
      }
    };

    // 无真实屏幕权限的环境用伪造屏幕图验证完整 UI 流程
    let fakeImage;
    const fakePath = path.join(process.cwd(), 'test-artifacts', 'fake-screen.png');
    if (process.argv.includes('--fake-screen') && fs.existsSync(fakePath)) {
      fakeImage = 'data:image/png;base64,' + fs.readFileSync(fakePath).toString('base64');
      console.log('[selftest] using fake screen image');
    }

    console.log('[selftest] start');
    await sleep(1500);
    await screenshot.start({ fakeImage });
    await sleep(2500);
    for (const o of screenshot.overlays) await snap(o.win, `overlay-${o.display.id}.png`);
    // 取色器验证：派发 mousemove，断言取色器显示且颜色格式合法
    for (const o of screenshot.overlays) {
      if (o.win.isDestroyed()) continue;
      try {
        const pick = await o.win.webContents.executeJavaScript(`(() => {
          const e = new MouseEvent('mousemove', { clientX: Math.round(innerWidth * 0.4), clientY: Math.round(innerHeight * 0.4) });
          document.dispatchEvent(e);
          return new Promise((resolve) => setTimeout(() => resolve({
            visible: document.getElementById('picker').style.display === 'block',
            color: document.getElementById('pickText').textContent,
            pos: document.getElementById('pickPos').textContent,
          }), 120));
        })()`);
        console.log('[selftest] color picker:', JSON.stringify(pick));
        await snap(o.win, `overlay-picker-${o.display.id}.png`);
      } catch (e) {
        console.error('[selftest] picker check failed:', e.message);
      }
    }
    for (const o of screenshot.overlays) {
      if (!o.win.isDestroyed()) o.win.webContents.send('overlay:selftest');
    }
    await sleep(1500);
    await snap(screenshot.toolbar, 'toolbar.png');
    // 选区热区断言：8 手柄 + 4 边带存在、已定位、层序正确（手柄在边带之后 = 优先命中）
    for (const o of screenshot.overlays) {
      if (o.win.isDestroyed()) continue;
      try {
        const adj = await o.win.webContents.executeJavaScript(`(() => {
          const adj = document.getElementById('adj');
          const hs = Array.from(adj.querySelectorAll('.handle'));
          return {
            handles: hs.length,
            bands: adj.querySelectorAll('.band').length,
            lastIsHandle: adj.lastElementChild && adj.lastElementChild.classList.contains('handle'),
            positioned: hs.every((h) => h.style.left && h.style.top),
            handleSize: hs[0] ? getComputedStyle(hs[0]).width : null,
            fabricLoaded: typeof window.fabric !== 'undefined',
          };
        })()`);
        console.log('[selftest] 选区热区:', JSON.stringify(adj));
      } catch (e) {
        console.error('[selftest] 热区断言失败:', e.message);
      }
      break;
    }
    // 工具条 DOM 断言：按钮数量与是否溢出
    if (screenshot.toolbar && !screenshot.toolbar.isDestroyed()) {
      try {
        const info = await screenshot.toolbar.webContents.executeJavaScript(`(() => {
          const bar = document.getElementById('bar');
          return {
            tools: document.querySelectorAll('#rowMain .tool').length,
            output: document.querySelectorAll('#rowMain button').length,
            icons: document.querySelectorAll('#rowMain .ico svg').length,
            agents: document.querySelectorAll('#rowAgents button').length,
            overflow: bar.scrollHeight > bar.clientHeight + 2,
            w: bar.offsetWidth,
            h: bar.offsetHeight,
          };
        })()`);
        console.log('[selftest] toolbar DOM:', JSON.stringify(info));
        console.log('[selftest] toolbar visible:', screenshot.toolbar.isVisible(), 'bounds:', JSON.stringify(screenshot.toolbar.getBounds()));
      } catch (e) {
        console.error('[selftest] toolbar DOM assert failed:', e.message);
      }
    } else {
      console.error('[selftest] toolbar window MISSING (showToolbar 未被调用或选区未上报)');
    }
    console.log('[selftest] toolbar action: agent=translate');
    await screenshot.handleToolbarAction({ type: 'agent', agentId: 'translate' });
    await sleep(9000);
    await snap(analysis.resultWin, 'result-streaming.png');
    await sleep(26000);
    await snap(analysis.resultWin, 'result-final.png');
    // DOM 断言：验证渲染层真实显示了内容
    if (analysis.resultWin && !analysis.resultWin.isDestroyed()) {
      try {
        const text = await analysis.resultWin.webContents.executeJavaScript(
          `document.getElementById('answer').innerText.slice(0, 300)`
        );
        console.log('[selftest] result answer text:', JSON.stringify(text));
        const status = await analysis.resultWin.webContents.executeJavaScript(
          `document.getElementById('statusText').textContent`
        );
        console.log('[selftest] result status:', JSON.stringify(status));
      } catch (e) {
        console.error('[selftest] DOM assert failed:', e.message);
      }
    }
    console.log('[selftest] done');

    // ---- 附加验证：设置窗口渲染 + 自动分析模式（结束后恢复用户设置） ----
    const savedBehavior = { autoAnalyze: store.data.autoAnalyze, defaultAgentId: store.data.defaultAgentId };
    try {
      openSettings();
      await sleep(2000);
      if (settingsWin && !settingsWin.isDestroyed()) {
        await snap(settingsWin, 'settings.png');
        const info = await settingsWin.webContents.executeJavaScript(`(() => {
          const names = Array.from(document.querySelectorAll('#agentList .agent-item .name')).map((el) => el.textContent.trim().split(' ')[0]);
          return {
            providers: document.querySelectorAll('#providerList .model-item').length,
            models: document.querySelectorAll('#modelList .model-item').length,
            agents: document.querySelectorAll('#agentList .agent-item').length,
            shortcut: document.getElementById('shortcutDisplay').textContent,
            agentNames: names,
          };
        })()`);
        console.log('[selftest] settings DOM:', JSON.stringify(info));
      }

      // 自动分析：设置默认智能体 + autoAnalyze，验证选区确认后自动出结果且置顶可见
      store.patch({ autoAnalyze: true, defaultAgentId: 'ocr' });
      await screenshot.start({ fakeImage });
      await sleep(2500);
      for (const o of screenshot.overlays) {
        if (!o.win.isDestroyed()) o.win.webContents.send('overlay:selftest');
      }
      await sleep(6000);
      const pinned = !!(analysis.resultWin && !analysis.resultWin.isDestroyed());
      console.log('[selftest] autoAnalyze result window exists:', pinned, 'alwaysOnTop:', pinned && analysis.resultWin.isAlwaysOnTop());
      if (pinned) {
        await snap(analysis.resultWin, 'result-auto.png');
        const chip = await analysis.resultWin.webContents.executeJavaScript(
          `document.getElementById('agentChip').textContent`
        );
        console.log('[selftest] autoAnalyze agent chip:', JSON.stringify(chip));
      }
      // 完成按钮链路：复制到剪贴板并收起截图（结果窗口保留、解除置顶）
      await screenshot.handleToolbarAction({ type: 'done' });
      await sleep(800);
      console.log('[selftest] after done: shot active =', screenshot.isActive(),
        ', resultWin alive =', !!(analysis.resultWin && !analysis.resultWin.isDestroyed()),
        ', resultWin alwaysOnTop =', !!(analysis.resultWin && !analysis.resultWin.isDestroyed() && analysis.resultWin.isAlwaysOnTop()));
      if (analysis.resultWin && !analysis.resultWin.isDestroyed()) analysis.resultWin.close();
      await sleep(500);

      // 退出链路：取消所有动作与 AI 分析
      await screenshot.start({ fakeImage });
      await sleep(2500);
      for (const o of screenshot.overlays) {
        if (!o.win.isDestroyed()) o.win.webContents.send('overlay:selftest');
      }
      await sleep(5000);
      await screenshot.handleToolbarAction({ type: 'exit' });
      await sleep(800);
      console.log('[selftest] after exit: shot active =', screenshot.isActive(),
        ', resultWin alive =', !!(analysis.resultWin && !analysis.resultWin.isDestroyed()));
    } catch (e) {
      console.error('[selftest] extra checks failed:', e);
    } finally {
      store.patch(savedBehavior);
    }
    console.log('[selftest] all done');
    app.quit();
  }

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {
    // 托盘常驻：不退出（macOS 惯例也保留）
  });
}
