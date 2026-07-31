import { netArs } from './amounts'
import { monthOf, shiftMonth } from './format'
import type { Category, TransactionWithCategory } from '../types'

/** Gasto en ARS por mes y categoría. */
export type SpentByMonth = Map<string, Map<string, number>>

/**
 * Agrupa el gasto (sin transferencias) por mes y categoría.
 * De los gastos compartidos cuenta solo tu parte.
 */
export function spentByMonthAndCategory(
  txs: TransactionWithCategory[],
): SpentByMonth {
  const out: SpentByMonth = new Map()
  for (const t of txs) {
    if (t.is_transfer || t.type !== 'expense') continue
    const month = monthOf(t.transaction_date)
    const cat = t.category_id ?? 'sin-categoria'
    const perMonth = out.get(month) ?? new Map<string, number>()
    perMonth.set(cat, (perMonth.get(cat) ?? 0) + netArs(t))
    out.set(month, perMonth)
  }
  return out
}

export interface BudgetLine {
  category: Category
  /** Límite base configurado en la categoría. */
  budget: number
  /** Sobrante (o exceso, en negativo) arrastrado de los meses anteriores. */
  carry: number
  /** Límite efectivo del mes: base + arrastre. */
  limit: number
  spent: number
  remaining: number
  ratio: number
}

/**
 * Calcula el presupuesto del mes por categoría, incluyendo el arrastre.
 *
 * Para las categorías con `rollover`, lo que sobró en cada mes anterior se
 * suma al límite del siguiente (y lo que se pasó, se resta). El arrastre se
 * acumula sobre `historyMonths` meses hacia atrás; si un mes no tiene datos
 * todavía, no cuenta.
 */
export function buildBudgetLines(
  month: string,
  categories: Category[],
  spent: SpentByMonth,
  historyMonths = 11,
): BudgetLine[] {
  return categories
    .filter((c) => c.monthly_budget != null && c.monthly_budget > 0)
    .map((c) => {
      const budget = c.monthly_budget!
      let carry = 0

      if (c.rollover) {
        for (let i = historyMonths; i >= 1; i--) {
          const m = shiftMonth(month, -i)
          const perMonth = spent.get(m)
          // Sin movimientos ese mes damos por hecho que la app no se usaba.
          if (!perMonth) continue
          carry += budget - (perMonth.get(c.id) ?? 0)
        }
      }

      const limit = budget + carry
      const used = spent.get(month)?.get(c.id) ?? 0
      return {
        category: c,
        budget,
        carry,
        limit,
        spent: used,
        remaining: limit - used,
        ratio: limit > 0 ? used / limit : used > 0 ? Infinity : 0,
      }
    })
    .sort((a, b) => b.ratio - a.ratio)
}

/** Gasto total del mes (todas las categorías, incluida "sin categoría"). */
export function totalSpent(month: string, spent: SpentByMonth): number {
  const perMonth = spent.get(month)
  if (!perMonth) return 0
  let sum = 0
  for (const v of perMonth.values()) sum += v
  return sum
}
