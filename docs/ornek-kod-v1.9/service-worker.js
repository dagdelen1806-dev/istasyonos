/* Örnek PWA kabuğu; gerçek uygulamaya bağlanmamıştır.
 * /api, /v1, /evidence, cookie session verisi veya slip cache'lenmez.
 * allow-list kesin URL'lerdir; build çıktısının hash/sürümüyle güncellenmelidir.
 */
const CACHE = 'akaryakit-shell-v1.9';
const PREFIX = 'akaryakit-shell-';
const SHELL = ['/offline.html'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  // skipWaiting otomatik çağrılmaz: açık vardiya sırasında zorla sürüm geçişi yok.
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key))
  )));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Private endpointler için respondWith yok; browser network yoluna bırakılır.
  // API server ayrıca Cache-Control: private, no-store döndürmelidir.
  if (SHELL.includes(url.pathname) && url.search === '') {
    event.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(request);
      return cached ?? fetch(request);
    }));
  }
});
// Bu örnek hassas offline draft store/background sync veya authenticated
// navigation fallback sağlamaz. offline.html yalnız veri içermeyen yardımcı
// sayfadır; route allow-list uygulama shell'i oluşunca bilinçli genişletilir.
