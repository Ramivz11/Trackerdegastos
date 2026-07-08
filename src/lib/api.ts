import { supabase } from './supabase'
import type {
  Account,
  AccountBalance,
  Category,
  Goal,
  RecurringExpense,
  StatementPayment,
  Transaction,
  TransactionWithCategory,
  Transfer,
} from '../types'

// ---------- Categorías ----------
export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return data as Category[]
}

export async function createCategory(
  c: Pick<
    Category,
    'name' | 'color' | 'icon' | 'kind' | 'monthly_budget' | 'is_favorite'
  >,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('categories')
    .insert({ ...c, user_id: userId })
  if (error) throw error
}

export async function updateCategory(
  id: string,
  patch: Partial<Category>,
): Promise<void> {
  const { error } = await supabase.from('categories').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) throw error
}

// ---------- Transacciones ----------
export async function fetchTransactionsByMonth(
  month: string, // YYYY-MM
): Promise<TransactionWithCategory[]> {
  const start = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const endDate = new Date(y, m, 0) // último día del mes
  const end = endDate.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('transactions')
    .select('*, category:categories(*)')
    .gte('transaction_date', start)
    .lte('transaction_date', end)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as unknown as TransactionWithCategory[]
}

type NewTransaction = Pick<
  Transaction,
  'category_id' | 'amount' | 'description' | 'transaction_date' | 'type'
> &
  Partial<
    Pick<
      Transaction,
      | 'account_id'
      | 'currency'
      | 'ars_rate'
      | 'group_id'
      | 'installment_n'
      | 'installment_total'
    >
  >

export async function createTransaction(
  t: NewTransaction,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .insert({ ...t, user_id: userId })
  if (error) throw error
}

/** Inserta varias transacciones de una (ej: las cuotas de una compra). */
export async function createTransactions(
  rows: NewTransaction[],
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .insert(rows.map((r) => ({ ...r, user_id: userId })))
  if (error) throw error
}

/** Todas las transacciones de una cuenta (incluye cuotas futuras), más nuevas primero. */
export async function fetchTransactionsByAccount(
  accountId: string,
): Promise<TransactionWithCategory[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*, category:categories(*)')
    .eq('account_id', accountId)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as unknown as TransactionWithCategory[]
}

export async function updateTransaction(
  id: string,
  patch: Partial<Transaction>,
): Promise<void> {
  const { error } = await supabase.from('transactions').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteTransaction(id: string): Promise<void> {
  const { error } = await supabase.from('transactions').delete().eq('id', id)
  if (error) throw error
}

/**
 * Devuelve los IDs de categorías ordenados por uso (más usados primero) en los
 * últimos N días. Sirve para los accesos directos de "gasto rápido".
 */
export async function fetchTopCategoryIds(days = 60): Promise<string[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceISO = since.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('transactions')
    .select('category_id')
    .eq('type', 'expense')
    .gte('transaction_date', sinceISO)
  if (error || !data) return []

  const counts = new Map<string, number>()
  for (const row of data as { category_id: string | null }[]) {
    if (!row.category_id) continue
    counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id)
}

// ---------- Recurrentes ----------
export async function fetchRecurring(): Promise<RecurringExpense[]> {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .select('*')
    .order('next_due_date', { ascending: true })
  if (error) throw error
  return data as RecurringExpense[]
}

export async function createRecurring(
  r: Pick<
    RecurringExpense,
    | 'category_id'
    | 'name'
    | 'amount'
    | 'frequency'
    | 'next_due_date'
    | 'auto_post'
    | 'is_active'
  >,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('recurring_expenses')
    .insert({ ...r, user_id: userId })
  if (error) throw error
}

export async function updateRecurring(
  id: string,
  patch: Partial<RecurringExpense>,
): Promise<void> {
  const { error } = await supabase
    .from('recurring_expenses')
    .update(patch)
    .eq('id', id)
  if (error) throw error
}

export async function deleteRecurring(id: string): Promise<void> {
  const { error } = await supabase.from('recurring_expenses').delete().eq('id', id)
  if (error) throw error
}

// ---------- Cuentas ----------
export async function fetchAccounts(): Promise<Account[]> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as Account[]
}

export async function createAccount(
  a: Pick<
    Account,
    'name' | 'icon' | 'color' | 'type' | 'currency' | 'initial_balance' | 'sort_order'
  > &
    Partial<Pick<Account, 'closing_day' | 'due_day'>>,
  userId: string,
): Promise<void> {
  const { error } = await supabase.from('accounts').insert({ ...a, user_id: userId })
  if (error) throw error
}

export async function updateAccount(
  id: string,
  patch: Partial<Account>,
): Promise<void> {
  const { error } = await supabase.from('accounts').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteAccount(id: string): Promise<void> {
  const { error } = await supabase.from('accounts').delete().eq('id', id)
  if (error) throw error
}

/** Saldo actual de cada cuenta (calculado en la base). */
export async function fetchAccountBalances(): Promise<AccountBalance[]> {
  const { data, error } = await supabase.rpc('account_balances')
  if (error) throw error
  return (data ?? []) as AccountBalance[]
}

// ---------- Transferencias ----------
export async function fetchTransfers(limit = 50): Promise<Transfer[]> {
  const { data, error } = await supabase
    .from('transfers')
    .select('*')
    .order('transfer_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as Transfer[]
}

export async function createTransfer(
  t: Pick<
    Transfer,
    | 'from_account_id'
    | 'to_account_id'
    | 'amount'
    | 'to_amount'
    | 'description'
    | 'transfer_date'
  >,
  userId: string,
): Promise<void> {
  const { error } = await supabase.from('transfers').insert({ ...t, user_id: userId })
  if (error) throw error
}

export async function deleteTransfer(id: string): Promise<void> {
  const { error } = await supabase.from('transfers').delete().eq('id', id)
  if (error) throw error
}

// ---------- Metas de ahorro ----------
export async function fetchGoals(): Promise<Goal[]> {
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as Goal[]
}

export async function createGoal(
  g: Pick<
    Goal,
    | 'name'
    | 'icon'
    | 'color'
    | 'target_amount'
    | 'saved_amount'
    | 'currency'
    | 'target_date'
  >,
  userId: string,
): Promise<void> {
  const { error } = await supabase.from('goals').insert({ ...g, user_id: userId })
  if (error) throw error
}

export async function updateGoal(id: string, patch: Partial<Goal>): Promise<void> {
  const { error } = await supabase.from('goals').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteGoal(id: string): Promise<void> {
  const { error } = await supabase.from('goals').delete().eq('id', id)
  if (error) throw error
}

// ---------- Pagos de resúmenes de tarjeta ----------
export async function fetchStatementPayments(
  accountId: string,
): Promise<StatementPayment[]> {
  const { data, error } = await supabase
    .from('statement_payments')
    .select('*')
    .eq('account_id', accountId)
    .order('cycle_close', { ascending: false })
  if (error) throw error
  return data as StatementPayment[]
}

export async function createStatementPayment(
  p: Pick<
    StatementPayment,
    'account_id' | 'cycle_close' | 'amount' | 'paid_from_account_id' | 'paid_date'
  >,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('statement_payments')
    .insert({ ...p, user_id: userId })
  if (error) throw error
}

export async function deleteStatementPayment(id: string): Promise<void> {
  const { error } = await supabase.from('statement_payments').delete().eq('id', id)
  if (error) throw error
}
