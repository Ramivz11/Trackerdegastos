import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts'
import { useData } from '../context/DataContext'
import { fetchTransactionsByMonth } from '../lib/api'
import { currentMonth, formatMoney } from '../lib/format'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import type { TransactionWithCategory } from '../types'

function lastMonths(n: number): string[] {
  const out: string[] = []
  const [y, m] = currentMonth().split('-').map(Number)
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export default function Reports() {
  const { categories, categoriesById } = useData()
  const [monthsData, setMonthsData] = useState<
    Record<string, TransactionWithCategory[]>
  >({})
  const [loading, setLoading] = useState(true)
  const months = useMemo(() => lastMonths(6), [])

  useEffect(() => {
    let cancel = false
    setLoading(true)
    Promise.all(months.map((m) => fetchTransactionsByMonth(m)))
      .then((results) => {
        if (cancel) return
        const map: Record<string, TransactionWithCategory[]> = {}
        months.forEach((m, i) => (map[m] = results[i]))
        setMonthsData(map)
      })
      .finally(() => !cancel && setLoading(false))
    return () => {
      cancel = true
    }
  }, [months])

  const current = currentMonth()
  const currentTxs = monthsData[current] ?? []

  // Torta: gasto por categoría del mes actual.
  const pieData = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of currentTxs) {
      if (t.type !== 'expense' || !t.category_id) continue
      map.set(t.category_id, (map.get(t.category_id) ?? 0) + Number(t.amount))
    }
    return [...map.entries()]
      .map(([id, value]) => ({
        name: categoriesById[id]?.name ?? 'Otros',
        value,
        color: categoriesById[id]?.color ?? '#64748b',
      }))
      .sort((a, b) => b.value - a.value)
  }, [currentTxs, categoriesById])

  // Barras: gasto total por mes (últimos 6 meses).
  const barData = useMemo(() => {
    return months.map((m) => {
      const txs = monthsData[m] ?? []
      const total = txs
        .filter((t) => t.type === 'expense')
        .reduce((s, t) => s + Number(t.amount), 0)
      return {
        month: format(parseISO(m + '-01'), 'MMM', { locale: es }),
        total,
      }
    })
  }, [months, monthsData])

  // Presupuesto vs real (mes actual).
  const budgetData = useMemo(() => {
    const spentByCat = new Map<string, number>()
    for (const t of currentTxs) {
      if (t.type !== 'expense' || !t.category_id) continue
      spentByCat.set(
        t.category_id,
        (spentByCat.get(t.category_id) ?? 0) + Number(t.amount),
      )
    }
    return categories
      .filter((c) => c.monthly_budget != null && c.monthly_budget > 0)
      .map((c) => ({
        cat: c,
        used: spentByCat.get(c.id) ?? 0,
        budget: c.monthly_budget!,
      }))
  }, [categories, currentTxs])

  const totalSpent = pieData.reduce((s, d) => s + d.value, 0)

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-white">Reportes</h1>

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : (
        <div className="space-y-6">
          {/* Torta por categoría */}
          <section className="card">
            <h2 className="mb-2 font-semibold text-slate-200">
              Gasto por categoría (este mes)
            </h2>
            {pieData.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                Sin gastos este mes.
              </p>
            ) : (
              <>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={2}
                      >
                        {pieData.map((d, i) => (
                          <Cell key={i} fill={d.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => formatMoney(v)}
                        contentStyle={{
                          background: '#1e293b',
                          border: 'none',
                          borderRadius: 12,
                          color: '#fff',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 space-y-1">
                  {pieData.map((d) => (
                    <div
                      key={d.name}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="flex items-center gap-2 text-slate-300">
                        <span
                          className="inline-block h-3 w-3 rounded-full"
                          style={{ backgroundColor: d.color }}
                        />
                        {d.name}
                      </span>
                      <span className="text-slate-400">
                        {formatMoney(d.value)} ·{' '}
                        {totalSpent > 0
                          ? Math.round((d.value / totalSpent) * 100)
                          : 0}
                        %
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Barras mes a mes */}
          <section className="card">
            <h2 className="mb-2 font-semibold text-slate-200">
              Gasto mensual (últimos 6 meses)
            </h2>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <XAxis
                    dataKey="month"
                    stroke="#94a3b8"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: '#ffffff11' }}
                    formatter={(v: number) => formatMoney(v)}
                    contentStyle={{
                      background: '#1e293b',
                      border: 'none',
                      borderRadius: 12,
                      color: '#fff',
                    }}
                  />
                  <Bar dataKey="total" fill="#6366f1" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Presupuesto vs real */}
          {budgetData.length > 0 && (
            <section className="card">
              <h2 className="mb-3 font-semibold text-slate-200">
                Presupuesto vs real (este mes)
              </h2>
              <div className="space-y-3">
                {budgetData.map(({ cat, used, budget }) => {
                  const ratio = used / budget
                  const over = ratio > 1
                  return (
                    <div key={cat.id}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="text-slate-200">
                          {cat.icon} {cat.name}
                        </span>
                        <span
                          className={over ? 'text-red-400' : 'text-slate-400'}
                        >
                          {formatMoney(used)} / {formatMoney(budget)}
                        </span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-slate-700">
                        <div
                          className={`h-full rounded-full ${
                            over
                              ? 'bg-red-500'
                              : ratio >= 0.8
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
