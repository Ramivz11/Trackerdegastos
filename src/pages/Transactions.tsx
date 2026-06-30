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
import { currentMonth, formatDate, formatMoney, formatMonth, todayISO } from '../lib/format'
import type { TransactionType, TransactionWithCategory } from '../types'

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Transactions() {
  const { categories, categoriesById } = useData()
  const { user } = useAuth()
  const [month, setMonth] = useState(currentMonth())
  const [items, setItems] = useState<TransactionWithCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCat, setFilterCat] = useState<string>('all')

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<TransactionWithCategory | null>(null)
  const [type, setType] = useState<TransactionType>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
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

  const filtered = useMemo(
    () =>
      filterCat === 'all'
        ? items
        : items.filter((t) => t.category_id === filterCat),
    [items, filterCat],
  )

  const totals = useMemo(() => {
    let expense = 0
    let income = 0
    for (const t of filtered) {
      if (t.type === 'expense') expense += Number(t.amount)
      else income += Number(t.amount)
    }
    return { expense, income }
  }, [filtered])

  function openNew() {
    setEditing(null)
    setType('expense')
    setAmount('')
    setCategoryId(categories[0]?.id ?? '')
    setDate(todayISO())
    setDescription('')
    setOpen(true)
  }

  function openEdit(t: TransactionWithCategory) {
    setEditing(t)
    setType(t.type)
    setAmount(String(t.amount))
    setCategoryId(t.category_id ?? '')
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
      const payload = {
        category_id: categoryId || null,
        amount: value,
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
        <h1 className="text-2xl font-bold text-white">Gastos</h1>
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

      {/* Filtro por categoría */}
      <select
        className="input mb-4"
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
                  <div className="text-sm text-slate-400">
                    {formatDate(t.transaction_date)}
                    {cat && t.description ? ` · ${cat.name}` : ''}
                  </div>
                </div>
                <div
                  className={`shrink-0 font-bold ${
                    t.type === 'expense' ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >
                  {t.type === 'expense' ? '-' : '+'}
                  {formatMoney(Number(t.amount))}
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
              onClick={() => setType('expense')}
              className={`btn ${type === 'expense' ? 'bg-red-500/80 text-white' : 'bg-slate-700/60 text-slate-300'}`}
            >
              Gasto
            </button>
            <button
              type="button"
              onClick={() => setType('income')}
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
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </div>

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
