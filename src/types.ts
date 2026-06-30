export type TransactionType = 'expense' | 'income'

/** Una categoría sirve para gastos o para ingresos, no para ambos. */
export type CategoryKind = 'expense' | 'income'

export type Frequency = 'once' | 'weekly' | 'monthly' | 'yearly'

export interface Category {
  id: string
  user_id: string
  name: string
  color: string
  icon: string
  kind: CategoryKind
  monthly_budget: number | null
  is_favorite: boolean
  created_at: string
}

export interface Transaction {
  id: string
  user_id: string
  category_id: string | null
  amount: number
  description: string | null
  transaction_date: string // YYYY-MM-DD
  type: TransactionType
  created_at: string
}

export interface RecurringExpense {
  id: string
  user_id: string
  category_id: string | null
  name: string
  amount: number
  frequency: Frequency
  next_due_date: string // YYYY-MM-DD
  auto_post: boolean
  is_active: boolean
  created_at: string
}

/** Transacción con la categoría ya resuelta (para listados y reportes). */
export interface TransactionWithCategory extends Transaction {
  category: Category | null
}
