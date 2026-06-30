import { useState } from 'react'
import Modal from '../components/Modal'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { createCategory, deleteCategory, updateCategory } from '../lib/api'
import { formatMoney } from '../lib/format'
import type { Category, CategoryKind } from '../types'

const COLORS = [
  '#6366f1', '#f97316', '#22c55e', '#3b82f6', '#eab308',
  '#ef4444', '#a855f7', '#14b8a6', '#ec4899', '#64748b',
]
const ICONS = ['💸', '🍔', '🛒', '🚌', '💡', '💊', '🎉', '🏠', '👕', '📚', '🎮', '✈️', '🐶', '☕', '⛽', '💰', '🥇', '🤖', '💵', '💳', '🏦', '📈']

export default function Categories() {
  const { categories, reloadCategories, loadingCategories } = useData()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)

  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [icon, setIcon] = useState(ICONS[0])
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [budget, setBudget] = useState('')
  const [favorite, setFavorite] = useState(false)
  const [saving, setSaving] = useState(false)

  const expenseCats = categories.filter((c) => c.kind !== 'income')
  const incomeCats = categories.filter((c) => c.kind === 'income')

  function openNew(forKind: CategoryKind = 'expense') {
    setEditing(null)
    setName('')
    setColor(COLORS[0])
    setIcon(ICONS[0])
    setKind(forKind)
    setBudget('')
    setFavorite(false)
    setOpen(true)
  }

  function openEdit(c: Category) {
    setEditing(c)
    setName(c.name)
    setColor(c.color)
    setIcon(c.icon)
    setKind(c.kind)
    setBudget(c.monthly_budget != null ? String(c.monthly_budget) : '')
    setFavorite(c.is_favorite)
    setOpen(true)
  }

  async function save() {
    if (!user || !name.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        color,
        icon,
        kind,
        // El presupuesto solo aplica a gastos.
        monthly_budget: kind === 'income' ? null : budget ? parseFloat(budget) : null,
        is_favorite: favorite,
      }
      if (editing) {
        await updateCategory(editing.id, payload)
      } else {
        await createCategory(payload, user.id)
      }
      await reloadCategories()
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function remove(c: Category) {
    if (!confirm(`¿Eliminar la categoría "${c.name}"? Los gastos quedarán sin categoría.`))
      return
    await deleteCategory(c.id)
    await reloadCategories()
  }

  function renderCard(c: Category) {
    return (
      <div key={c.id} className="card flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl"
          style={{ backgroundColor: c.color + '33' }}
        >
          {c.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 font-semibold text-slate-100">
            {c.name}
            {c.is_favorite && <span title="Favorita">⭐</span>}
          </div>
          <div className="text-sm text-slate-400">
            {c.kind === 'income'
              ? 'Ingreso'
              : c.monthly_budget != null
                ? `Presupuesto: ${formatMoney(c.monthly_budget)}`
                : 'Sin presupuesto'}
          </div>
        </div>
        <button
          onClick={() => openEdit(c)}
          className="rounded-lg px-2 py-1 text-slate-400 hover:text-slate-100"
        >
          ✏️
        </button>
        <button
          onClick={() => remove(c)}
          className="rounded-lg px-2 py-1 text-slate-400 hover:text-red-400"
        >
          🗑️
        </button>
      </div>
    )
  }

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Categorías</h1>
        <button onClick={() => openNew('expense')} className="btn-primary px-3 py-2 text-sm">
          + Nueva
        </button>
      </header>

      {loadingCategories ? (
        <p className="text-slate-400">Cargando…</p>
      ) : (
        <div className="space-y-6">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-300">💸 Gastos</h2>
              <button
                onClick={() => openNew('expense')}
                className="text-xs font-medium text-brand"
              >
                + Agregar
              </button>
            </div>
            <div className="space-y-2">
              {expenseCats.length === 0 ? (
                <p className="card text-sm text-slate-500">Sin categorías de gasto.</p>
              ) : (
                expenseCats.map(renderCard)
              )}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-300">💰 Ingresos</h2>
              <button
                onClick={() => openNew('income')}
                className="text-xs font-medium text-brand"
              >
                + Agregar
              </button>
            </div>
            <div className="space-y-2">
              {incomeCats.length === 0 ? (
                <p className="card text-sm text-slate-500">Sin categorías de ingreso.</p>
              ) : (
                incomeCats.map(renderCard)
              )}
            </div>
          </section>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Editar categoría' : 'Nueva categoría'}
      >
        <div className="space-y-4">
          <div>
            <label className="label">Tipo</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind('expense')}
                className={`btn ${kind === 'expense' ? 'bg-red-500/80 text-white' : 'bg-slate-700/60 text-slate-300'}`}
              >
                Gasto
              </button>
              <button
                type="button"
                onClick={() => setKind('income')}
                className={`btn ${kind === 'income' ? 'bg-emerald-500/80 text-white' : 'bg-slate-700/60 text-slate-300'}`}
              >
                Ingreso
              </button>
            </div>
          </div>

          <div>
            <label className="label">Nombre</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === 'income' ? 'Ej: Sueldo' : 'Ej: Comida'}
            />
          </div>

          {kind === 'expense' && (
            <div>
              <label className="label">Presupuesto mensual (opcional)</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="Ej: 50000"
              />
            </div>
          )}

          <div>
            <label className="label">Ícono</label>
            <div className="flex flex-wrap gap-2">
              {ICONS.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIcon(i)}
                  className={`flex h-10 w-10 items-center justify-center rounded-lg text-xl ${
                    icon === i ? 'ring-2 ring-brand' : 'bg-slate-800'
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Color</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-9 w-9 rounded-full ${
                    color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : ''
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={favorite}
              onChange={(e) => setFavorite(e.target.checked)}
              className="h-5 w-5 rounded accent-brand"
            />
            <span className="text-sm text-slate-300">
              Mostrar como acceso directo en carga rápida
            </span>
          </label>

          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="btn-primary w-full disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
