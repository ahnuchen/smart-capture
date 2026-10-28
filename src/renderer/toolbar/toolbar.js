/* 工具条启动器：取词典 → 挂载 Vue 应用（模板在 index.html 的 #tpl-toolbar 里）
 * 具体逻辑在 toolbar-app.js，这里只负责引导。
 */
Vue.config.productionTip = false;
window.CaptureI18n.boot();
new Vue(window.ToolbarApp).$mount('#app');
