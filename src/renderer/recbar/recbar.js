/* 控制条启动器：取词典 → 挂载 Vue 应用（模板在 index.html 的 #tpl-recbar 里） */
Vue.config.productionTip = false;
window.CaptureI18n.boot();
new Vue(window.RecBarApp).$mount('#app');