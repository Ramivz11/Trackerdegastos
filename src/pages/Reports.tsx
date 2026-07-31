import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts'
import { Link } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { netArs } from '../lib/amounts'
import { fetchTransactionsRange } from '../lib/api'
import {
  currentMonth,
  formatMoney,
  monthOf,
  monthRange,
  shiftMonth,
  toArs,
} from '../lib/format'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import type { TransactionWithCategory } from '../types'

function lastMonths(n: number): string[] {
  const out: string[] = []
  const current = currentMonth()
  for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(current, -i))
  return out
}

export default function Reports() {
  const { categories, categoriesById } = useData()
  const [txs, setTxs] = useState<TransactionWithCategory[]>([])
  const [loading, setLoading] = useState(true)
  const months = useMemo(() => lastMonths(6), [])

  // Una sola consulta por rango en lugar de una por mes.
  useEffect(() => {
    let cancel = false
    setLoading(true)
    const start = monthRange(months[0]).start
    const end = monthRange(months[months.length - 1]).end
    fetchTransactionsRange(start, end)
      .then((d) => !cancel && setTxs(d))
      .finally(() => !cancel && setLoading(false))
    return () => {
      cancel = true
    }
  }, [months])

  // Los movimientos agrupados por mes, para no recorrer la lista entera
  // en cada uno de los gráficos.
  const monthsData = useMemo(() => {
    const map: Record<string, TransactionWithCategory[]> = {}
    for (const m of months) map[m] = []
    for (const t of txs) {
      const m = monthOf(t.transaction_date)
      if (map[m]) map[m].push(t)
    }
    return map
  }, [txs, months])

  const current = currentMonth()
  const currentTxs = monthsData[current] ?? []

  // Agrupa por categoría las transacciones del tipo pedido (mes actual).
  // De los gastos compartidos cuenta solo tu parte.
  function byCategory(type: 'expense' | 'income') {
    const map = new Map<string, number>()
    for (const t of currentTxs) {
      if (t.is_transfer || t.type !== type || !t.category_id) continue
      const ars =
        type === 'expense' ? netArs(t) : toArs(Number(t.amount), t.currency, t.ars_rate)
      map.set(t.category_id, (map.get(t.category_id) ?? 0) + ars)
    }
    return [...map.entries()]
      .map(([id, value]) => ({
        name: categoriesById[id]?.name ?? 'Otros',
        value,
        color: categoriesById[id]?.color ?? '#64748b',
      }))
      .sort((a, b) => b.value - a.value)
  }

  // Torta: gasto por categoría del mes actual.
  const pieData = useMemo(() => byCategory('expense'), [currentTxs, categoriesById])

  // Torta: ingreso por categoría del mes actual.
  const incomePieData = useMemo(
    () => byCategory('income'),
    [currentTxs, categoriesById],
  )

  // Barras: gasto e ingreso por mes (últimos 6 meses).
  const barData = useMemo(() => {
    return months.map((m) => {
      const txs = monthsData[m] ?? []
      let gasto = 0
      let ingreso = 0
      for (const t of txs) {
        if (t.is_transfer) continue
        if (t.type === 'expense') gasto += netArs(t)
        else ingreso += toArs(Number(t.amount), t.currency, t.ars_rate)
      }
      return {
        month: format(parseISO(m + '-01'), 'MMM', { locale: es }),
        gasto,
        ingreso,
      }
    })
  }, [months, monthsData])

  // Presupuesto vs real (mes actual).
  const budgetData = useMemo(() => {
    const spentByCat = new Map<string, number>()
    for (const t of currentTxs) {
      if (t.is_transfer || t.type !== 'expense' || !t.category_id) continue
      spentByCat.set(t.category_id, (spentByCat.get(t.category_id) ?? 0) + netArs(t))
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
  const totalIncome = incomePieData.reduce((s, d) => s + d.value, 0)

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-white">Reportes</h1>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <Link
          to="/patrimonio"
          className="card flex flex-col items-center gap-1 py-3 text-center"
        >
          <span className="text-xl">📈</span>
          <span className="text-xs text-slate-300">Patrimonio</span>
        </Link>
        <Link
          to="/presupuesto"
          className="card flex flex-col items-center gap-1 py-3 text-center"
        >
          <span className="text-xl">🎯</span>
          <span className="text-xs text-slate-300">Presupuesto</span>
        </Link>
        <Link
          to="/buscar"
          className="card flex flex-col items-center gap-1 py-3 text-center"
        >
          <span className="text-xl">🔍</span>
          <span className="text-xs text-slate-300">Buscar</span>
        </Link>
      </div>

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

          {/* Torta de ingresos por categoría */}
          <section className="card">
            <h2 className="mb-2 font-semibold text-slate-200">
              Ingreso por categoría (este mes)
            </h2>
            {incomePieData.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                Sin ingresos este mes.
              </p>
            ) : (
              <>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={incomePieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={2}
                      >
                        {incomePieData.map((d, i) => (
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
                  {incomePieData.map((d) => (
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
                        {totalIncome > 0
                          ? Math.round((d.value / totalIncome) * 100)
                          : 0}
                        %
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex justify-between border-t border-white/5 pt-2 text-sm">
                  <span className="text-slate-300">Total ingresos</span>
                  <span className="font-semibold text-emerald-400">
                    {formatMoney(totalIncome)}
                  </span>
                </div>
              </>
            )}
          </section>

          {/* Barras mes a mes: gasto vs ingreso */}
          <section className="card">
            <h2 className="mb-2 font-semibold text-slate-200">
              Gasto vs ingreso (últimos 6 meses)
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
                  <Legend
                    formatter={(value) =>
                      value === 'gasto' ? 'Gasto' : 'Ingreso'
                    }
                    wrapperStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="gasto" fill="#ef4444" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="ingreso" fill="#22c55e" radius={[6, 6, 0, 0]} />
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
