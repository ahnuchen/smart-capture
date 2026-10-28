/* Vue 2 窗口的 i18n 装配
 * 启动时一次性取整套词典（preload 的 i18n.dict()），模板里用 $t；
 * 切成 observable，语言变更时整体替换 dict 即可触发重渲染。
 */
(function () {
  const state = Vue.observable({ lang: 'zh', dict: {} });

  function format(raw, args) {
    let s = String(raw);
    args.forEach((a, i) => { s = s.split('{' + i + '}').join(a); });
    return s;
  }

  function install(payload) {
    const p = payload || { lang: 'zh', dict: {} };
    state.lang = p.lang === 'en' ? 'en' : 'zh';
    state.dict = p.dict || {};
    document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-CN';
  }

  function t(key, ...args) {
    const raw = state.dict[key];
    if (raw == null) return key;
    return args.length ? format(raw, args) : raw;
  }

  Vue.prototype.$t = t;
  Object.defineProperty(Vue.prototype, '$lang', { get: () => state.lang });

  window.CaptureI18n = {
    state,
    install,
    t,
    boot: () => install(window.i18n && window.i18n.dict ? window.i18n.dict() : null),
  };
})();
