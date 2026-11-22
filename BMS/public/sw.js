// 서비스 워커: 앱 화면 캐시(오프라인에서도 열림) + 알림 클릭 처리
const CACHE = "bms-v7";
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "manifest.json",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "js/app.js",
  "js/db.js",
  "js/recorder.js",
  "js/calendar-export.js",
  "js/tasks.js",
  "js/stt.js",
  "js/stt-worker.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// 화면 파일은 네트워크 우선, 실패하면 캐시. API 요청은 캐시하지 않음.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // 다른 사이트(음성 인식 모델 등)는 캐시하지 않음 - 모델은 자체적으로 저장됨
  if (e.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => {
      if (list[0]) return list[0].focus();
      return self.clients.openWindow(e.notification.data?.url || "./");
    })
  );
});
