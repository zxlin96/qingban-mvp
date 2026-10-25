// sw.js — 轻伴 PWA Service Worker（网络优先，离线兜底缓存）
// 仅在浏览器/PWA 环境注册（js/app.js 的 _setupWebEnvironment 判断），APK 内不注册 ——
// APK 资产随包更新，若被 SW 缓存反而会造成版本滞后。
//
// 策略：
//   - 在线时永远回源（不会拿到旧资源），成功响应顺带写入缓存
//   - 断网时回退到缓存命中， miss 则回退到首页（离线打开仍是完整界面）
//   - 跨域请求、/api/ 本地代理（开发模式）、非 GET（LLM 调用全是 POST）一概不碰
//
// CACHE_VERSION 说明：网络优先策略下缓存永不先行，版本号仅用于发版时清理旧缓存
// （避免文件改名/删除后留下孤儿条目）。发版时可顺手更新，忘了也不影响正确性。
const CACHE_VERSION = '3.19.0';
const CACHE_NAME = 'qingban-' + CACHE_VERSION;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  const cacheable = url.pathname === '/' || /\.(html?|css|js|png|svg|ico|json|woff2?)$/.test(url.pathname);

  event.respondWith(
    fetch(req).then((resp) => {
      if (resp && resp.ok && cacheable) {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
      }
      return resp;
    }).catch(() =>
      caches.match(req).then((matched) => matched || caches.match('/'))
    )
  );
});
