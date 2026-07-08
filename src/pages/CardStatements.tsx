import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Modal from '../components/Modal'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import {
  createStatementPayment,
  deleteStatementPayment,
  fetchStatementPayments,
  fetchTransactionsByAccount,
} from '../lib/api'
import { formatMoney, todayISO } from '../lib/format'
import { buildStatements, formatShort, type Statement } from '../lib/statements'
import type { StatementPayment, TransactionWithCategory } from '../types'

export default function CardStatements() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { accounts, categoriesById } = useData()
  const card = accounts.find((a) => a.id === id) ?? null

  const [txs, setTxs] = useState<TransactionWithCategory[]>([])
  const [payments, setPayments] = useState<StatementPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!card) return
    setLoading(true)
    try {
      const [t, p] = await Promise.all([
        fetchTransactionsByAccount(card.id),
        fetchStatementPayments(card.id),
      ])
      setTxs(t)
      setPayments(p)
    } finally {
      setLoading(false)
    }
  }, [card])

  useEffect(() => {
    void load()
  }, [load])

  const statements = useMemo(
    () => (card ? buildStatements(card, txs, payments, todayISO()) : []),
    [card, txs, payments],
  )

  // ----- Modal: marcar resumen como pagado -----
  const [payOpen, setPayOpen] = useState(false)
  const [payTarget, setPayTarget] = useState<Statement | null>(null)
  const [fromId, setFromId] = useState('')
  const [payDate, setPayDate] = useState(todayISO())
  const [savingPay, setSavingPay] = useState(false)

  const payFromAccounts = useMemo(
    () => accounts.filter((a) => a.type !== 'card'),
    [accounts],
  )

  function openPay(st: Statement) {
    setPayTarget(st)
    setFromId(payFromAccounts[0]?.id ?? '')
    setPayDate(todayISO())
    setPayOpen(true)
  }

  async function savePay() {
    if (!user || !card || !payTarget) return
    setSavingPay(true)
    try {
      await createStatementPayment(
        {
          account_id: card.id,
          cycle_close: payTarget.closeISO,
          amount: payTarget.total,
          paid_from_account_id: fromId || null,
          paid_date: payDate,
        },
        user.id,
      )
      setPayOpen(false)
      await load()
    } finally {
      setSavingPay(false)
    }
  }

  async function undoPay(st: Statement) {
    if (!st.payment) return
    if (!confirm('¿Deshacer el pago de este resumen?')) return
    await deleteStatementPayment(st.payment.id)
    await load()
  }

  if (!card) {
    return (
      <div>
        <button onClick={() => navigate('/cuentas')} className="mb-4 text-brand">
          ‹ Volver
        </button>
        <p className="text-slate-400">Tarjeta no encontrada.</p>
      </div>
    )
  }

  return (
    <div>
      <header className="mb-4 flex items-center gap-2">
        <button
          onClick={() => navigate('/cuentas')}
          className="rounded-lg px-2 py-1 text-lg text-slate-300"
        >
          ‹
        </button>
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-lg"
          style={{ backgroundColor: card.color + '33' }}
        >
          {card.icon}
        </span>
        <h1 className="text-xl font-bold text-white">{card.name}</h1>
      </header>

      {card.closing_day && (
        <p className="mb-4 text-xs text-slate-400">
          Cierra el {card.closing_day} de cada mes
          {card.due_day ? ` · vence el ${card.due_day}` : ''}
        </p>
      )}

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : statements.length === 0 ? (
        <p className="py-8 text-center text-slate-500">
          Todavía no cargaste gastos a esta tarjeta.
        </p>
      ) : (
        <div className="space-y-3">
          {statements.map((st) => {
            const isExp = expanded === st.closeISO
            const payable = st.phase === 'closed'
            const title =
              st.phase === 'current'
                ? 'Ciclo actual'
                : st.phase === 'future'
                  ? `Próximo · cierra ${formatShort(st.closeISO)}`
                  : `Cierre ${formatShort(st.closeISO)}`
            return (
              <div key={st.closeISO} className="card">
                <button
                  type="button"
                  onClick={() => setExpanded(isExp ? null : st.closeISO)}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-semibold text-slate-100">
                      {title}
                      {st.phase === 'current' && (
                        <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-medium text-orange-300">
                          abierto
                        </span>
                      )}
                      {st.phase === 'future' && (
                        <span className="rounded-full bg-slate-500/20 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                          próximo
                        </span>
                      )}
                      {st.payment && (
                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                          pagado
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">
                      {st.items.length} {st.items.length === 1 ? 'gasto' : 'gastos'}
                      {st.phase !== 'current' && st.dueISO
                        ? ` · vence ${formatShort(st.dueISO)}`
                        : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-bold text-slate-100">
                      {formatMoney(st.total, card.currency)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {isExp ? 'ocultar ▲' : 'detalle ▼'}
                    </div>
                  </div>
                </button>

                {isExp && (
                  <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
                    {st.items.map((t) => {
                      const cat = t.category_id ? categoriesById[t.category_id] : null
                      return (
                        <div key={t.id} className="flex items-center gap-2 text-sm">
                          <span
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base"
                            style={{
                              backgroundColor: (cat?.color ?? '#64748b') + '33',
                            }}
                          >
                            {cat?.icon ?? '❓'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-slate-100">
                              {t.description || cat?.name || 'Sin categoría'}
                              {t.installment_total && t.installment_total > 1 && (
                                <span className="ml-1 text-xs text-slate-400">
                                  (cuota {t.installment_n}/{t.installment_total})
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500">
                              {formatShort(t.transaction_date)}
                            </div>
                          </div>
                          <div className="shrink-0 text-slate-200">
                            {formatMoney(Number(t.amount), card.currency)}
                          </div>
                        </div>
                      )
                    })}

                    {st.payment ? (
                      <button
                        onClick={() => undoPay(st)}
                        className="btn-ghost mt-2 w-full text-sm"
                      >
                        Deshacer pago
                      </button>
                    ) : (
                      payable && (
                        <button
                          onClick={() => openPay(st)}
                          className="btn-primary mt-2 w-full text-sm"
                        >
                          Marcar como pagado
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ----- Modal: marcar pagado ----- */}
      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Marcar resumen como pagado"
      >
        {payTarget && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-800/60 p-3 text-sm">
              <div className="text-slate-400">
                Resumen del {formatShort(payTarget.closeISO)}
              </div>
              <div className="text-2xl font-bold text-slate-100">
                {formatMoney(payTarget.total, card.currency)}
              </div>
            </div>

            <div>
              <label className="label">Pagar desde</label>
              <select
                className="input"
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
              >
                <option value="">Sin cuenta (solo marcar)</option>
                {payFromAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.icon} {a.name} ({a.currency})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Se descuenta este monto de la cuenta elegida.
              </p>
            </div>

            <div>
              <label className="label">Fecha de pago</label>
              <input
                className="input"
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
            </div>

            <button
              onClick={savePay}
              disabled={savingPay}
              className="btn-primary w-full disabled:opacity-50"
            >
              {savingPay ? 'Guardando…' : 'Confirmar pago'}
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
