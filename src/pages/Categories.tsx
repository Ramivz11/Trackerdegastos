import { useState } from 'react'
import Modal from '../components/Modal'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { createCategory, deleteCategory, updateCategory } from '../lib/api'
import { formatMoney } from '../lib/format'
import type { Category } from '../types'

const COLORS = [
  '#6366f1', '#f97316', '#22c55e', '#3b82f6', '#eab308',
  '#ef4444', '#a855f7', '#14b8a6', '#ec4899', '#64748b',
]
const ICONS = ['💸', '🍔', '🛒', '🚌', '💡', '💊', '🎉', '🏠', '👕', '📚', '🎮', '✈️', '🐶', '☕', '⛽']

export default function Categories() {
  const { categories, reloadCategories, loadingCategories } = useData()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)

  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [icon, setIcon] = useState(ICONS[0])
  const [budget, setBudget] = useState('')
  const [favorite, setFavorite] = useState(false)
  const [saving, setSaving] = useState(false)

  function openNew() {
    setEditing(null)
    setName('')
    setColor(COLORS[0])
    setIcon(ICONS[0])
    setBudget('')
    setFavorite(false)
    setOpen(true)
  }

  function openEdit(c: Category) {
    setEditing(c)
    setName(c.name)
    setColor(c.color)
    setIcon(c.icon)
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
        monthly_budget: budget ? parseFloat(budget) : null,
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

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Categorías</h1>
        <button onClick={openNew} className="btn-primary px-3 py-2 text-sm">
          + Nueva
        </button>
      </header>

      {loadingCategories ? (
        <p className="text-slate-400">Cargando…</p>
      ) : (
        <div className="space-y-2">
          {categories.map((c) => (
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
                  {c.monthly_budget != null
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
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Editar categoría' : 'Nueva categoría'}
      >
        <div className="space-y-4">
          <div>
            <label className="label">Nombre</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Comida"
            />
          </div>

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
              Mostrar como acceso directo en gasto rápido
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
