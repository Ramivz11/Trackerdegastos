import { useState } from 'react'
import { Link } from 'react-router-dom'
import Modal from '../components/Modal'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import {
  applyRulesToExisting,
  createCategoryRule,
  deleteCategoryRule,
  updateCategoryRule,
} from '../lib/api'
import type { CategoryRule } from '../types'

/**
 * Reglas de auto-categorización: "si la nota dice Uber → Transporte".
 * Se aplican al cargar un movimiento (ver QuickAdd y Movimientos) y también
 * se pueden correr sobre lo ya cargado.
 */
export default function Rules() {
  const { user } = useAuth()
  const { categories, categoriesById, accounts, rules, reloadRules } = useData()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CategoryRule | null>(null)
  const [pattern, setPattern] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [priority, setPriority] = useState(0)
  const [saving, setSaving] = useState(false)
  const [applying, setApplying] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const expenseCats = categories.filter((c) => c.kind !== 'income')

  function openNew() {
    setEditing(null)
    setPattern('')
    setCategoryId(expenseCats[0]?.id ?? '')
    setAccountId('')
    setPriority(0)
    setOpen(true)
  }

  function openEdit(r: CategoryRule) {
    setEditing(r)
    setPattern(r.pattern)
    setCategoryId(r.category_id ?? '')
    setAccountId(r.account_id ?? '')
    setPriority(r.priority)
    setOpen(true)
  }

  async function save() {
    if (!user || !pattern.trim() || !categoryId) return
    setSaving(true)
    try {
      const payload = {
        pattern: pattern.trim(),
        category_id: categoryId,
        account_id: accountId || null,
        priority,
      }
      if (editing) await updateCategoryRule(editing.id, payload)
      else await createCategoryRule(payload, user.id)
      setOpen(false)
      await reloadRules()
    } finally {
      setSaving(false)
    }
  }

  async function remove(r: CategoryRule) {
    if (!confirm(`¿Borrar la regla "${r.pattern}"?`)) return
    await deleteCategoryRule(r.id)
    await reloadRules()
  }

  async function toggle(r: CategoryRule) {
    await updateCategoryRule(r.id, { is_active: !r.is_active })
    await reloadRules()
  }

  async function aplicarATodo() {
    if (
      !confirm(
        'Se van a recategorizar los movimientos que hoy no tienen categoría. ¿Seguir?',
      )
    )
      return
    setApplying(true)
    setMsg(null)
    try {
      const n = await applyRulesToExisting(rules, true)
      setMsg(
        n === 0
          ? 'No había movimientos sin categoría que coincidieran.'
          : `Se recategorizaron ${n} movimiento${n === 1 ? '' : 's'}.`,
      )
    } catch (e) {
      setMsg(`No se pudo aplicar: ${(e as Error).message}`)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div>
      <header className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Reglas</h1>
        <button onClick={openNew} className="btn-primary px-3 py-2 text-sm">
          + Nueva
        </button>
      </header>
      <p className="mb-4 text-sm text-slate-400">
        Si la nota de un gasto contiene el texto de la regla, se le asigna esa
        categoría sola.
      </p>

      {rules.length === 0 ? (
        <div className="card text-center">
          <p className="text-slate-400">Todavía no tenés reglas.</p>
          <p className="mt-2 text-xs text-slate-500">
            Ejemplo: texto “uber” → categoría Transporte. A partir de ahí,
            cualquier gasto con esa palabra en la nota se categoriza solo.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => {
            const cat = r.category_id ? categoriesById[r.category_id] : null
            return (
              <div key={r.id} className="card flex items-center gap-3">
                <button
                  onClick={() => toggle(r)}
                  aria-label={r.is_active ? 'Desactivar regla' : 'Activar regla'}
                  className={`h-6 w-11 shrink-0 rounded-full p-1 transition ${
                    r.is_active ? 'bg-emerald-500' : 'bg-slate-600'
                  }`}
                >
                  <span
                    className={`block h-4 w-4 rounded-full bg-white transition ${
                      r.is_active ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
                <button
                  onClick={() => openEdit(r)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate font-medium text-slate-100">
                    “{r.pattern}”
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    → {cat ? `${cat.icon} ${cat.name}` : 'categoría borrada'}
                    {r.priority !== 0 ? ` · prioridad ${r.priority}` : ''}
                  </div>
                </button>
                <button
                  onClick={() => remove(r)}
                  className="shrink-0 px-2 text-red-400"
                  aria-label="Borrar regla"
                >
                  ✕
                </button>
              </div>
            )
          })}

          <button
            onClick={aplicarATodo}
            disabled={applying}
            className="btn-ghost mt-4 w-full disabled:opacity-50"
          >
            {applying ? 'Aplicando…' : 'Aplicar a los movimientos sin categoría'}
          </button>
          {msg && <p className="pt-2 text-center text-sm text-slate-300">{msg}</p>}
        </div>
      )}

      <Link
        to="/ajustes"
        className="mt-6 block text-center text-sm text-slate-500"
      >
        ‹ Volver a Ajustes
      </Link>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Editar regla' : 'Nueva regla'}
      >
        <div className="space-y-4">
          <div>
            <label className="label">Si la nota contiene…</label>
            <input
              className="input"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="Ej: uber"
            />
            <p className="mt-1 text-xs text-slate-500">
              No distingue mayúsculas ni acentos de más: “Uber” y “uber” son lo
              mismo.
            </p>
          </div>

          <div>
            <label className="label">Asignar categoría</label>
            <select
              className="input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              {expenseCats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </div>

          {accounts.length > 0 && (
            <div>
              <label className="label">Sugerir cuenta (opcional)</label>
              <select
                className="input"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">No sugerir ninguna</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.icon} {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="label">Prioridad</label>
            <input
              className="input"
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) || 0)}
            />
            <p className="mt-1 text-xs text-slate-500">
              Si dos reglas coinciden, gana la de número más alto.
            </p>
          </div>

          <button
            onClick={save}
            disabled={saving || !pattern.trim() || !categoryId}
            className="btn-primary w-full disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
