import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Modal from '../components/Modal'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import {
  createReimbursement,
  deleteReimbursement,
  fetchReceivables,
  writeOffReceivable,
} from '../lib/api'
import { formatDate, formatMoney, toArs, todayISO } from '../lib/format'
import type { Receivable } from '../types'

/**
 * "Te deben": los gastos que pagaste vos y de los que esperás recuperar una
 * parte. Cobrar suma la plata a la cuenta sin contarla como ingreso, porque
 * el gasto ya se registró neto cuando lo cargaste.
 */
export default function Debts() {
  const { user } = useAuth()
  const { accounts, categoriesById } = useData()
  const [items, setItems] = useState<Receivable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showSettled, setShowSettled] = useState(false)

  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<Receivable | null>(null)
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItems(await fetchReceivables(!showSettled))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [showSettled])

  useEffect(() => {
    void load()
  }, [load])

  const totalPendiente = useMemo(
    () =>
      items.reduce(
        (s, r) => s + toArs(r.pending, r.transaction.currency, r.transaction.ars_rate),
        0,
      ),
    [items],
  )

  function openCobro(r: Receivable) {
    setTarget(r)
    setAmount(String(r.pending))
    setAccountId(r.transaction.account_id ?? accounts[0]?.id ?? '')
    setDate(todayISO())
    setNote('')
    setOpen(true)
  }

  async function cobrar() {
    if (!user || !target) return
    const value = parseFloat(amount)
    if (isNaN(value) || value <= 0) return
    setSaving(true)
    try {
      await createReimbursement(
        {
          transaction_id: target.transaction.id,
          // No dejamos cobrar más de lo que falta.
          amount: Math.min(value, target.pending),
          account_id: accountId || null,
          received_date: date,
          note: note.trim() || null,
        },
        user.id,
      )
      setOpen(false)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function darPorPerdido(r: Receivable) {
    const falta = formatMoney(r.pending, r.transaction.currency)
    if (
      !confirm(
        `¿Dar por perdidos ${falta}? El gasto pasa a contar entero como tuyo ` +
          'y sube en los reportes de ese mes.',
      )
    )
      return
    await writeOffReceivable(r)
    await load()
  }

  async function borrarCobro(id: string) {
    if (!confirm('¿Borrar este cobro?')) return
    await deleteReimbursement(id)
    await load()
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-white">Te deben</h1>
      <p className="mb-4 text-sm text-slate-400">
        Gastos que pagaste vos y te van a devolver. Los reportes ya cuentan solo
        tu parte; acá seguís la plata que falta que vuelva.
      </p>

      {error && (
        <div className="card mb-4 border border-amber-500/30">
          <p className="text-sm text-amber-400">No se pudo cargar.</p>
          <p className="mt-1 text-xs text-slate-400">
            Si es la primera vez, volvé a correr <code>supabase/schema.sql</code>{' '}
            para crear la tabla de cobros.
          </p>
          <p className="mt-2 text-xs text-slate-600">{error}</p>
        </div>
      )}

      {totalPendiente > 0 && (
        <div className="card mb-4 bg-gradient-to-br from-emerald-600 to-emerald-800">
          <div className="text-sm text-white/80">Total a cobrar</div>
          <div className="text-3xl font-bold text-white">
            {formatMoney(totalPendiente)}
          </div>
        </div>
      )}

      <button
        onClick={() => setShowSettled((s) => !s)}
        className="btn-ghost mb-4 w-full py-2 text-sm"
      >
        {showSettled ? 'Ver solo lo pendiente' : 'Ver también lo ya cobrado'}
      </button>

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : items.length === 0 ? (
        <div className="card text-center">
          <p className="text-slate-400">
            {showSettled
              ? 'No hay gastos compartidos todavía.'
              : 'No te deben nada. 🎉'}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Al cargar un gasto, completá “Me deben” con la parte que te van a
            devolver y aparece acá.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((r) => {
            const t = r.transaction
            const cat = t.category_id ? categoriesById[t.category_id] : null
            const saldado = r.pending <= 0.009
            const pct = r.expected > 0 ? (r.collected / r.expected) * 100 : 0
            return (
              <div key={t.id} className="card">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg"
                    style={{ backgroundColor: (cat?.color ?? '#64748b') + '33' }}
                  >
                    {cat?.icon ?? '🤝'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-100">
                      {t.description || cat?.name || 'Gasto compartido'}
                    </div>
                    <div className="truncate text-xs text-slate-400">
                      {formatDate(t.transaction_date, "d 'de' MMM yyyy")} ·
                      pagaste {formatMoney(Number(t.amount), t.currency)}
                      {t.reimbursable_note ? ` · ${t.reimbursable_note}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div
                      className={`font-bold ${
                        saldado ? 'text-slate-400' : 'text-emerald-400'
                      }`}
                    >
                      {saldado
                        ? 'Saldado'
                        : formatMoney(r.pending, t.currency)}
                    </div>
                    {r.collected > 0 && !saldado && (
                      <div className="text-xs text-slate-500">
                        de {formatMoney(r.expected, t.currency)}
                      </div>
                    )}
                  </div>
                </div>

                {r.collected > 0 && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-700">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                )}

                {r.payments.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-white/5 pt-2">
                    {r.payments.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between text-xs text-slate-400"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          Cobrado {formatDate(p.received_date)}
                          {p.note ? ` · ${p.note}` : ''}
                        </span>
                        <span className="mx-2 shrink-0 text-emerald-400">
                          +{formatMoney(Number(p.amount), t.currency)}
                        </span>
                        <button
                          onClick={() => borrarCobro(p.id)}
                          className="shrink-0 text-red-400"
                          aria-label="Borrar cobro"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {!saldado && (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => darPorPerdido(r)}
                      className="btn flex-1 bg-slate-700/60 py-2 text-sm text-slate-300"
                    >
                      Dar por perdido
                    </button>
                    <button
                      onClick={() => openCobro(r)}
                      className="btn-primary flex-1 py-2 text-sm"
                    >
                      Cobré
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Link to="/" className="mt-6 block text-center text-sm text-slate-500">
        ‹ Volver al inicio
      </Link>

      <Modal open={open} onClose={() => setOpen(false)} title="Registrar cobro">
        {target && (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              Te faltaban cobrar{' '}
              <span className="font-semibold text-slate-200">
                {formatMoney(target.pending, target.transaction.currency)}
              </span>{' '}
              de {target.transaction.description || 'este gasto'}.
            </p>

            <div>
              <label className="label">Cuánto te dieron</label>
              <input
                className="input text-2xl font-bold"
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
            </div>

            {accounts.length > 0 && (
              <div>
                <label className="label">¿Dónde entró la plata?</label>
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
                <p className="mt-1 text-xs text-slate-500">
                  Suma al saldo de esa cuenta, pero no cuenta como ingreso.
                </p>
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
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ej: me transfirió Juan"
              />
            </div>

            <button
              onClick={cobrar}
              disabled={saving || !amount}
              className="btn-primary w-full disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Registrar cobro'}
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
