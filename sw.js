const CACHE_NAME = "supportdesk-live-shell-v2";
const APP_SHELL = ["/", "/index.html", "/styles.css", "/app.js", "/favicon.png", "/manifest.webmanifest"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {}
  const title = payload.title || "SupportDesk Live";
  const options = {
    body: payload.body || "You have a new support update.",
    icon: "/favicon.png",
    badge: "/favicon.png",
    tag: payload.conversation_id
      ? `supportdesk-conversation-${payload.conversation_id}`
      : "supportdesk-new-message",
    renotify: true,
    timestamp: Date.now(),
    data: {
      url: payload.url || "/#agent",
      conversation_id: payload.conversation_id || null,
      sender_name: payload.sender_name || "A customer"
    }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});


// Same-origin fetch handling; network-first navigation keeps deployed updates fresh.
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put("/", copy));
        return response;
      }).catch(async () => {
        return (await caches.match(request)) || (await caches.match("/")) ||
          new Response("SupportDesk Live is offline. Please reconnect.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          });
      })
    );
  }
});
