export type TransactionType = 'expense' | 'income'

/** Una categoría sirve para gastos o para ingresos, no para ambos. */
export type CategoryKind = 'expense' | 'income'

export type Frequency = 'once' | 'weekly' | 'monthly' | 'yearly'

/**
 * Monedas soportadas en montos y cuentas. ARS es la moneda base: todos los
 * totales se calculan en ARS y recién al mostrarlos se convierten a la moneda
 * de visualización elegida en Ajustes.
 */
export type Currency = 'ARS' | 'USD' | 'EUR' | 'BRL' | 'CLP' | 'COP' | 'MXN' | 'UYU'

export const CURRENCIES: { code: Currency; label: string }[] = [
  { code: 'ARS', label: 'Peso argentino ($)' },
  { code: 'USD', label: 'Dólar (US$)' },
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'BRL', label: 'Real (R$)' },
  { code: 'CLP', label: 'Peso chileno ($)' },
  { code: 'COP', label: 'Peso colombiano ($)' },
  { code: 'MXN', label: 'Peso mexicano ($)' },
  { code: 'UYU', label: 'Peso uruguayo ($)' },
]

/** Cuántos ARS vale 1 unidad de cada moneda. ARS siempre vale 1. */
export type RateMap = Partial<Record<Currency, number>>

/** De dónde salen las cotizaciones: a mano o de dolarapi.com. */
export type RateSource =
  | 'manual'
  | 'oficial'
  | 'blue'
  | 'bolsa'
  | 'cripto'
  | 'tarjeta'
  | 'mayorista'

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
  /** Si sobra presupuesto en un mes, se suma al límite del mes siguiente. */
  rollover: boolean
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
  /** Solo tarjetas: día del mes en que cierra el resumen (1-31). */
  closing_day: number | null
  /** Solo tarjetas: día del mes en que vence el resumen (1-31). */
  due_day: number | null
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
  /** Cuotas: agrupa las cuotas de una misma compra (null si no es en cuotas). */
  group_id: string | null
  /** Cuotas: número de esta cuota (1-based). */
  installment_n: number | null
  /** Cuotas: cantidad total de cuotas de la compra. */
  installment_total: number | null
  /**
   * true solo en el movimiento "crédito" generado por una compra de moneda
   * (ver `buyCurrency`): ajusta el saldo de la cuenta destino pero se
   * excluye de los totales de ingreso/gasto en reportes.
   */
  is_transfer: boolean
  /**
   * Gasto compartido: cuánto de este movimiento esperás que te devuelvan
   * (en la misma moneda que `amount`). 0 = el gasto es todo tuyo.
   *
   * El gasto que se cuenta en reportes y presupuestos es
   * `amount - reimbursable_amount`; de la cuenta salió el `amount` completo.
   */
  reimbursable_amount: number
  /** Quiénes te deben, en texto libre. */
  reimbursable_note: string | null
  /** Ruta de la foto del ticket dentro del bucket `receipts` de Storage. */
  receipt_path: string | null
  /** Regla recurrente que generó este movimiento (null si se cargó a mano). */
  recurring_id: string | null
  created_at: string
}

/**
 * Una línea del pago de un resumen de tarjeta. Un mismo resumen puede tener
 * varias: por ejemplo una parte en pesos desde el banco y otra en dólares desde
 * la caja de ahorro en USD.
 *
 * Hay dos pares de valores, igual que en `Transfer`:
 * - `amount` + `currency`: lo que sale de `paid_from_account_id`.
 * - `applied_amount` + `applied_currency`: cuánto cubre del resumen.
 *
 * Si las dos monedas coinciden los montos son iguales; si no, la relación entre
 * ambos es el tipo de cambio al que pagaste.
 */
export interface StatementPayment {
  id: string
  user_id: string
  account_id: string // la tarjeta
  cycle_close: string // YYYY-MM-DD, fecha de cierre que identifica el resumen
  amount: number
  currency: Currency
  applied_amount: number
  applied_currency: Currency
  paid_from_account_id: string | null
  /** Movimiento que representa esta línea en el historial (null si no salió de una cuenta). */
  transaction_id: string | null
  paid_date: string // YYYY-MM-DD
  created_at: string
}

export interface RecurringExpense {
  id: string
  user_id: string
  category_id: string | null
  account_id: string | null
  name: string
  amount: number
  /**
   * Moneda del pago. Puede ser distinta a la de la cuenta: una suscripción en
   * dólares que se paga con la tarjeta en pesos va en USD y entra al subtotal
   * en dólares del resumen.
   */
  currency: Currency
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

/** Un cobro (total o parcial) de un gasto compartido. */
export interface Reimbursement {
  id: string
  user_id: string
  transaction_id: string
  amount: number
  /** Cuenta donde entró la plata. */
  account_id: string | null
  received_date: string // YYYY-MM-DD
  note: string | null
  created_at: string
}

/** Un gasto compartido con lo ya cobrado y lo que falta. */
export interface Receivable {
  transaction: TransactionWithCategory
  /** Total esperado, en la moneda del movimiento. */
  expected: number
  collected: number
  pending: number
  payments: Reimbursement[]
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

/** Ajustes del usuario, sincronizados entre dispositivos vía Supabase. */
export interface UserSettings {
  user_id: string
  /** Moneda en la que se muestran los totales (los datos siguen en ARS). */
  display_currency: Currency
  rates: RateMap
  rate_source: RateSource
  rates_updated_at: string | null
  /** Techo de gasto mensual para todas las categorías juntas (en ARS). */
  monthly_budget_total: number | null
  push_enabled: boolean
  updated_at: string
}

/** Regla de auto-categorización por texto de la descripción. */
export interface CategoryRule {
  id: string
  user_id: string
  /** Texto que se busca dentro de la descripción (sin distinguir mayúsculas). */
  pattern: string
  category_id: string | null
  /** Si está seteada, la regla también sugiere esta cuenta. */
  account_id: string | null
  priority: number
  is_active: boolean
  created_at: string
}

/** Hogar: varios usuarios compartiendo el mismo tracker. */
export interface Household {
  id: string
  name: string
  owner_id: string
  created_at: string
}

export interface HouseholdMember {
  household_id: string
  user_id: string
  email: string | null
  role: 'owner' | 'member'
  created_at: string
}

export interface HouseholdInvite {
  id: string
  household_id: string
  email: string
  invited_by: string
  created_at: string
}

/** Un punto de la serie de patrimonio (viene del RPC net_worth_series). */
export interface NetWorthPoint {
  month: string // YYYY-MM-DD (cierre del mes, o hoy para el mes en curso)
  currency: Currency
  balance: number
}

/** Suscripción a notificaciones push guardada en la base. */
export interface PushSubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: string
}
