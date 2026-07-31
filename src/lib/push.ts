import { deletePushSubscription, savePushSubscription } from './api'

/**
 * Notificaciones push en segundo plano (con la app cerrada).
 *
 * Necesita `VITE_VAPID_PUBLIC_KEY` en el entorno y la Edge Function
 * `send-due-notifications` desplegada (ver README).
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/** true si el navegador soporta push y hay una clave VAPID configurada. */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    !!VAPID_PUBLIC_KEY
  )
}

/** La clave VAPID viaja en base64url y el navegador la pide como bytes. */
function urlBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const buffer = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return buffer
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

/**
 * Pide permiso, se suscribe y guarda la suscripción en Supabase.
 * Devuelve un mensaje de error o null si salió todo bien.
 */
export async function enablePush(userId: string): Promise<string | null> {
  if (!pushSupported()) {
    return 'Tu navegador no soporta notificaciones push (o falta configurar la clave VAPID).'
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return 'No diste permiso para notificaciones. Podés habilitarlo desde los ajustes del navegador.'
  }

  try {
    const reg = await navigator.serviceWorker.ready
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(VAPID_PUBLIC_KEY!),
      }))

    const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } }
    if (!json.keys?.p256dh || !json.keys?.auth) {
      return 'El navegador devolvió una suscripción incompleta. Probá de nuevo.'
    }

    await savePushSubscription(
      { endpoint: sub.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
      userId,
    )
    return null
  } catch (e) {
    return `No se pudo activar: ${(e as Error).message}`
  }
}

/** Cancela la suscripción en el navegador y la borra de la base. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await deletePushSubscription(sub.endpoint).catch(() => undefined)
  await sub.unsubscribe().catch(() => undefined)
}

/** Notificación local de prueba, para verificar que el permiso está dado. */
export async function testNotification(): Promise<void> {
  const reg = await navigator.serviceWorker.ready
  await reg.showNotification('Tracker de Gastos', {
    body: 'Las notificaciones están funcionando 🎉',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
  })
}
