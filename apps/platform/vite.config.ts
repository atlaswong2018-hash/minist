import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// minist 部署平台是纯静态站,可部署到 CF Pages / Vercel / GitHub Pages(自身也免备案友好)。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // 静态站基座;部署到子路径时改 base
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2021',
    sourcemap: true,
  },
  server: {
    port: 5174,
    // dev 时代理后端方便联调(生产走各自真实域名)
    // proxy: { '/api': 'http://localhost:8787' }
  },
});
