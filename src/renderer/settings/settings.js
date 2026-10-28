/* 设置窗口启动器：取词典 → 挂载 Vue 应用（模板在 index.html 的 #tpl-settings 里） */
Vue.config.productionTip = false;
window.CaptureI18n.boot();
new Vue(window.SettingsApp).$mount('#app');
