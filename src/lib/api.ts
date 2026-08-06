import { supabase } from './supabase'
import { monthRange, rateFor } from './format'
import type {
  Account,
  AccountBalance,
  Category,
  CategoryRule,
  Currency,
  Goal,
  Household,
  HouseholdInvite,
  HouseholdMember,
  NetWorthPoint,
  Receivable,
  Reimbursement,
  RecurringExpense,
  StatementPayment,
  Transaction,
  TransactionWithCategory,
  Transfer,
  UserSettings,
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
/** Movimientos entre dos fechas (inclusive), más nuevos primero. */
export async function fetchTransactionsRange(
  start: string, // YYYY-MM-DD
  end: string, // YYYY-MM-DD
): Promise<TransactionWithCategory[]> {
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

export async function fetchTransactionsByMonth(
  month: string, // YYYY-MM
): Promise<TransactionWithCategory[]> {
  const { start, end } = monthRange(month)
  return fetchTransactionsRange(start, end)
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
      | 'is_transfer'
      | 'receipt_path'
      | 'recurring_id'
      | 'reimbursable_amount'
      | 'reimbursable_note'
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
 * Compra de moneda: crea el gasto real en la cuenta origen (cuenta y suma
 * en reportes) y el crédito en la cuenta destino (ajusta su saldo pero no
 * cuenta como ingreso, ver `is_transfer`).
 */
export async function buyCurrency(
  params: {
    fromAccountId: string
    toAccountId: string
    fromCurrency: Currency
    toCurrency: Currency
    spentAmount: number
    receivedAmount: number
    categoryId: string | null
    date: string
    description: string | null
  },
  userId: string,
): Promise<void> {
  const rows: NewTransaction[] = [
    {
      category_id: params.categoryId,
      account_id: params.fromAccountId,
      amount: params.spentAmount,
      currency: params.fromCurrency,
      ars_rate: rateFor(params.fromCurrency),
      description: params.description,
      transaction_date: params.date,
      type: 'expense',
    },
    {
      category_id: null,
      account_id: params.toAccountId,
      amount: params.receivedAmount,
      currency: params.toCurrency,
      ars_rate: rateFor(params.toCurrency),
      description: params.description,
      transaction_date: params.date,
      type: 'income',
      is_transfer: true,
    },
  ]
  await createTransactions(rows, userId)
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

/** Una línea del pago de un resumen tal como la arma la pantalla de tarjetas. */
export interface StatementPaymentLine {
  /** Cuenta de la que sale la plata; null = "solo marcar", no toca ningún saldo. */
  paidFromAccountId: string | null
  /** Lo que sale de esa cuenta, en su moneda. */
  amount: number
  currency: Currency
  /** Cuánto cubre del resumen y en qué moneda del resumen. */
  appliedAmount: number
  appliedCurrency: Currency
}

/**
 * Registra el pago de un resumen repartido entre varias cuentas y monedas.
 *
 * Cada línea con cuenta genera además un movimiento marcado como `is_transfer`:
 * así el pago se ve en el historial de esa cuenta y le baja el saldo, pero no
 * cuenta como gasto en reportes (los consumos de la tarjeta ya son el gasto).
 */
export async function createStatementPayment(
  params: {
    card: Pick<Account, 'id' | 'name'>
    cycleClose: string // YYYY-MM-DD
    paidDate: string // YYYY-MM-DD
    lines: StatementPaymentLine[]
  },
  userId: string,
): Promise<void> {
  const { card, cycleClose, paidDate, lines } = params
  const withAccount = lines.filter((l) => l.paidFromAccountId)

  // Primero los movimientos, para poder guardar su id en cada línea del pago.
  let txIds: string[] = []
  if (withAccount.length > 0) {
    const { data, error } = await supabase
      .from('transactions')
      .insert(
        withAccount.map((l) => ({
          user_id: userId,
          category_id: null,
          account_id: l.paidFromAccountId,
          amount: l.amount,
          currency: l.currency,
          ars_rate: rateFor(l.currency),
          description: `Pago resumen ${card.name}`,
          transaction_date: paidDate,
          type: 'expense' as const,
          is_transfer: true,
        })),
      )
      .select('id')
    if (error) throw error
    txIds = (data as { id: string }[]).map((r) => r.id)
  }

  let next = 0
  const rows = lines.map((l) => ({
    user_id: userId,
    account_id: card.id,
    cycle_close: cycleClose,
    amount: l.amount,
    currency: l.currency,
    applied_amount: l.appliedAmount,
    applied_currency: l.appliedCurrency,
    paid_from_account_id: l.paidFromAccountId,
    transaction_id: l.paidFromAccountId ? (txIds[next++] ?? null) : null,
    paid_date: paidDate,
  }))

  const { error } = await supabase.from('statement_payments').insert(rows)
  if (error) throw error
}

/**
 * Deshace el pago de un resumen: borra sus líneas y los movimientos que
 * generaron, así los saldos vuelven a como estaban.
 */
export async function deleteStatementPaymentsForCycle(
  cardId: string,
  cycleClose: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('statement_payments')
    .select('id, transaction_id')
    .eq('account_id', cardId)
    .eq('cycle_close', cycleClose)
  if (error) throw error

  const rows = (data ?? []) as { id: string; transaction_id: string | null }[]
  const txIds = rows.map((r) => r.transaction_id).filter((id): id is string => !!id)

  const { error: delError } = await supabase
    .from('statement_payments')
    .delete()
    .eq('account_id', cardId)
    .eq('cycle_close', cycleClose)
  if (delError) throw delError

  if (txIds.length > 0) {
    const { error: txError } = await supabase
      .from('transactions')
      .delete()
      .in('id', txIds)
    if (txError) throw txError
  }
}

// ---------- Ajustes del usuario ----------
/** Trae los ajustes; si el usuario todavía no tiene fila, la crea. */
export async function fetchSettings(userId: string): Promise<UserSettings> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (data) return data as UserSettings

  const { data: created, error: insErr } = await supabase
    .from('user_settings')
    .insert({ user_id: userId })
    .select('*')
    .single()
  if (insErr) throw insErr
  return created as UserSettings
}

export async function saveSettings(
  userId: string,
  patch: Partial<Omit<UserSettings, 'user_id'>>,
): Promise<UserSettings> {
  const { data, error } = await supabase
    .from('user_settings')
    .upsert(
      { user_id: userId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
    .select('*')
    .single()
  if (error) throw error
  return data as UserSettings
}

// ---------- Reglas de auto-categorización ----------
export async function fetchCategoryRules(): Promise<CategoryRule[]> {
  const { data, error } = await supabase
    .from('category_rules')
    .select('*')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as CategoryRule[]
}

export async function createCategoryRule(
  r: Pick<CategoryRule, 'pattern' | 'category_id' | 'account_id' | 'priority'>,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('category_rules')
    .insert({ ...r, user_id: userId })
  if (error) throw error
}

export async function updateCategoryRule(
  id: string,
  patch: Partial<CategoryRule>,
): Promise<void> {
  const { error } = await supabase.from('category_rules').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteCategoryRule(id: string): Promise<void> {
  const { error } = await supabase.from('category_rules').delete().eq('id', id)
  if (error) throw error
}

/**
 * Aplica las reglas a los movimientos ya cargados que no tienen categoría (o
 * que tienen la que la regla indica que debería cambiar). Devuelve cuántos
 * movimientos se recategorizaron.
 */
export async function applyRulesToExisting(
  rules: CategoryRule[],
  onlyUncategorized = true,
): Promise<number> {
  const active = rules.filter((r) => r.is_active && r.category_id)
  if (active.length === 0) return 0

  let query = supabase.from('transactions').select('id, description, category_id')
  if (onlyUncategorized) query = query.is('category_id', null)
  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as {
    id: string
    description: string | null
    category_id: string | null
  }[]

  let changed = 0
  for (const row of rows) {
    const text = (row.description ?? '').toLowerCase()
    if (!text) continue
    const hit = active.find((r) => text.includes(r.pattern.toLowerCase()))
    if (!hit || hit.category_id === row.category_id) continue
    const { error: upErr } = await supabase
      .from('transactions')
      .update({ category_id: hit.category_id })
      .eq('id', row.id)
    if (!upErr) changed++
  }
  return changed
}

// ---------- Modo hogar ----------
export async function fetchMyHousehold(): Promise<Household | null> {
  const { data, error } = await supabase.from('households').select('*').limit(1)
  if (error) throw error
  return (data?.[0] as Household) ?? null
}

export async function fetchHouseholdMembers(
  householdId: string,
): Promise<HouseholdMember[]> {
  const { data, error } = await supabase
    .from('household_members')
    .select('*')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as HouseholdMember[]
}

export async function fetchHouseholdInvites(
  householdId: string,
): Promise<HouseholdInvite[]> {
  const { data, error } = await supabase
    .from('household_invites')
    .select('*')
    .eq('household_id', householdId)
  if (error) throw error
  return data as HouseholdInvite[]
}

export async function createHousehold(
  name: string,
  userId: string,
): Promise<Household> {
  const { data, error } = await supabase
    .from('households')
    .insert({ name, owner_id: userId })
    .select('*')
    .single()
  if (error) throw error
  return data as Household
}

export async function inviteToHousehold(
  householdId: string,
  email: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase.from('household_invites').insert({
    household_id: householdId,
    email: email.trim().toLowerCase(),
    invited_by: userId,
  })
  if (error) throw error
}

export async function cancelInvite(id: string): Promise<void> {
  const { error } = await supabase.from('household_invites').delete().eq('id', id)
  if (error) throw error
}

export async function removeHouseholdMember(
  householdId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('household_members')
    .delete()
    .eq('household_id', householdId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function deleteHousehold(id: string): Promise<void> {
  const { error } = await supabase.from('households').delete().eq('id', id)
  if (error) throw error
}

/** Convierte en membresías las invitaciones dirigidas a mi email. */
export async function acceptPendingInvites(): Promise<number> {
  const { data, error } = await supabase.rpc('accept_pending_invites')
  if (error) return 0
  return (data as number) ?? 0
}

// ---------- Patrimonio ----------
export async function fetchNetWorthSeries(months = 12): Promise<NetWorthPoint[]> {
  const { data, error } = await supabase.rpc('net_worth_series', { months })
  if (error) throw error
  return (data ?? []) as NetWorthPoint[]
}

// ---------- Recurrentes en el servidor ----------
/** Pone al día tus recurrentes automáticos. Idempotente (ver schema.sql). */
export async function postDueRecurring(): Promise<number> {
  const { data, error } = await supabase.rpc('post_due_recurring_me')
  if (error) throw error
  return (data as number) ?? 0
}

// ---------- Notificaciones push ----------
export async function savePushSubscription(
  sub: { endpoint: string; p256dh: string; auth: string },
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ ...sub, user_id: userId }, { onConflict: 'endpoint' })
  if (error) throw error
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
  if (error) throw error
}

// ---------- Gastos compartidos (lo que te deben) ----------
/**
 * Gastos con una parte a recuperar, junto con los cobros ya hechos.
 *
 * `onlyPending` deja solo los que todavía tienen saldo sin cobrar, que es lo
 * que se muestra en el panel "Te deben".
 */
export async function fetchReceivables(
  onlyPending = true,
): Promise<Receivable[]> {
  const { data: txData, error: txError } = await supabase
    .from('transactions')
    .select('*, category:categories(*)')
    .gt('reimbursable_amount', 0)
    .order('transaction_date', { ascending: false })
  if (txError) throw txError

  const txs = (txData ?? []) as unknown as TransactionWithCategory[]
  if (txs.length === 0) return []

  const { data: rbData, error: rbError } = await supabase
    .from('reimbursements')
    .select('*')
    .in(
      'transaction_id',
      txs.map((t) => t.id),
    )
    .order('received_date', { ascending: true })
  if (rbError) throw rbError

  const byTx = new Map<string, Reimbursement[]>()
  for (const r of (rbData ?? []) as Reimbursement[]) {
    const list = byTx.get(r.transaction_id) ?? []
    list.push(r)
    byTx.set(r.transaction_id, list)
  }

  return txs
    .map((t) => {
      const payments = byTx.get(t.id) ?? []
      const expected = Number(t.reimbursable_amount)
      const collected = payments.reduce((s, p) => s + Number(p.amount), 0)
      return {
        transaction: t,
        expected,
        collected,
        // Con tolerancia de un centavo, para que un cobro exacto no deje resto.
        pending: Math.max(expected - collected, 0),
        payments,
      }
    })
    .filter((r) => (onlyPending ? r.pending > 0.009 : true))
}

export async function createReimbursement(
  r: Pick<
    Reimbursement,
    'transaction_id' | 'amount' | 'account_id' | 'received_date' | 'note'
  >,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('reimbursements')
    .insert({ ...r, user_id: userId })
  if (error) throw error
}

export async function deleteReimbursement(id: string): Promise<void> {
  const { error } = await supabase.from('reimbursements').delete().eq('id', id)
  if (error) throw error
}

/**
 * Da por perdido lo que falta cobrar: baja `reimbursable_amount` a lo que ya
 * se cobró, así el gasto pasa a contar entero como tuyo.
 */
export async function writeOffReceivable(r: Receivable): Promise<void> {
  await updateTransaction(r.transaction.id, {
    reimbursable_amount: r.collected,
  })
}

// ---------- Backup completo ----------
const BACKUP_TABLES = [
  'categories',
  'accounts',
  'transactions',
  'recurring_expenses',
  'transfers',
  'goals',
  'statement_payments',
  'category_rules',
  'reimbursements',
] as const

/** Descarga todas tus tablas para el backup en JSON. */
export async function fetchFullBackup(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const table of BACKUP_TABLES) {
    const { data, error } = await supabase.from(table).select('*')
    if (error) throw error
    out[table] = data ?? []
  }
  return out
}
