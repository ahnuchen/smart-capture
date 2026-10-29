/* 预览窗启动器：取词典 → 挂载 Vue 应用（模板在 index.html 的 #tpl-preview 里） */
Vue.config.productionTip = false;
window.CaptureI18n.boot();
new Vue(window.PreviewApp).$mount('#app');