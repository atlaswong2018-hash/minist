/**
 * 极简 service worker — minist 酒馆 PWA。
 *
 * 策略:
 *  - 导航请求(HTML):网络优先,失败回退到缓存的 index.html(离线可用)。
 *  - 静态资源(JS/CSS/hash 资源):缓存优先(同名带 hash,不会过期)。
 *  - API 请求(/api/*, /v1/*):不缓存,直接走网络(流式 + 实时数据)。
 *
 * 仅在生产环境注册(main.ts 控制),开发环境不注册避免干扰 HMR。
 */

const CACHE_NAME = 'minist-tavern-v1';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // 仅处理同源 GET
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API / 流式补全请求:不走缓存
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/')) {
    return;
  }

  // 导航请求(HTML 文档):网络优先,失败回退缓存
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match('./index.html').then((r) => r || new Response('离线', { status: 503 }))),
    );
    return;
  }

  // 静态资源(hash 文件名):缓存优先
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((resp) => {
          if (resp.ok && resp.type === 'basic') {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return resp;
        })
        .catch(() => cached || Response.error());
    }),
  );
});
