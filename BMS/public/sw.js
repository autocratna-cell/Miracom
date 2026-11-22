// 서비스 워커: 앱 화면 캐시(오프라인에서도 열림) + 알림 클릭 처리
const CACHE = "bms-v8";
const SHARE_CACHE = "bms-share";
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
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// 화면 파일은 네트워크 우선, 실패하면 캐시. API 요청은 캐시하지 않음.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // 다른 앱에서 '공유 → BMS'로 보낸 텍스트/파일을 받아 두고 앱 화면으로 넘김
  if (e.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    e.respondWith(
      (async () => {
        const form = await e.request.formData();
        const cache = await caches.open(SHARE_CACHE);
        await Promise.all((await cache.keys()).map((k) => cache.delete(k)));
        const files = form.getAll("files").filter((f) => f && f.size);
        const meta = { title: form.get("title") || "", text: form.get("text") || "", url: form.get("url") || "", files: [] };
        for (let i = 0; i < files.length; i++) {
          const key = `share-file-${i}`;
          meta.files.push({ key, name: files[i].name, type: files[i].type });
          await cache.put(key, new Response(files[i], { headers: { "content-type": files[i].type || "application/octet-stream" } }));
        }
        await cache.put("share-meta", new Response(JSON.stringify(meta), { headers: { "content-type": "application/json" } }));
        return Response.redirect(new URL("index.html?shared=1", self.registration.scope).href, 303);
      })()
    );
    return;
  }
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
