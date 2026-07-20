import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import QuickAdd from '../components/QuickAdd'
import { useData } from '../context/DataContext'
import { fetchRecurring, fetchTransactionsByMonth } from '../lib/api'
import {
  currentMonth,
  formatDate,
  formatMoney,
  formatMonth,
  toArs,
  todayISO,
} from '../lib/format'
import type { RecurringExpense, TransactionWithCategory } from '../types'

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Dashboard() {
  const { categories } = useData()
  const [txs, setTxs] = useState<TransactionWithCategory[]>([])
  const [recurring, setRecurring] = useState<RecurringExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(currentMonth())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, r] = await Promise.all([
        fetchTransactionsByMonth(month),
        fetchRecurring(),
      ])
      setTxs(t)
      setRecurring(r)
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => {
    void load()
  }, [load])

  const { spent, income, byCategory } = useMemo(() => {
    let spent = 0
    let income = 0
    const byCategory = new Map<string, number>()
    for (const t of txs) {
      if (t.is_transfer) continue
      const amt = toArs(Number(t.amount), t.currency, t.ars_rate)
      if (t.type === 'expense') {
        spent += amt
        if (t.category_id)
          byCategory.set(t.category_id, (byCategory.get(t.category_id) ?? 0) + amt)
      } else {
        income += amt
      }
    }
    return { spent, income, byCategory }
  }, [txs])

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

  // Alertas de presupuesto: categorías cerca o por encima del límite.
  const budgetAlerts = useMemo(() => {
    return categories
      .filter((c) => c.monthly_budget != null && c.monthly_budget > 0)
      .map((c) => {
        const used = byCategory.get(c.id) ?? 0
        return { cat: c, used, budget: c.monthly_budget!, ratio: used / c.monthly_budget! }
      })
      .filter((b) => b.ratio >= 0.8)
      .sort((a, b) => b.ratio - a.ratio)
  }, [categories, byCategory])

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
      </div>

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
          {/* Alertas de presupuesto */}
          {budgetAlerts.length > 0 && (
            <section className="mb-4">
              <h2 className="mb-2 text-sm font-semibold text-slate-300">
                ⚠️ Presupuestos
              </h2>
              <div className="space-y-2">
                {budgetAlerts.map(({ cat, used, budget, ratio }) => {
                  const over = ratio >= 1
                  return (
                    <div key={cat.id} className="card">
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="text-slate-200">
                          {cat.icon} {cat.name}
                        </span>
                        <span className={over ? 'text-red-400' : 'text-amber-400'}>
                          {formatMoney(used)} / {formatMoney(budget)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-700">
                        <div
                          className={`h-full ${over ? 'bg-red-500' : 'bg-amber-500'}`}
                          style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                        />
                      </div>
                      {over && (
                        <p className="mt-1 text-xs text-red-400">
                          Te pasaste {formatMoney(used - budget)}
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
