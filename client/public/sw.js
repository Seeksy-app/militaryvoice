/*
 * The MilitaryVoices.ai app's service worker.
 *
 * What it keeps: the app itself (the hashed /assets/ files, which never change
 * once built), icons and images, and a page for when there's no connection.
 * What it never keeps: anything under /api/ (your show, clips, numbers are
 * always live), uploads, and the counted /go/ and /s/ links.
 *
 * Pages load from the network first, so a new version is there on the next
 * visit; the cached shell is only for when the network isn't.
 */
const VERSION = "mv-app-v2";
const SHELL = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"];
const SKIP = [/^\/api\//, /^\/s\//, /^\/go\//, /^\/og\//, /^\/sw\.js$/];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (SKIP.some((re) => re.test(url.pathname))) return;
  // Video and audio stream in ranges; the browser handles those best on its own.
  if (req.headers.has("range") || /\.(mp4|mov|webm|m4a|mp3)$/i.test(url.pathname)) return;

  // Pages: the network, then the last copy of the app, then the offline page.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put("/index.html", res.clone()));
          return res;
        })
        .catch(async () => (await caches.match("/index.html")) || (await caches.match("/offline.html"))),
    );
    return;
  }

  // The built app: named by its content, so the cached copy is always right.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
        return res;
      })),
    );
    return;
  }

  // Images, icons and fonts: show what we have, refresh it behind.
  if (/\.(png|jpe?g|webp|svg|ico|woff2?)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const fresh = fetch(req).then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
          return res;
        }).catch(() => hit);
        return hit || fresh;
      }),
    );
  }
});

/*
 * Notifications: "your clips are ready" and the like, sent by the server
 * (Web Push). A tap opens the page it's about, reusing an open window of the
 * app when there is one.
 */
self.addEventListener("push", (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { title: "MilitaryVoices.ai", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(
    self.registration.showNotification(msg.title || "MilitaryVoices.ai", {
      body: msg.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: msg.tag || undefined,
      data: { url: msg.url || "/host/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/host/dashboard", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.focus().then((w) => (w && "navigate" in w ? w.navigate(url) : undefined));
      return self.clients.openWindow(url);
    }),
  );
});
