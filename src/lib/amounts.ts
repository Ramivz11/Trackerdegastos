import { toArs } from './format'
import type { Transaction } from '../types'

/**
 * Gastos compartidos: cuando pagás vos la cuenta de todos, el movimiento
 * guarda el total pagado en `amount` y lo que esperás recuperar en
 * `reimbursable_amount`.
 *
 * De ahí salen dos números distintos y los dos hacen falta:
 *
 * - **Neto**: lo que realmente te costó (`amount - reimbursable_amount`). Es el
 *   que va a reportes, presupuestos y totales de gasto.
 * - **Bruto**: `amount`, la plata que efectivamente salió de la cuenta. Es el
 *   que usan los saldos (y lo calcula la base, no esta función).
 */

/** Cuánto esperás recuperar de un movimiento. 0 si no es compartido. */
export function reimbursable(t: Pick<Transaction, 'reimbursable_amount'>): number {
  const v = Number(t.reimbursable_amount ?? 0)
  return v > 0 ? v : 0
}

/** true si el movimiento tiene una parte que te tienen que devolver. */
export function isShared(t: Pick<Transaction, 'reimbursable_amount'>): boolean {
  return reimbursable(t) > 0
}

/** Monto neto en la moneda del movimiento: lo que te costó a vos. */
export function netAmount(
  t: Pick<Transaction, 'amount' | 'reimbursable_amount'>,
): number {
  return Math.max(Number(t.amount) - reimbursable(t), 0)
}

/**
 * Equivalente en ARS del monto neto, usando la cotización guardada en el
 * movimiento. Es lo que hay que sumar en cualquier total de gasto.
 */
export function netArs(
  t: Pick<Transaction, 'amount' | 'reimbursable_amount' | 'currency' | 'ars_rate'>,
): number {
  return toArs(netAmount(t), t.currency, t.ars_rate)
}

/**
 * Divide un gasto en partes iguales entre `people` personas (incluyéndote).
 * Devuelve tu parte y lo que esperás recuperar del resto.
 *
 * El redondeo a 2 decimales queda de tu lado, así `mine + owed` siempre suma
 * el total exacto que salió de la cuenta y no aparecen centavos fantasma.
 */
export function splitShare(
  total: number,
  people: number,
): { mine: number; owed: number } {
  if (!(total > 0) || people <= 1) return { mine: Math.max(total, 0), owed: 0 }
  const owed = Math.round(((total * (people - 1)) / people) * 100) / 100
  return { mine: Math.max(total - owed, 0), owed }
}

/** Equivalente en ARS de lo que te deben por este movimiento. */
export function reimbursableArs(
  t: Pick<Transaction, 'reimbursable_amount' | 'currency' | 'ars_rate'>,
): number {
  return toArs(reimbursable(t), t.currency, t.ars_rate)
}
