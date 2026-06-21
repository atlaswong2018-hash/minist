import { createApp } from 'vue';
import App from './App.vue';
import './styles/main.css';

// minist 部署平台:纯静态 SPA,无路由库(单页内 tab 切换,首屏快、构建简单)。
createApp(App).mount('#app');
