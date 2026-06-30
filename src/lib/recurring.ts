import { addDays, addMonths, addYears, parseISO, isAfter, isEqual } from 'date-fns'
import { supabase } from './supabase'
import { todayISO } from './format'
import type { Frequency, RecurringExpense } from '../types'

/** Calcula la siguiente fecha de vencimiento según la frecuencia. */
export function nextDate(iso: string, frequency: Frequency): string {
  const d = parseISO(iso)
  let next: Date
  switch (frequency) {
    case 'weekly':
      next = addDays(d, 7)
      break
    case 'monthly':
      next = addMonths(d, 1)
      break
    case 'yearly':
      next = addYears(d, 1)
      break
    case 'once':
    default:
      next = d
  }
  return next.toISOString().slice(0, 10)
}

/**
 * Catch-up de gastos recurrentes con auto_post: por cada regla activa cuya
 * fecha de vencimiento ya pasó, inserta la transacción correspondiente y avanza
 * la fecha. Repite hasta ponerse al día (p. ej. si pasaron varios meses).
 * Devuelve cuántas transacciones se generaron.
 */
export async function runRecurringCatchUp(userId: string): Promise<number> {
  const today = todayISO()
  const todayDate = parseISO(today)

  const { data, error } = await supabase
    .from('recurring_expenses')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('auto_post', true)

  if (error || !data) return 0

  let created = 0

  for (const rule of data as RecurringExpense[]) {
    let due = rule.next_due_date
    const inserts: { date: string }[] = []

    // Junta todas las ocurrencias vencidas (hasta hoy inclusive).
    while (
      isAfter(todayDate, parseISO(due)) ||
      isEqual(todayDate, parseISO(due))
    ) {
      inserts.push({ date: due })
      if (rule.frequency === 'once') break
      due = nextDate(due, rule.frequency)
    }

    if (inserts.length === 0) continue

    const rows = inserts.map((i) => ({
      user_id: userId,
      category_id: rule.category_id,
      amount: rule.amount,
      description: rule.name,
      transaction_date: i.date,
      type: 'expense' as const,
    }))

    const { error: insErr } = await supabase.from('transactions').insert(rows)
    if (insErr) continue
    created += rows.length

    // 'once' se desactiva tras generarse; el resto avanza la fecha.
    if (rule.frequency === 'once') {
      await supabase
        .from('recurring_expenses')
        .update({ is_active: false })
        .eq('id', rule.id)
    } else {
      await supabase
        .from('recurring_expenses')
        .update({ next_due_date: due })
        .eq('id', rule.id)
    }
  }

  return created
}
