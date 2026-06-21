/**
 * Vite 配置 — minist 酒馆前端。
 *
 * 关键点:
 *  - base: './' — 静态托管在任意子路径(腾讯云 COS / CF Pages / 微信内置浏览器),资源用相对路径。
 *  - rollupOptions.chunkFileNames/assetFileNames 带 hash — 微信浏览器对无 hash 的 JS 缓存极激进,加 hash 强制破缓存。
 *  - alias '@' → src,简化 import。
 *  - server.host: true — 允许手机局域网访问调试(配合 server.host: '0.0.0.0')。
 */
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0', // 局域网手机访问
    port: 5173,
    // 允许任意 Host:dev server 常经 cloudflare 隧道 / 局域网 IP / 手机访问,
    // Host 头不固定;放开校验,避免 vite 5.4.12+ 的 "Blocked request" 拦截。
    // (server 块仅 dev 生效,build 不用,无生产影响。)
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        // hash 文件名 — 微信内置浏览器对无 hash JS 缓存极激进,必须靠 hash 破缓存
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
