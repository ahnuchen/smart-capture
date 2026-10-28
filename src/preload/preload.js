// 渲染进程与主进程之间的安全桥（contextIsolation 开启）
// 注意：preload 运行在沙箱中，不能 require 项目文件，i18n 通过 sendSync 向主进程请求
const { contextBridge, ipcRenderer } = require('electron');

const INVOKABLE = new Set([
  'shot:selection',
  'shot:selection-update',
  'shot:reselect',
  'shot:canceled',
  'shot:copy-finish',
  'overlay:passthrough',
  'toolbar:size',
  'toolbar:action',
  'toolbar:drag-start',
  'toolbar:drag-move',
  'toolbar:drag-end',
  'pin:drag-start',
  'pin:drag-move',
  'pin:drag-end',
  'pin:close',
  'result:ready',
  'result:followup',
  'result:action',
  'settings:get',
  'settings:save',
  'settings:reset-agents',
  'settings:reset-builtin-models',
  'settings:test-model',
  'app:open-settings',
  'app:open-external',
  'app:quit',
  'win:control',
]);

const LISTENABLE = new Set([
  'overlay:init',
  'overlay:escape',
  'overlay:enter',
  'overlay:selftest',
  'overlay:tool',
  'overlay:reset',
  'overlay:toolbar-rect',
  'pin:init',
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
  // 整套词典：Vue 窗口启动时取一次，模板渲染不再逐条走同步 IPC
  dict: () => {
    try {
      return ipcRenderer.sendSync('i18n:dict');
    } catch (_) {
      return { lang: 'zh', dict: {} };
    }
  },
});
