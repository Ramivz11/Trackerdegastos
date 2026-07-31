import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import QuickAdd from '../components/QuickAdd'
import { useData } from '../context/DataContext'
import { useSettings } from '../context/SettingsContext'
import { fetchReceivables, fetchRecurring, fetchTransactionsRange } from '../lib/api'
import { netArs } from '../lib/amounts'
import { buildBudgetLines, spentByMonthAndCategory } from '../lib/budget'
import {
  currentMonth,
  formatDate,
  formatMoney,
  formatMonth,
  monthOf,
  monthRange,
  shiftMonth,
  toArs,
  todayISO,
} from '../lib/format'
import type { RecurringExpense, TransactionWithCategory } from '../types'

// Meses de historia que se traen para poder calcular el arrastre de
// presupuesto. Es una sola consulta por rango, no una por mes.
const HISTORY_MONTHS = 11

/** Variación porcentual entre dos montos, o null si no hay base con la que comparar. */
function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

export default function Dashboard() {
  const { categories } = useData()
  const { settings } = useSettings()
  const [txs, setTxs] = useState<TransactionWithCategory[]>([])
  const [recurring, setRecurring] = useState<RecurringExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(currentMonth())
  const [owedToMe, setOwedToMe] = useState(0)
  const [owedCount, setOwedCount] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const start = monthRange(shiftMonth(month, -HISTORY_MONTHS)).start
      const end = monthRange(month).end
      const [t, r, receivables] = await Promise.all([
        fetchTransactionsRange(start, end),
        fetchRecurring(),
        // Si la base todavía no tiene gastos compartidos, no pasa nada.
        fetchReceivables(true).catch(() => []),
      ])
      setTxs(t)
      setRecurring(r)
      setOwedCount(receivables.length)
      setOwedToMe(
        receivables.reduce(
          (sum, rc) =>
            sum +
            toArs(rc.pending, rc.transaction.currency, rc.transaction.ars_rate),
          0,
        ),
      )
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => {
    void load()
  }, [load])

  const prevMonth = useMemo(() => shiftMonth(month, -1), [month])

  // Totales del mes elegido y del anterior, en una sola pasada.
  const { spent, income, byCategory, prevSpent, prevByCategory } = useMemo(() => {
    let spent = 0
    let income = 0
    let prevSpent = 0
    const byCategory = new Map<string, number>()
    const prevByCategory = new Map<string, number>()

    for (const t of txs) {
      if (t.is_transfer) continue
      const m = monthOf(t.transaction_date)
      if (m !== month && m !== prevMonth) continue

      const isCurrent = m === month

      if (t.type === 'expense') {
        // De un gasto compartido solo cuenta tu parte.
        const amt = netArs(t)
        if (isCurrent) {
          spent += amt
          if (t.category_id)
            byCategory.set(t.category_id, (byCategory.get(t.category_id) ?? 0) + amt)
        } else {
          prevSpent += amt
          if (t.category_id)
            prevByCategory.set(
              t.category_id,
              (prevByCategory.get(t.category_id) ?? 0) + amt,
            )
        }
      } else if (isCurrent) {
        income += toArs(Number(t.amount), t.currency, t.ars_rate)
      }
    }
    return { spent, income, byCategory, prevSpent, prevByCategory }
  }, [txs, month, prevMonth])

  // Promedio diario y proyección de fin de mes (solo para el mes en curso).
  const projection = useMemo(() => {
    const isCurrent = month === currentMonth()
    const [y, m] = month.split('-').map(Number)
    const daysInMonth = new Date(y, m, 0).getDate()
    const dayOfMonth = isCurrent ? new Date().getDate() : daysInMonth
    const avgPerDay = dayOfMonth > 0 ? spent / dayOfMonth : 0
    const projected = avgPerDay * daysInMonth
    return { isCurrent, avgPerDay, projected, daysInMonth, dayOfMonth }
  }, [month, spent])

  /**
   * Comparación con el mes anterior. Para el mes en curso se compara el mismo
   * tramo de días (del 1 al día de hoy contra el 1 al mismo día del mes
   * pasado), porque comparar 10 días contra 30 no dice nada.
   */
  const comparison = useMemo(() => {
    if (!projection.isCurrent) {
      return { prev: prevSpent, pct: pctChange(spent, prevSpent), parcial: false }
    }
    const cutoff = new Date().getDate()
    let prevSameDays = 0
    for (const t of txs) {
      if (t.is_transfer || t.type !== 'expense') continue
      if (monthOf(t.transaction_date) !== prevMonth) continue
      if (Number(t.transaction_date.slice(8, 10)) > cutoff) continue
      prevSameDays += netArs(t)
    }
    return {
      prev: prevSameDays,
      pct: pctChange(spent, prevSameDays),
      parcial: true,
    }
  }, [txs, prevMonth, spent, prevSpent, projection.isCurrent])

  // Categorías que más subieron o bajaron respecto al mes anterior.
  const movers = useMemo(() => {
    const ids = new Set([...byCategory.keys(), ...prevByCategory.keys()])
    return [...ids]
      .map((id) => {
        const now = byCategory.get(id) ?? 0
        const before = prevByCategory.get(id) ?? 0
        return {
          cat: categories.find((c) => c.id === id),
          diff: now - before,
          now,
          before,
        }
      })
      .filter((x) => x.cat && Math.abs(x.diff) > 0)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 3)
  }, [byCategory, prevByCategory, categories])

  // Alertas de presupuesto, teniendo en cuenta el arrastre de cada categoría.
  const spentHistory = useMemo(() => spentByMonthAndCategory(txs), [txs])
  const budgetAlerts = useMemo(
    () =>
      buildBudgetLines(month, categories, spentHistory, HISTORY_MONTHS).filter(
        (l) => l.ratio >= 0.8,
      ),
    [month, categories, spentHistory],
  )

  // Techo global de gasto (opcional, se configura en Presupuesto).
  const techo = settings?.monthly_budget_total ?? null

  // Próximos vencimientos (no automáticos o próximos), ordenados por fecha.
  const upcoming = useMemo(() => {
    const today = parseISO(todayISO())
    return recurring
      .filter((r) => r.is_active)
      .map((r) => ({
        r,
        days: differenceInCalendarDays(parseISO(r.next_due_date), today),
      }))
      .filter((x) => x.days <= 10)
      .sort((a, b) => a.days - b.days)
      .slice(0, 5)
  }, [recurring])

  // Top categorías para el mini-resumen.
  const topCats = useMemo(() => {
    return [...byCategory.entries()]
      .map(([id, amt]) => ({
        cat: categories.find((c) => c.id === id),
        amt,
      }))
      .filter((x) => x.cat)
      .sort((a, b) => b.amt - a.amt)
      .slice(0, 5)
  }, [byCategory, categories])

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Hola 👋</h1>
        <div className="flex items-center gap-1 rounded-xl bg-slate-800/60 p-1">
          <button
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="rounded-lg px-2 py-1 text-slate-300"
            aria-label="Mes anterior"
          >
            ‹
          </button>
          <span className="min-w-[7rem] text-center text-sm font-semibold capitalize text-slate-100">
            {formatMonth(month)}
          </span>
          <button
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="rounded-lg px-2 py-1 text-slate-300"
            aria-label="Mes siguiente"
          >
            ›
          </button>
        </div>
      </header>

      {/* Resumen del mes */}
      <div className="card mb-4 bg-gradient-to-br from-brand to-brand-dark">
        <div className="text-sm text-white/80">
          {projection.isCurrent ? 'Gastado este mes' : 'Gastado en el mes'}
        </div>
        <div className="text-4xl font-bold text-white">{formatMoney(spent)}</div>
        <div className="mt-2 text-sm text-white/80">
          Ingresos: {formatMoney(income)} · Balance:{' '}
          <span className="font-semibold">{formatMoney(income - spent)}</span>
        </div>

        {/* Comparación con el mes anterior */}
        {comparison.pct != null && (
          <div className="mt-3 border-t border-white/20 pt-2 text-sm text-white/90">
            <span className="font-semibold">
              {comparison.pct >= 0 ? '▲' : '▼'}{' '}
              {Math.abs(Math.round(comparison.pct))}%
            </span>{' '}
            {comparison.pct >= 0 ? 'más' : 'menos'} que el mes pasado
            <span className="text-white/60">
              {' '}
              ({formatMoney(comparison.prev)}
              {comparison.parcial ? ', mismo tramo de días' : ''})
            </span>
          </div>
        )}
      </div>

      {/* Plata que te deben por gastos compartidos */}
      {owedToMe > 0 && (
        <Link to="/deudas" className="card mb-4 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xl">
            🤝
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-slate-400">Te deben</div>
            <div className="text-xl font-bold text-emerald-400">
              {formatMoney(owedToMe)}
            </div>
          </div>
          <span className="shrink-0 text-xs text-slate-500">
            {owedCount} gasto{owedCount === 1 ? '' : 's'} ›
          </span>
        </Link>
      )}

      {/* Techo global de gasto */}
      {techo != null && techo > 0 && (
        <Link to="/presupuesto" className="card mb-4 block">
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-slate-300">Techo del mes</span>
            <span
              className={spent >= techo ? 'text-red-400' : 'text-slate-400'}
            >
              {formatMoney(spent)} / {formatMoney(techo)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-700">
            <div
              className={`h-full rounded-full ${
                spent >= techo
                  ? 'bg-red-500'
                  : spent / techo >= 0.8
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min((spent / techo) * 100, 100)}%` }}
            />
          </div>
        </Link>
      )}

      {/* Promedio diario y proyección */}
      {spent > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="card">
            <div className="text-xs text-slate-400">Promedio por día</div>
            <div className="text-lg font-bold text-slate-100">
              {formatMoney(projection.avgPerDay)}
            </div>
          </div>
          <div className="card">
            <div className="text-xs text-slate-400">
              {projection.isCurrent ? 'Proyección fin de mes' : 'Total del mes'}
            </div>
            <div className="text-lg font-bold text-slate-100">
              {formatMoney(projection.projected)}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : (
        <>
          {/* Qué cambió respecto al mes anterior */}
          {movers.length > 0 && (
            <section className="mb-4">
              <h2 className="mb-2 text-sm font-semibold text-slate-300">
                📈 Qué cambió
              </h2>
              <div className="card space-y-2">
                {movers.map(({ cat, diff, now, before }) => (
                  <div
                    key={cat!.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate text-slate-200">
                      {cat!.icon} {cat!.name}
                    </span>
                    <span className="mx-2 shrink-0 text-xs text-slate-500">
                      {formatMoney(before)} → {formatMoney(now)}
                    </span>
                    <span
                      className={`shrink-0 font-semibold ${
                        diff > 0 ? 'text-red-400' : 'text-emerald-400'
                      }`}
                    >
                      {diff > 0 ? '+' : '−'}
                      {formatMoney(Math.abs(diff))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Alertas de presupuesto */}
          {budgetAlerts.length > 0 && (
            <section className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-300">
                  ⚠️ Presupuestos
                </h2>
                <Link to="/presupuesto" className="text-xs text-brand">
                  Ver todos
                </Link>
              </div>
              <div className="space-y-2">
                {budgetAlerts.map((l) => {
                  const over = l.ratio >= 1
                  return (
                    <div key={l.category.id} className="card">
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="text-slate-200">
                          {l.category.icon} {l.category.name}
                        </span>
                        <span className={over ? 'text-red-400' : 'text-amber-400'}>
                          {formatMoney(l.spent)} / {formatMoney(l.limit)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-700">
                        <div
                          className={`h-full ${over ? 'bg-red-500' : 'bg-amber-500'}`}
                          style={{ width: `${Math.min(l.ratio * 100, 100)}%` }}
                        />
                      </div>
                      {over && (
                        <p className="mt-1 text-xs text-red-400">
                          Te pasaste {formatMoney(l.spent - l.limit)}
                        </p>
                      )}
                      {!over && l.category.rollover && l.carry !== 0 && (
                        <p className="mt-1 text-xs text-slate-500">
                          Incluye {l.carry > 0 ? '+' : '−'}
                          {formatMoney(Math.abs(l.carry))} arrastrado
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Próximos vencimientos */}
          <section className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-300">
                🔔 Próximos pagos
              </h2>
              <Link to="/recurrentes" className="text-xs text-brand">
                Ver todos
              </Link>
            </div>
            {upcoming.length === 0 ? (
              <p className="card text-sm text-slate-500">
                No hay pagos próximos. 🎉
              </p>
            ) : (
              <div className="space-y-2">
                {upcoming.map(({ r, days }) => (
                  <Link
                    to="/recurrentes"
                    key={r.id}
                    className="card flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium text-slate-100">{r.name}</div>
                      <div
                        className={`text-xs ${
                          days < 0
                            ? 'text-red-400'
                            : days <= 3
                              ? 'text-amber-400'
                              : 'text-slate-400'
                        }`}
                      >
                        {days < 0
                          ? `Vencido (${formatDate(r.next_due_date)})`
                          : days === 0
                            ? 'Vence hoy'
                            : days === 1
                              ? 'Vence mañana'
                              : `En ${days} días`}
                      </div>
                    </div>
                    <div className="font-bold text-slate-100">
                      {formatMoney(Number(r.amount))}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* En qué gastás más */}
          {topCats.length > 0 && (
            <section className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-300">
                  📊 En qué gastás
                </h2>
                <Link to="/reportes" className="text-xs text-brand">
                  Ver reportes
                </Link>
              </div>
              <div className="card space-y-3">
                {topCats.map(({ cat, amt }) => {
                  const pct = spent > 0 ? (amt / spent) * 100 : 0
                  return (
                    <div key={cat!.id}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="text-slate-200">
                          {cat!.icon} {cat!.name}
                        </span>
                        <span className="text-slate-300">{formatMoney(amt)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-700">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: cat!.color }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}

      <QuickAdd onSaved={load} />
    </div>
  )
}
