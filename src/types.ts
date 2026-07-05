export type TransactionType = 'expense' | 'income'

/** Una categoría sirve para gastos o para ingresos, no para ambos. */
export type CategoryKind = 'expense' | 'income'

export type Frequency = 'once' | 'weekly' | 'monthly' | 'yearly'

/** Monedas soportadas en montos y cuentas. */
export type Currency = 'ARS' | 'USD'

/** Tipo de cuenta: efectivo, banco o tarjeta. */
export type AccountType = 'cash' | 'bank' | 'card'

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

export interface Account {
  id: string
  user_id: string
  name: string
  icon: string
  color: string
  type: AccountType
  currency: Currency
  initial_balance: number
  is_active: boolean
  sort_order: number
  created_at: string
}

export interface Transaction {
  id: string
  user_id: string
  category_id: string | null
  account_id: string | null
  amount: number
  currency: Currency
  ars_rate: number // cuántos ARS vale 1 unidad de la moneda (1 si ya es ARS)
  description: string | null
  transaction_date: string // YYYY-MM-DD
  type: TransactionType
  created_at: string
}

export interface RecurringExpense {
  id: string
  user_id: string
  category_id: string | null
  account_id: string | null
  name: string
  amount: number
  frequency: Frequency
  next_due_date: string // YYYY-MM-DD
  auto_post: boolean
  is_active: boolean
  created_at: string
}

export interface Transfer {
  id: string
  user_id: string
  from_account_id: string
  to_account_id: string
  amount: number // sale de origen (moneda de la cuenta origen)
  to_amount: number // entra a destino (moneda de la cuenta destino)
  description: string | null
  transfer_date: string // YYYY-MM-DD
  created_at: string
}

export interface Goal {
  id: string
  user_id: string
  name: string
  icon: string
  color: string
  target_amount: number
  saved_amount: number
  currency: Currency
  target_date: string | null // YYYY-MM-DD
  is_active: boolean
  created_at: string
}

/** Transacción con la categoría ya resuelta (para listados y reportes). */
export interface TransactionWithCategory extends Transaction {
  category: Category | null
}

/** Saldo calculado de una cuenta (viene del RPC account_balances). */
export interface AccountBalance {
  account_id: string
  balance: number
}
