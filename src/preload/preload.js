// 渲染进程与主进程之间的安全桥（contextIsolation 开启）
const { contextBridge, ipcRenderer } = require('electron');
const { setLang, getLang, t } = require('../shared/i18n');

// 惰性从主进程同步当前语言（窗口每次新建都会重新取）
let langLoaded = false;
function ensureLang() {
  if (!langLoaded) {
    try {
      setLang(ipcRenderer.sendSync('i18n:lang'));
    } catch (_) { /* 保持默认 zh */ }
    langLoaded = true;
  }
}

const INVOKABLE = new Set([
  'shot:selection',
  'shot:reselect',
  'shot:canceled',
  'shot:copy-finish',
  'toolbar:size',
  'toolbar:action',
  'result:ready',
  'result:followup',
  'result:action',
  'settings:get',
  'settings:save',
  'settings:reset-agents',
  'app:open-settings',
  'app:quit',
  'win:control',
]);

const LISTENABLE = new Set([
  'overlay:init',
  'overlay:escape',
  'overlay:enter',
  'overlay:selftest',
  'toolbar:init',
  'toolbar:feedback',
  'result:init',
  'result:stream',
  'settings:updated',
]);

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, payload) => {
    if (!INVOKABLE.has(channel)) return Promise.reject(new Error('不允许的调用通道: ' + channel));
    return ipcRenderer.invoke(channel, payload);
  },
  on: (channel, cb) => {
    if (!LISTENABLE.has(channel)) return;
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});

contextBridge.exposeInMainWorld('i18n', {
  lang: () => {
    ensureLang();
    return getLang();
  },
  t: (key, ...args) => {
    ensureLang();
    return t(key, ...args);
  },
});
