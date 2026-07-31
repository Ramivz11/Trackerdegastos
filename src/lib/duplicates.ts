import type { TransactionWithCategory } from '../types'

export interface DuplicateCandidate {
  amount: number
  category_id: string | null
  account_id: string | null
  transaction_date: string
  type: 'expense' | 'income'
}

/**
 * Detecta si un movimiento a punto de guardarse ya existe: mismo monto, misma
 * categoría, misma cuenta y misma fecha. Es el caso típico de tocar "Guardar"
 * dos veces o de cargar de nuevo un gasto que ya se había anotado.
 *
 * Devuelve el movimiento repetido o null.
 */
export function findDuplicate(
  candidate: DuplicateCandidate,
  existing: TransactionWithCategory[],
): TransactionWithCategory | null {
  return (
    existing.find(
      (t) =>
        t.type === candidate.type &&
        t.transaction_date === candidate.transaction_date &&
        t.category_id === candidate.category_id &&
        t.account_id === candidate.account_id &&
        // Tolerancia de un centavo para evitar problemas de redondeo.
        Math.abs(Number(t.amount) - candidate.amount) < 0.01,
    ) ?? null
  )
}
