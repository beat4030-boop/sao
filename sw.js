// ===== Service Worker =====
const CACHE_NAME = 'sao-trade-v2';
const ASSETS = [
    './',
    './index.html',
    './css/main.css',
    './css/components.css',
    './css/dashboard.css',
    './css/strategy.css',
    './js/core/app.js',
    './js/core/config.js',
    './js/core/storage.js',
    './js/api/kis.js',
    './js/api/market-data.js',
    './js/trading/engine.js',
    './js/trading/indicators.js',
    './js/trading/strategy.js',
    './js/trading/risk.js',
    './js/trading/simulator.js',
    './js/trading/optimizer.js',
    './js/ai/model.js',
    './js/ai/trainer.js',
    './js/ai/predictor.js',
    './js/ai/ppo.js',
    './js/ai/pattern.js',
    './js/ui/chart.js',
    './js/ui/dashboard.js',
    './js/ui/toast.js',
    './manifest.json',
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // API 호출은 캐시하지 않음
    if (e.request.url.includes('koreainvestment')) {
        return;
    }
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request))
    );
});
