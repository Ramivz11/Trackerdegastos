/**
 * send-due-notifications — avisa por push de lo que está por vencer.
 *
 * Revisa los gastos recurrentes de los próximos 3 días y los vencimientos de
 * tarjetas, y le manda una notificación a cada usuario que tenga el push
 * activado. Pensada para correr una vez por día desde pg_cron (ver README).
 *
 * Desplegar:
 *   npx web-push generate-vapid-keys
 *   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:vos@example.com
 *   supabase functions deploy send-due-notifications --no-verify-jwt
 */

import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import webpush from 'npm:web-push@3.6.7'
import { jsonResponse } from '../_shared/cors.ts'

interface SubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

interface RecurringRow {
  user_id: string
  name: string
  amount: number
  currency: string | null
  next_due_date: string
}

interface CardRow {
  user_id: string
  name: string
  due_day: number
}

/** Fecha de hoy en YYYY-MM-DD, en horario de Argentina. */
function todayInBuenosAires(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  })
}

function daysUntil(iso: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`)
  const b = Date.parse(`${iso}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

function whenLabel(days: number): string {
  if (days < 0) return 'está vencido'
  if (days === 0) return 'vence hoy'
  if (days === 1) return 'vence mañana'
  return `vence en ${days} días`
}

/** Formatea en la moneda del pago (una suscripción puede estar en dólares). */
function formatAmount(amount: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: currency || 'ARS',
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `$ ${Math.round(amount)}`
  }
}

/** Días hasta el próximo día `dueDay` del mes (hoy o el mes que viene). */
function daysUntilMonthDay(dueDay: number, today: string): number {
  const [y, m, d] = today.split('-').map(Number)
  const daysThisMonth = new Date(y, m, 0).getDate()
  // Si la tarjeta vence el 31 y el mes tiene 30, se toma el último día.
  const effective = Math.min(dueDay, daysThisMonth)
  if (effective >= d) return effective - d
  const daysNextMonth = new Date(y, m + 1, 0).getDate()
  return daysThisMonth - d + Math.min(dueDay, daysNextMonth)
}

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'

  if (!supabaseUrl || !serviceKey || !vapidPublic || !vapidPrivate) {
    return jsonResponse({ error: 'Faltan secretos de configuración' }, 500)
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
  const supabase = createClient(supabaseUrl, serviceKey)

  const today = todayInBuenosAires()
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + 3 * 86_400_000)
    .toISOString()
    .slice(0, 10)

  // Un mensaje por usuario, juntando recurrentes y tarjetas.
  const avisos = new Map<string, string[]>()
  const push = (userId: string, linea: string) => {
    const list = avisos.get(userId) ?? []
    list.push(linea)
    avisos.set(userId, list)
  }

  const { data: recurring } = await supabase
    .from('recurring_expenses')
    .select('user_id, name, amount, currency, next_due_date')
    .eq('is_active', true)
    .eq('auto_post', false)
    .lte('next_due_date', horizon)

  for (const r of (recurring ?? []) as RecurringRow[]) {
    const days = daysUntil(r.next_due_date, today)
    push(
      r.user_id,
      `${r.name} (${formatAmount(Number(r.amount), r.currency)}) ${whenLabel(days)}`,
    )
  }

  const { data: cards } = await supabase
    .from('accounts')
    .select('user_id, name, due_day')
    .eq('type', 'card')
    .eq('is_active', true)
    .not('due_day', 'is', null)

  for (const c of (cards ?? []) as CardRow[]) {
    const days = daysUntilMonthDay(c.due_day, today)
    if (days <= 3) push(c.user_id, `El resumen de ${c.name} ${whenLabel(days)}`)
  }

  if (avisos.size === 0) {
    return jsonResponse({ sent: 0, users: 0, note: 'Nada por vencer' })
  }

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', [...avisos.keys()])

  let sent = 0
  const expired: string[] = []

  for (const sub of (subs ?? []) as SubscriptionRow[]) {
    const lineas = avisos.get(sub.user_id)
    if (!lineas || lineas.length === 0) continue

    const payload = JSON.stringify({
      title: lineas.length === 1 ? '🔔 Vencimiento' : `🔔 ${lineas.length} vencimientos`,
      body: lineas.slice(0, 4).join('\n'),
      url: '/recurrentes',
      tag: 'vencimientos',
    })

    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
      )
      sent++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      // 404/410 = el navegador dio de baja la suscripción; la limpiamos.
      if (status === 404 || status === 410) expired.push(sub.id)
      else console.error('Push falló:', status, (e as Error).message)
    }
  }

  if (expired.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', expired)
  }

  return jsonResponse({ sent, users: avisos.size, cleaned: expired.length })
})
