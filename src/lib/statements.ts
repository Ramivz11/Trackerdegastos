import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import type { Account, StatementPayment, TransactionWithCategory } from '../types'

/**
 * Lógica de tarjetas de crédito: ciclos de facturación, cuotas y resúmenes.
 *
 * Un resumen (statement) junta los gastos de un ciclo. Con cierre el día D, el
 * resumen "que cierra el D del mes M" cubre desde el (D+1) del mes anterior hasta
 * el D del mes M inclusive. Cada resumen se identifica por su fecha de cierre.
 */

/** Fecha (Date local) → 'YYYY-MM-DD' respetando la zona horaria local. */
function dateToISO(d: Date): string {
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

/** Construye una fecha con día `day`, recortando al último día si el mes es más corto. */
function makeDate(year: number, monthIdx: number, day: number): Date {
  const last = new Date(year, monthIdx + 1, 0).getDate() // último día del mes
  return new Date(year, monthIdx, Math.min(day, last))
}

/** 'YYYY-MM-DD' + N meses, conservando el día (recortado si el mes es más corto). */
export function addMonthsISO(dateISO: string, n: number): string {
  const d = parseISO(dateISO)
  return dateToISO(makeDate(d.getFullYear(), d.getMonth() + n, d.getDate()))
}

/**
 * Fecha de cierre del ciclo al que pertenece una transacción con fecha `dateISO`,
 * para una tarjeta que cierra el día `closingDay`.
 */
export function cycleCloseFor(dateISO: string, closingDay: number): string {
  const d = parseISO(dateISO)
  const monthIdx = d.getDate() > closingDay ? d.getMonth() + 1 : d.getMonth()
  return dateToISO(makeDate(d.getFullYear(), monthIdx, closingDay))
}

/**
 * Fecha de vencimiento de un resumen: la primera aparición del día `dueDay`
 * posterior a la fecha de cierre.
 */
export function dueDateFor(closeISO: string, dueDay: number): string {
  const c = parseISO(closeISO)
  // Si el vencimiento cae en el mismo mes pero después del cierre, es ese; si no,
  // el mes siguiente.
  const sameMonth = makeDate(c.getFullYear(), c.getMonth(), dueDay)
  if (sameMonth > c) return dateToISO(sameMonth)
  return dateToISO(makeDate(c.getFullYear(), c.getMonth() + 1, dueDay))
}

export interface InstallmentRow {
  amount: number
  transaction_date: string
  installment_n: number
  installment_total: number
}

/**
 * Reparte una compra en `count` cuotas iguales (sin interés). El total se divide
 * en centavos para no perder plata por redondeo; el resto se agrega a las
 * primeras cuotas. La cuota 1 queda fechada en el día de compra (entra en el
 * resumen del ciclo de compra) y cada cuota siguiente un mes después.
 */
export function buildInstallmentRows(
  totalAmount: number,
  count: number,
  purchaseDateISO: string,
): InstallmentRow[] {
  const totalCents = Math.round(totalAmount * 100)
  const base = Math.floor(totalCents / count)
  const remainder = totalCents - base * count
  const rows: InstallmentRow[] = []
  for (let i = 0; i < count; i++) {
    const cents = base + (i < remainder ? 1 : 0)
    rows.push({
      amount: cents / 100,
      transaction_date: addMonthsISO(purchaseDateISO, i),
      installment_n: i + 1,
      installment_total: count,
    })
  }
  return rows
}

/**
 * Fase de un resumen respecto de hoy:
 * - 'current': es el ciclo que está abierto ahora (donde caen los gastos de hoy).
 * - 'future': todavía no empezó a cerrar (ej: cuotas que vencen más adelante).
 * - 'closed': ya cerró; se puede marcar como pagado.
 */
export type StatementPhase = 'current' | 'future' | 'closed'

export interface Statement {
  /** Fecha de cierre (YYYY-MM-DD), identifica el resumen. */
  closeISO: string
  /** Fecha de vencimiento (YYYY-MM-DD) o null si la tarjeta no tiene día de venc. */
  dueISO: string | null
  items: TransactionWithCategory[]
  total: number
  phase: StatementPhase
  /** El pago registrado de este resumen, si existe. */
  payment: StatementPayment | null
}

/**
 * Arma los resúmenes de una tarjeta a partir de sus transacciones, ordenados del
 * más nuevo (ciclo abierto arriba) al más viejo.
 */
export function buildStatements(
  card: Account,
  txs: TransactionWithCategory[],
  payments: StatementPayment[],
  todayISO: string,
): Statement[] {
  const closingDay = card.closing_day ?? 28
  const openClose = cycleCloseFor(todayISO, closingDay)
  const paymentByClose = new Map(payments.map((p) => [p.cycle_close, p]))

  const groups = new Map<string, TransactionWithCategory[]>()
  for (const t of txs) {
    if (t.type !== 'expense') continue // en una tarjeta juntamos los gastos
    const close = cycleCloseFor(t.transaction_date, closingDay)
    const arr = groups.get(close) ?? []
    arr.push(t)
    groups.set(close, arr)
  }

  const statements: Statement[] = []
  for (const [closeISO, items] of groups) {
    items.sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))
    const phase: StatementPhase =
      closeISO === openClose ? 'current' : closeISO > openClose ? 'future' : 'closed'
    statements.push({
      closeISO,
      dueISO: card.due_day != null ? dueDateFor(closeISO, card.due_day) : null,
      items,
      total: items.reduce((s, t) => s + Number(t.amount), 0),
      phase,
      payment: paymentByClose.get(closeISO) ?? null,
    })
  }
  statements.sort((a, b) => b.closeISO.localeCompare(a.closeISO))
  return statements
}

/**
 * Total del ciclo abierto (la "deuda" que se está formando). Es lo que mostramos
 * como saldo de la tarjeta en la lista de cuentas.
 */
export function openCycleTotal(
  card: Account,
  txs: TransactionWithCategory[],
  todayISO: string,
): number {
  const closingDay = card.closing_day ?? 28
  const openClose = cycleCloseFor(todayISO, closingDay)
  return txs
    .filter(
      (t) =>
        t.type === 'expense' &&
        cycleCloseFor(t.transaction_date, closingDay) === openClose,
    )
    .reduce((s, t) => s + Number(t.amount), 0)
}

/** Texto tipo "28 de jul." para una fecha ISO. */
export function formatShort(iso: string): string {
  return format(parseISO(iso), "d 'de' MMM", { locale: es })
}
