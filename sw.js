// sw.js - 簡易 PWA 離線快取(僅快取網站自身的靜態資源,不快取 Google API 資料請求)
// 採「網路優先」策略:只要能連上網路就一律拿最新檔案,只有離線 / 網路失敗時才退回快取,
// 避免使用者裝置長期停留在舊版本的 HTML/JS/CSS。
const CACHE_NAME = 'atk-worklist-v2';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/xlsx-io.js',
  './js/drive-auth.js',
  './js/gantt.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // 不快取 Google API / OAuth 相關請求,永遠走網路以確保資料即時
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('google.com') || url.hostname.includes('gstatic.com')) {
    return;
  }
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
