// 静态 HTML 的 i18n 应用：data-i18n / data-i18n-ph / data-i18n-title
// 依赖 window.i18n（由 preload 暴露）
(function () {
  function applyI18n(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.innerHTML = window.i18n.t(el.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.placeholder = window.i18n.t(el.dataset.i18nPh);
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = window.i18n.t(el.dataset.i18nTitle);
    });
    document.documentElement.lang = window.i18n.lang() === 'en' ? 'en' : 'zh-CN';
  }
  window.applyI18n = applyI18n;
})();
