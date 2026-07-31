/* eslint-disable no-undef */
/**
 * Handlers de push para el service worker.
 *
 * Workbox lo carga con importScripts (ver vite.config.ts), así que convive con
 * el service worker generado automáticamente para la PWA.
 */

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'Tracker de Gastos', body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'Tracker de Gastos'
  const options = {
    body: payload.body || '',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload.tag || 'vencimientos',
    renotify: true,
    data: { url: payload.url || '/recurrentes' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Si la app ya está abierta, la traemos al frente en vez de abrir otra.
        for (const client of clientList) {
          if ('focus' in client) {
            client.navigate(target)
            return client.focus()
          }
        }
        return self.clients.openWindow(target)
      }),
  )
})
