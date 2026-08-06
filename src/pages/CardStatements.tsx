import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Modal from '../components/Modal'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import {
  createStatementPayment,
  deleteStatementPaymentsForCycle,
  fetchStatementPayments,
  fetchTransactionsByAccount,
  type StatementPaymentLine,
} from '../lib/api'
import { errorText, formatMoney, rateFor, todayISO } from '../lib/format'
import {
  buildStatements,
  formatShort,
  type CurrencyTotal,
  type Statement,
} from '../lib/statements'
import type { Currency, StatementPayment, TransactionWithCategory } from '../types'

/** "$ 500.000 + US$ 30" — los subtotales de un resumen en una sola línea. */
function formatTotals(totals: CurrencyTotal[]): string {
  if (totals.length === 0) return formatMoney(0, 'ARS')
  return totals.map((t) => formatMoney(t.amount, t.currency)).join(' + ')
}

/** Una línea del modal de pago, en texto (lo que se está tipeando). */
interface PayLine {
  key: string
  /** '' = sin cuenta: cubre el resumen pero no descuenta de ningún saldo. */
  accountId: string
  /** Lo que sale de la cuenta. */
  amount: string
  /** Lo que cubre del resumen. */
  applied: string
  appliedCurrency: Currency
}

let lineSeq = 0
function newKey() {
  return `l${lineSeq++}`
}

function num(v: string): number {
  const n = parseFloat(v)
  return isNaN(n) ? 0 : n
}

/** Convierte un monto entre monedas con las cotizaciones actuales de Ajustes. */
function convert(amount: number, from: Currency, to: Currency): number {
  if (from === to) return amount
  const value = (amount * rateFor(from)) / rateFor(to)
  return Math.round(value * 100) / 100
}

/** Igual que `convert` pero sobre el texto del input: vacío se queda vacío. */
function convertText(v: string, from: Currency, to: Currency): string {
  if (v.trim() === '') return ''
  return String(convert(num(v), from, to))
}

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

  const accountsById = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a])),
    [accounts],
  )

  // ----- Modal: registrar el pago del resumen -----
  const [payOpen, setPayOpen] = useState(false)
  const [payTarget, setPayTarget] = useState<Statement | null>(null)
  const [lines, setLines] = useState<PayLine[]>([])
  const [payDate, setPayDate] = useState(todayISO())
  const [savingPay, setSavingPay] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)

  const payFromAccounts = useMemo(
    () => accounts.filter((a) => a.type !== 'card'),
    [accounts],
  )

  /** Moneda de la que sale la plata en esta línea. */
  const lineCurrency = useCallback(
    (l: PayLine): Currency =>
      accountsById[l.accountId]?.currency ?? l.appliedCurrency,
    [accountsById],
  )

  function openPay(st: Statement) {
    setPayTarget(st)
    // Una línea por moneda del resumen, ya cargada con su subtotal y con la
    // primera cuenta que tengas en esa misma moneda.
    setLines(
      st.totals.map((t) => {
        const acc =
          payFromAccounts.find((a) => a.currency === t.currency) ?? payFromAccounts[0]
        const amount = acc ? convert(t.amount, t.currency, acc.currency) : t.amount
        return {
          key: newKey(),
          accountId: acc?.id ?? '',
          amount: String(amount),
          applied: String(t.amount),
          appliedCurrency: t.currency,
        }
      }),
    )
    setPayDate(todayISO())
    setPayError(null)
    setPayOpen(true)
  }

  function patchLine(key: string, patch: (l: PayLine) => PayLine) {
    setLines((prev) => prev.map((l) => (l.key === key ? patch(l) : l)))
  }

  /** Al cambiar la cuenta cambia la moneda de salida: se recalcula el otro monto. */
  function onAccountChange(key: string, accountId: string) {
    patchLine(key, (l) => {
      const to = accountsById[accountId]?.currency ?? l.appliedCurrency
      return {
        ...l,
        accountId,
        amount: convertText(l.applied, l.appliedCurrency, to),
      }
    })
  }

  function onAmountChange(key: string, v: string) {
    patchLine(key, (l) => {
      const from = lineCurrency(l)
      // Misma moneda: los dos montos son el mismo número, se espejan.
      if (from === l.appliedCurrency) return { ...l, amount: v, applied: v }
      return { ...l, amount: v, applied: convertText(v, from, l.appliedCurrency) }
    })
  }

  function onAppliedChange(key: string, v: string) {
    patchLine(key, (l) => {
      const from = lineCurrency(l)
      if (from === l.appliedCurrency) return { ...l, amount: v, applied: v }
      return { ...l, applied: v }
    })
  }

  function onAppliedCurrencyChange(key: string, currency: Currency) {
    patchLine(key, (l) => {
      const from = lineCurrency({ ...l, appliedCurrency: currency })
      return {
        ...l,
        appliedCurrency: currency,
        amount: convertText(l.applied, currency, from),
      }
    })
  }

  /** Cuánto quedó cubierto de cada moneda del resumen con lo que hay cargado. */
  const coverage = useMemo(() => {
    if (!payTarget) return []
    return payTarget.totals.map((t) => {
      const covered = lines
        .filter((l) => l.appliedCurrency === t.currency)
        .reduce((s, l) => s + num(l.applied), 0)
      return {
        currency: t.currency,
        total: t.amount,
        covered,
        missing: Math.round((t.amount - covered) * 100) / 100,
      }
    })
  }, [payTarget, lines])

  /**
   * Suma una cuenta más al pago, ya cargada con lo que todavía falta cubrir (o
   * vacía si con lo que hay ya se cubre todo).
   */
  function addLine() {
    const pending = coverage.find((c) => c.missing > 0.01)
    const currency = pending?.currency ?? payTarget?.totals[0]?.currency ?? 'ARS'
    const acc =
      payFromAccounts.find((a) => a.currency === currency) ?? payFromAccounts[0]
    const applied = pending ? String(pending.missing) : ''
    setLines((prev) => [
      ...prev,
      {
        key: newKey(),
        accountId: acc?.id ?? '',
        amount: convertText(applied, currency, acc?.currency ?? currency),
        applied,
        appliedCurrency: currency,
      },
    ])
  }

  // El monto es libre: podés pagar el mínimo, una parte o el total. Solo hace
  // falta que cada renglón tenga algo cargado.
  const usableLines = lines.filter((l) => num(l.applied) > 0 && num(l.amount) > 0)
  const canConfirm = usableLines.length > 0

  async function savePay() {
    if (!user || !card || !payTarget || !canConfirm) return
    setSavingPay(true)
    setPayError(null)
    try {
      const payload: StatementPaymentLine[] = usableLines.map((l) => ({
        paidFromAccountId: l.accountId || null,
        amount: num(l.amount),
        currency: lineCurrency(l),
        appliedAmount: num(l.applied),
        appliedCurrency: l.appliedCurrency,
      }))
      await createStatementPayment(
        {
          card: { id: card.id, name: card.name },
          cycleClose: payTarget.closeISO,
          paidDate: payDate,
          lines: payload,
        },
        user.id,
      )
      setPayOpen(false)
      await load()
    } catch (e) {
      // Sin esto el pago fallaba en silencio: el botón parecía no hacer nada.
      setPayError(errorText(e))
    } finally {
      setSavingPay(false)
    }
  }

  async function undoPay(st: Statement) {
    if (!card) return
    if (!confirm('¿Deshacer el pago de este resumen? Se borran sus movimientos.')) return
    try {
      await deleteStatementPaymentsForCycle(card.id, st.closeISO)
      await load()
    } catch (e) {
      alert(`No se pudo deshacer el pago: ${errorText(e)}`)
    }
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
            // Se puede pagar cualquier resumen, incluso el ciclo abierto (pago
            // adelantado), mientras no tenga ya un pago registrado.
            const payable = st.payments.length === 0
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
                      {st.isPaid && (
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
                      {formatTotals(st.totals)}
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
                            {formatMoney(Number(t.amount), t.currency)}
                          </div>
                        </div>
                      )
                    })}

                    {/* Subtotales, cuando el resumen tiene más de una moneda */}
                    {st.totals.length > 1 && (
                      <div className="mt-2 space-y-1 rounded-xl bg-slate-800/60 p-3 text-sm">
                        {st.totals.map((t) => (
                          <div key={t.currency} className="flex justify-between">
                            <span className="text-slate-400">
                              Subtotal en {t.currency}
                            </span>
                            <span className="font-semibold text-slate-100">
                              {formatMoney(t.amount, t.currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {st.payments.length > 0 ? (
                      <div className="mt-2 space-y-2">
                        <div className="rounded-xl bg-emerald-500/10 p-3 text-sm">
                          <div className="mb-1 text-xs font-medium text-emerald-300">
                            Pagado el {formatShort(st.payments[0].paid_date)}
                          </div>
                          {st.payments.map((p) => {
                            const from = p.paid_from_account_id
                              ? accountsById[p.paid_from_account_id]
                              : null
                            const cross = p.currency !== p.applied_currency
                            return (
                              <div
                                key={p.id}
                                className="flex items-center justify-between gap-2 py-0.5"
                              >
                                <span className="min-w-0 truncate text-slate-300">
                                  {from ? `${from.icon} ${from.name}` : 'Sin cuenta'}
                                </span>
                                <span className="shrink-0 text-right text-slate-100">
                                  {formatMoney(Number(p.amount), p.currency)}
                                  {cross && (
                                    <span className="ml-1 text-xs text-slate-400">
                                      → {formatMoney(
                                        Number(p.applied_amount),
                                        p.applied_currency,
                                      )}
                                    </span>
                                  )}
                                </span>
                              </div>
                            )
                          })}

                          {/* Si el pago no llegó al total, se ve cuánto falta. */}
                          {st.totals.map((t) => {
                            const paid =
                              st.covered.find((c) => c.currency === t.currency)
                                ?.amount ?? 0
                            const missing = Math.round((t.amount - paid) * 100) / 100
                            if (missing <= 0.01) return null
                            return (
                              <div
                                key={t.currency}
                                className="mt-1 border-t border-white/5 pt-1 text-xs text-orange-300"
                              >
                                Cubre {formatMoney(paid, t.currency)} de{' '}
                                {formatMoney(t.amount, t.currency)} · queda debiendo{' '}
                                {formatMoney(missing, t.currency)}
                              </div>
                            )
                          })}
                        </div>
                        <button
                          onClick={() => undoPay(st)}
                          className="btn-ghost w-full text-sm"
                        >
                          Deshacer pago
                        </button>
                      </div>
                    ) : (
                      payable && (
                        <button
                          onClick={() => openPay(st)}
                          className="btn-primary mt-2 w-full text-sm"
                        >
                          Registrar pago
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

      {/* ----- Modal: pagar el resumen repartido entre cuentas ----- */}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Pagar resumen">
        {payTarget && (
          <div className="space-y-4">
            <div className="space-y-1 rounded-xl bg-slate-800/60 p-3 text-sm">
              <div className="text-slate-400">
                Resumen del {formatShort(payTarget.closeISO)}
              </div>
              {coverage.map((c) => (
                <div key={c.currency} className="flex items-baseline justify-between">
                  <span className="text-lg font-bold text-slate-100">
                    {formatMoney(c.total, c.currency)}
                  </span>
                  <span
                    className={
                      Math.abs(c.missing) < 0.01
                        ? 'text-xs text-emerald-300'
                        : 'text-xs text-slate-400'
                    }
                  >
                    {Math.abs(c.missing) < 0.01
                      ? 'lo pagás entero ✓'
                      : c.missing > 0
                        ? `pagás ${formatMoney(c.covered, c.currency)} · queda ${formatMoney(
                            c.missing,
                            c.currency,
                          )}`
                        : `pagás ${formatMoney(c.covered, c.currency)} · ${formatMoney(
                            -c.missing,
                            c.currency,
                          )} de más`}
                  </span>
                </div>
              ))}
              <p className="pt-1 text-xs text-slate-500">
                El monto es libre: podés pagar el total, el mínimo o una parte.
              </p>
            </div>

            <div className="space-y-3">
              {lines.map((l) => {
                const from = lineCurrency(l)
                const cross = from !== l.appliedCurrency
                const salida = num(l.amount)
                const cubre = num(l.applied)
                return (
                  <div key={l.key} className="space-y-2 rounded-xl bg-slate-800/40 p-3">
                    <div className="flex items-center gap-2">
                      <select
                        className="input flex-1"
                        value={l.accountId}
                        onChange={(e) => onAccountChange(l.key, e.target.value)}
                      >
                        <option value="">Sin cuenta (solo marcar)</option>
                        {payFromAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.icon} {a.name} ({a.currency})
                          </option>
                        ))}
                      </select>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setLines((prev) => prev.filter((x) => x.key !== l.key))
                          }
                          className="shrink-0 rounded-lg px-2 py-1 text-lg text-slate-400"
                          aria-label="Quitar esta cuenta"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="label">Sale ({from})</label>
                        <input
                          className="input"
                          type="number"
                          inputMode="decimal"
                          value={l.amount}
                          onChange={(e) => onAmountChange(l.key, e.target.value)}
                          placeholder="0"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="label">Cubre</label>
                        <div className="flex gap-1">
                          <input
                            className="input min-w-0 flex-1"
                            type="number"
                            inputMode="decimal"
                            value={l.applied}
                            onChange={(e) => onAppliedChange(l.key, e.target.value)}
                            placeholder="0"
                          />
                          {payTarget.totals.length > 1 && (
                            <select
                              className="input w-20 shrink-0 px-1"
                              value={l.appliedCurrency}
                              onChange={(e) =>
                                onAppliedCurrencyChange(
                                  l.key,
                                  e.target.value as Currency,
                                )
                              }
                            >
                              {payTarget.totals.map((t) => (
                                <option key={t.currency} value={t.currency}>
                                  {t.currency}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    </div>

                    {cross && salida > 0 && cubre > 0 && (
                      <p className="text-xs text-slate-500">
                        Tipo de cambio: {formatMoney(cubre / salida, l.appliedCurrency)}{' '}
                        por cada {formatMoney(1, from)}
                      </p>
                    )}
                  </div>
                )
              })}

              <button type="button" onClick={addLine} className="btn-ghost w-full text-sm">
                + Agregar cuenta
              </button>
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

            {payError && (
              <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">
                No se pudo guardar el pago: {payError}
              </p>
            )}

            <button
              onClick={savePay}
              disabled={savingPay || !canConfirm}
              className="btn-primary w-full disabled:opacity-50"
            >
              {savingPay ? 'Guardando…' : 'Confirmar pago'}
            </button>
            {!canConfirm && (
              <p className="text-center text-xs text-slate-500">
                Cargá cuánto pagás en al menos una cuenta.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
