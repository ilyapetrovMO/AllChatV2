// AllChat is free software under the GNU Affero General Public License v3.0 or later.
self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let notification;
    try { notification = event.data?.json(); } catch (_) { notification = null; }
    if (!notification?.title) return;
    const windows = await self.clients.matchAll({type: "window", includeUncontrolled: true});
    if (windows.some(client => client.visibilityState === "visible")) {
      windows.forEach(client => client.postMessage({type: "allchat.push", notification}));
      return;
    }
    await self.registration.showNotification(notification.title, {
      body: notification.body || "New message",
      tag: notification.tag || "allchat-message",
      icon: notification.icon || "/favicon.ico",
      badge: "/favicon.ico",
      silent: Boolean(notification.silent),
      data: {url: notification.url || "/"},
    });
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
    const windows = await self.clients.matchAll({type: "window", includeUncontrolled: true});
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      if ("navigate" in existing) await existing.navigate(target);
      return;
    }
    await self.clients.openWindow(target);
  })());
});
