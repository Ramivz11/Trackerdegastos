import { useCallback, useEffect, useMemo, useState } from 'react'
import Modal from '../components/Modal'
import QuickAdd from '../components/QuickAdd'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import {
  createTransaction,
  deleteTransaction,
  fetchTransactionsByMonth,
  updateTransaction,
} from '../lib/api'
import {
  currentMonth,
  formatDate,
  formatMoney,
  formatMonth,
  rateFor,
  toArs,
  todayISO,
} from '../lib/format'
import type { Currency, TransactionType, TransactionWithCategory } from '../types'

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Transactions() {
  const { categories, categoriesById, accounts, accountsById } = useData()
  const { user } = useAuth()
  const [month, setMonth] = useState(currentMonth())
  const [items, setItems] = useState<TransactionWithCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCat, setFilterCat] = useState<string>('all')
  const [filterType, setFilterType] = useState<'all' | TransactionType>('all')
  const [filterAccount, setFilterAccount] = useState<string>('all')
  const [search, setSearch] = useState('')

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<TransactionWithCategory | null>(null)
  const [type, setType] = useState<TransactionType>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await fetchTransactionsByMonth(month))
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((t) => {
      if (filterType !== 'all' && t.type !== filterType) return false
      if (filterCat !== 'all' && t.category_id !== filterCat) return false
      if (filterAccount !== 'all' && t.account_id !== filterAccount) return false
      if (q) {
        const cat = t.category_id ? categoriesById[t.category_id] : null
        const hay = `${t.description ?? ''} ${cat?.name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, filterType, filterCat, filterAccount, search, categoriesById])

  // En el modal solo se ofrecen categorías que coincidan con el tipo elegido.
  const modalCats = useMemo(
    () =>
      type === 'income'
        ? categories.filter((c) => c.kind === 'income')
        : categories.filter((c) => c.kind !== 'income'),
    [categories, type],
  )

  function changeType(next: TransactionType) {
    setType(next)
    // Si la categoría actual no pertenece al nuevo tipo, la limpiamos.
    const pool =
      next === 'income'
        ? categories.filter((c) => c.kind === 'income')
        : categories.filter((c) => c.kind !== 'income')
    if (!pool.some((c) => c.id === categoryId)) {
      setCategoryId(pool[0]?.id ?? '')
    }
  }

  const totals = useMemo(() => {
    let expense = 0
    let income = 0
    for (const t of filtered) {
      const ars = toArs(Number(t.amount), t.currency, t.ars_rate)
      if (t.type === 'expense') expense += ars
      else income += ars
    }
    return { expense, income }
  }, [filtered])

  function openNew() {
    setEditing(null)
    setType('expense')
    setAmount('')
    setCategoryId(categories.find((c) => c.kind !== 'income')?.id ?? '')
    setAccountId(accounts[0]?.id ?? '')
    setDate(todayISO())
    setDescription('')
    setOpen(true)
  }

  function openEdit(t: TransactionWithCategory) {
    setEditing(t)
    setType(t.type)
    setAmount(String(t.amount))
    setCategoryId(t.category_id ?? '')
    setAccountId(t.account_id ?? '')
    setDate(t.transaction_date)
    setDescription(t.description ?? '')
    setOpen(true)
  }

  async function save() {
    if (!user) return
    const value = parseFloat(amount)
    if (isNaN(value) || value <= 0) return
    setSaving(true)
    try {
      const currency: Currency = accountsById[accountId]?.currency ?? 'ARS'
      const payload = {
        category_id: categoryId || null,
        account_id: accountId || null,
        amount: value,
        currency,
        ars_rate: rateFor(currency),
        description: description.trim() || null,
        transaction_date: date,
        type,
      }
      if (editing) await updateTransaction(editing.id, payload)
      else await createTransaction(payload, user.id)
      setOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function remove(t: TransactionWithCategory) {
    if (!confirm('¿Eliminar este movimiento?')) return
    await deleteTransaction(t.id)
    await load()
  }

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Movimientos</h1>
        <button onClick={openNew} className="btn-primary px-3 py-2 text-sm">
          + Agregar
        </button>
      </header>

      {/* Selector de mes */}
      <div className="mb-4 flex items-center justify-between rounded-xl bg-slate-800/60 p-2">
        <button
          onClick={() => setMonth(shiftMonth(month, -1))}
          className="rounded-lg px-3 py-1 text-lg text-slate-300"
        >
          ‹
        </button>
        <span className="font-semibold capitalize text-slate-100">
          {formatMonth(month)}
        </span>
        <button
          onClick={() => setMonth(shiftMonth(month, 1))}
          className="rounded-lg px-3 py-1 text-lg text-slate-300"
        >
          ›
        </button>
      </div>

      {/* Totales */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="card">
          <div className="text-xs text-slate-400">Gastos</div>
          <div className="text-lg font-bold text-red-400">
            {formatMoney(totals.expense)}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-400">Ingresos</div>
          <div className="text-lg font-bold text-emerald-400">
            {formatMoney(totals.income)}
          </div>
        </div>
      </div>

      {/* Buscador */}
      <input
        className="input mb-3"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="🔍 Buscar por nota o categoría"
      />

      {/* Filtro por tipo */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        {(
          [
            ['all', 'Todos'],
            ['expense', 'Egresos'],
            ['income', 'Ingresos'],
          ] as [typeof filterType, string][]
        ).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFilterType(val)}
            className={`btn py-2 text-sm ${
              filterType === val
                ? val === 'expense'
                  ? 'bg-red-500/80 text-white'
                  : val === 'income'
                    ? 'bg-emerald-500/80 text-white'
                    : 'bg-brand text-white'
                : 'bg-slate-700/60 text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filtros por categoría y cuenta */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <select
          className="input"
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
        >
          <option value="all">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={filterAccount}
          onChange={(e) => setFilterAccount(e.target.value)}
        >
          <option value="all">Todas las cuentas</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.icon} {a.name}
            </option>
          ))}
        </select>
      </div>

      {/* Lista */}
      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-slate-500">
          No hay movimientos este mes.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const cat = t.category_id ? categoriesById[t.category_id] : null
            const acc = t.account_id ? accountsById[t.account_id] : null
            return (
              <button
                key={t.id}
                onClick={() => openEdit(t)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  remove(t)
                }}
                className="card flex w-full items-center gap-3 text-left"
              >
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl"
                  style={{ backgroundColor: (cat?.color ?? '#64748b') + '33' }}
                >
                  {cat?.icon ?? '❓'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-slate-100">
                    {t.description || cat?.name || 'Sin categoría'}
                  </div>
                  <div className="truncate text-sm text-slate-400">
                    {formatDate(t.transaction_date)}
                    {cat && t.description ? ` · ${cat.name}` : ''}
                    {acc ? ` · ${acc.icon} ${acc.name}` : ''}
                  </div>
                </div>
                <div
                  className={`shrink-0 font-bold ${
                    t.type === 'expense' ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >
                  {t.type === 'expense' ? '-' : '+'}
                  {formatMoney(Number(t.amount), t.currency)}
                </div>
              </button>
            )
          })}
          <p className="pt-2 text-center text-xs text-slate-500">
            Tocá para editar · mantené presionado / clic derecho para borrar
          </p>
        </div>
      )}

      <QuickAdd onSaved={load} />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Editar movimiento' : 'Nuevo movimiento'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => changeType('expense')}
              className={`btn ${type === 'expense' ? 'bg-red-500/80 text-white' : 'bg-slate-700/60 text-slate-300'}`}
            >
              Gasto
            </button>
            <button
              type="button"
              onClick={() => changeType('income')}
              className={`btn ${type === 'income' ? 'bg-emerald-500/80 text-white' : 'bg-slate-700/60 text-slate-300'}`}
            >
              Ingreso
            </button>
          </div>

          <div>
            <label className="label">Monto</label>
            <input
              className="input text-2xl font-bold"
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
              {modalCats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </div>

          {accounts.length > 0 && (
            <div>
              <label className="label">
                {type === 'income' ? 'Cuenta que recibe' : 'Cuenta / medio de pago'}
              </label>
              <select
                className="input"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
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

          <div>
            <label className="label">Fecha</label>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Nota (opcional)</label>
            <input
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej: Cena con amigos"
            />
          </div>

          <div className="flex gap-2">
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  remove(editing)
                }}
                className="btn bg-red-500/20 text-red-400"
              >
                Borrar
              </button>
            )}
            <button
              onClick={save}
              disabled={saving || !amount}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
