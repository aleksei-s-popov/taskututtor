// Minimal offline support: pages are network-first, static assets are cache-first.
const CACHE = "taskututtor-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;

  const put = (res) => {
    if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
    return res;
  };

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(put)
        .catch(() => caches.match(req).then((hit) => hit || caches.match("./"))),
    );
  } else {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(put)));
  }
});
