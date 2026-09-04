import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from '../components/Modal'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import {
  createRecurring,
  createTransaction,
  deleteRecurring,
  fetchRecurring,
  updateRecurring,
} from '../lib/api'
import { nextDate } from '../lib/recurring'
import { cardCurrencies, currencyLabel } from '../lib/statements'
import { formatDate, formatMoney, rateFor, todayISO } from '../lib/format'
import type { Currency, Frequency, RecurringExpense } from '../types'
import { differenceInCalendarDays, parseISO } from 'date-fns'

const FREQ_LABEL: Record<Frequency, string> = {
  once: 'Una vez',
  weekly: 'Semanal',
  monthly: 'Mensual',
  yearly: 'Anual',
}

export default function Recurring() {
  const { categories, categoriesById, accounts, accountsById } = useData()
  const { user } = useAuth()
  const [items, setItems] = useState<RecurringExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number>()

  function showToast(message: string) {
    setToast(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2800)
  }

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<RecurringExpense | null>(null)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  // Normalmente es la moneda de la cuenta; en tarjetas se puede cambiar, porque
  // una tarjeta en pesos también tiene suscripciones en dólares.
  const [currency, setCurrency] = useState<Currency>('ARS')
  const [frequency, setFrequency] = useState<Frequency>('monthly')
  const [dueDate, setDueDate] = useState(todayISO())
  const [autoPost, setAutoPost] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await fetchRecurring())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openNew() {
    setEditing(null)
    setName('')
    setAmount('')
    setCategoryId(categories[0]?.id ?? '')
    setAccountId(accounts[0]?.id ?? '')
    setCurrency(accounts[0]?.currency ?? 'ARS')
    setFrequency('monthly')
    setDueDate(todayISO())
    setAutoPost(false)
    setOpen(true)
  }

  function openEdit(r: RecurringExpense) {
    setEditing(r)
    setName(r.name)
    setAmount(String(r.amount))
    setCategoryId(r.category_id ?? '')
    setAccountId(r.account_id ?? '')
    // Los recurrentes cargados antes de tener moneda propia usaban la de su cuenta.
    setCurrency(
      r.currency ??
        (r.account_id ? (accountsById[r.account_id]?.currency ?? 'ARS') : 'ARS'),
    )
    setFrequency(r.frequency)
    setDueDate(r.next_due_date)
    setAutoPost(r.auto_post)
    setOpen(true)
  }

  async function save() {
    if (!user || !name.trim()) return
    const value = parseFloat(amount)
    if (isNaN(value) || value <= 0) return
    setSaving(true)
    try {
      const acc = accountId ? accountsById[accountId] : null
      // Solo las tarjetas admiten una moneda distinta a la de la cuenta.
      const txCurrency: Currency =
        acc?.type === 'card' ? currency : (acc?.currency ?? 'ARS')
      const payload = {
        name: name.trim(),
        amount: value,
        currency: txCurrency,
        category_id: categoryId || null,
        account_id: accountId || null,
        frequency,
        next_due_date: dueDate,
        auto_post: autoPost,
        is_active: true,
      }
      if (editing) await updateRecurring(editing.id, payload)
      else await createRecurring(payload, user.id)
      setOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function remove(r: RecurringExpense) {
    if (!confirm(`¿Eliminar "${r.name}"?`)) return
    await deleteRecurring(r.id)
    await load()
  }

  /** Marca como pagado: genera la transacción y avanza la fecha. */
  async function markPaid(r: RecurringExpense) {
    if (!user || payingId) return
    setPayingId(r.id)
    try {
      // La moneda es la del recurrente; si es de antes de tener una propia, la
      // de su cuenta.
      const paidCurrency: Currency =
        r.currency ??
        (r.account_id ? (accountsById[r.account_id]?.currency ?? 'ARS') : 'ARS')
      await createTransaction(
        {
          category_id: r.category_id,
          account_id: r.account_id,
          amount: r.amount,
          currency: paidCurrency,
          ars_rate: rateFor(paidCurrency),
          description: r.name,
          transaction_date: todayISO(),
          type: 'expense',
        },
        user.id,
      )
      let message: string
      if (r.frequency === 'once') {
        await updateRecurring(r.id, { is_active: false })
        message = `✓ ${r.name} pagado (${formatMoney(Number(r.amount), paidCurrency)})`
      } else {
        const next = nextDate(r.next_due_date, r.frequency)
        await updateRecurring(r.id, { next_due_date: next })
        message = `✓ ${r.name} pagado · próximo: ${formatDate(next)}`
      }
      showToast(message)
      await load()
      // Resalta la tarjeta actualizada un instante (si sigue visible).
      setFlashId(r.id)
      window.setTimeout(() => setFlashId(null), 1000)
    } finally {
      setPayingId(null)
    }
  }

  const active = items.filter((r) => r.is_active)

  return (
    <div>
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <div className="toast-in max-w-sm rounded-xl bg-emerald-600 px-4 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-emerald-900/40">
            {toast}
          </div>
        </div>
      )}

      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Pagos y recurrentes</h1>
        <button onClick={openNew} className="btn-primary px-3 py-2 text-sm">
          + Nuevo
        </button>
      </header>

      <p className="mb-4 text-sm text-slate-400">
        Recordatorios de pago y gastos fijos. Los marcados con 🔁 se cargan solos
        cuando vencen.
      </p>

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : active.length === 0 ? (
        <p className="py-8 text-center text-slate-500">
          No tenés pagos programados. Agregá uno con “+ Nuevo”.
        </p>
      ) : (
        <div className="space-y-2">
          {active.map((r) => {
            const cat = r.category_id ? categoriesById[r.category_id] : null
            const days = differenceInCalendarDays(
              parseISO(r.next_due_date),
              parseISO(todayISO()),
            )
            const overdue = days < 0
            const soon = days >= 0 && days <= 5
            return (
              <div
                key={r.id}
                className={`card ${flashId === r.id ? 'flash-ok' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl"
                    style={{ backgroundColor: (cat?.color ?? '#64748b') + '33' }}
                  >
                    {cat?.icon ?? '🔔'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 font-semibold text-slate-100">
                      {r.name}
                      {r.auto_post && <span title="Automático">🔁</span>}
                    </div>
                    <div className="text-sm text-slate-400">
                      {FREQ_LABEL[r.frequency]} ·{' '}
                      <span
                        className={
                          overdue
                            ? 'text-red-400'
                            : soon
                              ? 'text-amber-400'
                              : ''
                        }
                      >
                        {overdue
                          ? `Venció ${formatDate(r.next_due_date)}`
                          : days === 0
                            ? 'Vence hoy'
                            : `Vence ${formatDate(r.next_due_date)}`}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-bold text-slate-100">
                    {formatMoney(Number(r.amount), r.currency ?? 'ARS')}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => markPaid(r)}
                    disabled={payingId === r.id}
                    className="btn-primary flex-1 py-2 text-sm disabled:opacity-70"
                  >
                    {payingId === r.id ? 'Registrando…' : '✓ Pagado'}
                  </button>
                  <button
                    onClick={() => openEdit(r)}
                    className="btn-ghost px-3 py-2 text-sm"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => remove(r)}
                    className="btn-ghost px-3 py-2 text-sm"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Editar pago' : 'Nuevo pago'}
      >
        <div className="space-y-4">
          <div>
            <label className="label">Nombre</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Alquiler, Netflix, Luz"
            />
          </div>
          <div>
            <label className="label">Monto</label>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </div>
          <div>
            <label className="label">Categoría</label>
            <select
              className="input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </div>
          {accounts.length > 0 && (
            <div>
              <label className="label">Cuenta / medio de pago</label>
              <select
                className="input"
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value)
                  // La moneda vuelve a la de la cuenta elegida.
                  setCurrency(accountsById[e.target.value]?.currency ?? 'ARS')
                }}
              >
                <option value="">Sin cuenta</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.icon} {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Una tarjeta en pesos también tiene suscripciones en dólares. */}
          {accountsById[accountId]?.type === 'card' && (
            <div>
              <label className="label">Moneda del pago</label>
              <div className="grid grid-cols-2 gap-2">
                {cardCurrencies(accountsById[accountId].currency).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCurrency(c)}
                    className={`btn py-2 text-sm ${
                      currency === c
                        ? 'bg-brand text-white'
                        : 'bg-slate-700/60 text-slate-300'
                    }`}
                  >
                    {currencyLabel(c)}
                  </button>
                ))}
              </div>
              {currency !== accountsById[accountId].currency && (
                <p className="mt-1 text-xs text-slate-500">
                  Cada vencimiento va al subtotal en {currency} del resumen, que
                  después podés pagar en esa moneda.
                </p>
              )}
            </div>
          )}
          <div>
            <label className="label">Frecuencia</label>
            <select
              className="input"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
            >
              {(Object.keys(FREQ_LABEL) as Frequency[]).map((f) => (
                <option key={f} value={f}>
                  {FREQ_LABEL[f]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Próximo vencimiento</label>
            <input
              className="input"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={autoPost}
              onChange={(e) => setAutoPost(e.target.checked)}
              className="h-5 w-5 rounded accent-brand"
            />
            <span className="text-sm text-slate-300">
              Cargar automáticamente al vencer (gasto fijo)
            </span>
          </label>
          <button
            onClick={save}
            disabled={saving || !name.trim() || !amount}
            className="btn-primary w-full disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
