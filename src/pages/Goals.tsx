import { useCallback, useEffect, useState } from 'react'
import Modal from '../components/Modal'
import IconColorPicker from '../components/IconColorPicker'
import { useAuth } from '../context/AuthContext'
import { createGoal, deleteGoal, fetchGoals, updateGoal } from '../lib/api'
import { formatDate, formatMoney } from '../lib/format'
import type { Currency, Goal } from '../types'

const GOAL_ICONS = ['🎯', '✈️', '🚗', '🏠', '💻', '📱', '🎓', '💍', '🏖️', '🎸', '🚑', '🐖']

export default function Goals() {
  const { user } = useAuth()
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setGoals(await fetchGoals())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Goal | null>(null)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState(GOAL_ICONS[0])
  const [color, setColor] = useState('#6366f1')
  const [target, setTarget] = useState('')
  const [saved, setSaved] = useState('')
  const [currency, setCur] = useState<Currency>('ARS')
  const [targetDate, setTargetDate] = useState('')
  const [saving, setSaving] = useState(false)

  // Aporte rápido
  const [contribFor, setContribFor] = useState<Goal | null>(null)
  const [contrib, setContrib] = useState('')

  function openNew() {
    setEditing(null)
    setName('')
    setIcon(GOAL_ICONS[0])
    setColor('#6366f1')
    setTarget('')
    setSaved('')
    setCur('ARS')
    setTargetDate('')
    setOpen(true)
  }

  function openEdit(g: Goal) {
    setEditing(g)
    setName(g.name)
    setIcon(g.icon)
    setColor(g.color)
    setTarget(String(g.target_amount))
    setSaved(String(g.saved_amount))
    setCur(g.currency)
    setTargetDate(g.target_date ?? '')
    setOpen(true)
  }

  async function save() {
    if (!user || !name.trim()) return
    const t = parseFloat(target)
    if (isNaN(t) || t <= 0) return
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        icon,
        color,
        target_amount: t,
        saved_amount: saved ? parseFloat(saved) : 0,
        currency,
        target_date: targetDate || null,
      }
      if (editing) await updateGoal(editing.id, payload)
      else await createGoal(payload, user.id)
      setOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function remove(g: Goal) {
    if (!confirm(`¿Eliminar la meta "${g.name}"?`)) return
    await deleteGoal(g.id)
    await load()
  }

  async function addContribution() {
    if (!contribFor) return
    const amt = parseFloat(contrib)
    if (isNaN(amt) || amt === 0) return
    const next = Math.max(0, Number(contribFor.saved_amount) + amt)
    await updateGoal(contribFor.id, { saved_amount: next })
    setContribFor(null)
    setContrib('')
    await load()
  }

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Metas de ahorro</h1>
        <button onClick={openNew} className="btn-primary px-3 py-2 text-sm">
          + Nueva
        </button>
      </header>

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : goals.length === 0 ? (
        <p className="py-8 text-center text-slate-500">
          No tenés metas todavía. Creá una con “+ Nueva” (ej: juntar para un viaje).
        </p>
      ) : (
        <div className="space-y-3">
          {goals.map((g) => {
            const savedN = Number(g.saved_amount)
            const targetN = Number(g.target_amount)
            const ratio = targetN > 0 ? savedN / targetN : 0
            const done = ratio >= 1
            const remaining = Math.max(0, targetN - savedN)
            return (
              <div key={g.id} className="card">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl"
                    style={{ backgroundColor: g.color + '33' }}
                  >
                    {g.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 font-semibold text-slate-100">
                      {g.name}
                      {done && <span title="Cumplida">🎉</span>}
                    </div>
                    <div className="text-xs text-slate-400">
                      {formatMoney(savedN, g.currency)} de{' '}
                      {formatMoney(targetN, g.currency)}
                      {g.target_date ? ` · para ${formatDate(g.target_date)}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => openEdit(g)}
                    className="rounded-lg px-1 py-1 text-slate-400 hover:text-slate-100"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => remove(g)}
                    className="rounded-lg px-1 py-1 text-slate-400 hover:text-red-400"
                  >
                    🗑️
                  </button>
                </div>

                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(ratio * 100, 100)}%`,
                      backgroundColor: done ? '#22c55e' : g.color,
                    }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-slate-400">
                    {done
                      ? '¡Meta cumplida!'
                      : `Te falta ${formatMoney(remaining, g.currency)} (${Math.round(
                          ratio * 100,
                        )}%)`}
                  </span>
                  <button
                    onClick={() => {
                      setContribFor(g)
                      setContrib('')
                    }}
                    className="text-xs font-medium text-brand"
                  >
                    + Aporte
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal crear/editar meta */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Editar meta' : 'Nueva meta'}
      >
        <div className="space-y-4">
          <div>
            <label className="label">Nombre</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Viaje a Brasil"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Objetivo</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <label className="label">Ya ahorrado</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={saved}
                onChange={(e) => setSaved(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div>
            <label className="label">Moneda</label>
            <div className="grid grid-cols-2 gap-2">
              {(['ARS', 'USD'] as Currency[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCur(c)}
                  className={`btn py-2 text-sm ${
                    currency === c ? 'bg-brand text-white' : 'bg-slate-700/60 text-slate-300'
                  }`}
                >
                  {c === 'ARS' ? 'Pesos (ARS)' : 'Dólares (USD)'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Fecha límite (opcional)</label>
            <input
              className="input"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </div>

          <IconColorPicker
            icon={icon}
            color={color}
            onIcon={setIcon}
            onColor={setColor}
            icons={GOAL_ICONS}
          />

          <button
            onClick={save}
            disabled={saving || !name.trim() || !target}
            className="btn-primary w-full disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </Modal>

      {/* Modal aporte */}
      <Modal
        open={!!contribFor}
        onClose={() => setContribFor(null)}
        title={contribFor ? `Aporte a ${contribFor.name}` : 'Aporte'}
      >
        <div className="space-y-4">
          <div>
            <label className="label">
              Monto {contribFor ? `(${contribFor.currency})` : ''}
            </label>
            <input
              className="input text-2xl font-bold"
              type="number"
              inputMode="decimal"
              value={contrib}
              onChange={(e) => setContrib(e.target.value)}
              placeholder="0"
              autoFocus
            />
            <p className="mt-1 text-xs text-slate-500">
              Podés poner un número negativo para restar un retiro.
            </p>
          </div>
          <button
            onClick={addContribution}
            disabled={!contrib}
            className="btn-primary w-full disabled:opacity-50"
          >
            Sumar al ahorro
          </button>
        </div>
      </Modal>
    </div>
  )
}
