// Service worker: ทำให้เปิดแอปได้ตอนออฟไลน์
// ไฟล์ของเว็บ: ลองโหลดจากอินเทอร์เน็ตก่อน (จะได้เวอร์ชันล่าสุดเสมอ) ถ้าออฟไลน์ใช้สำเนาที่เก็บไว้
// ไฟล์ Firebase SDK และฟอนต์: ใช้สำเนาที่เก็บไว้ก่อน เพราะไม่เปลี่ยนแปลง
const CACHE = 'student-scores-v3';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/cloud.js', 'js/firebase-config.js', 'js/vendor/paper-warp.js', 'data/roster.js',
  'manifest.webmanifest', 'img/logo-mark.png', 'img/favicon.png', 'img/icon-192.png', 'img/icon-512.png'];
const STATIC_HOSTS = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const put = (res) => { if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; };
  if (url.origin === self.location.origin) {
    // cache: 'no-cache' = ถามเซิร์ฟเวอร์ทุกครั้งว่ามีเวอร์ชันใหม่ไหม ไม่ใช้ไฟล์เก่าที่เบราว์เซอร์จำไว้
    e.respondWith(fetch(req.url, { cache: 'no-cache' }).then(put).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./'))));
  } else if (STATIC_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then(put)));
  }
  // คำขออื่น (เช่น การล็อกอินและซิงก์ข้อมูลกับ Firebase) ปล่อยผ่านตามปกติ
});
