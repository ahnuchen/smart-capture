// 渲染进程与主进程之间的安全桥（contextIsolation 开启）
// 注意：preload 运行在沙箱中，不能 require 项目文件，i18n 通过 sendSync 向主进程请求
const { contextBridge, ipcRenderer } = require('electron');

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
    if (!INVOKABLE.has(channel)) return Promise.reject(new Error('Disallowed channel: ' + channel));
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
    try {
      return ipcRenderer.sendSync('i18n:lang');
    } catch (_) {
      return 'zh';
    }
  },
  t: (key, ...args) => {
    try {
      return ipcRenderer.sendSync('i18n:t', { key, args });
    } catch (_) {
      return key;
    }
  },
});
