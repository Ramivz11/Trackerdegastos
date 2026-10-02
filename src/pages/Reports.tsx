import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Link } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { netArs } from '../lib/amounts'
import { fetchTransactionsRange } from '../lib/api'
import {
  currentMonth,
  formatDate,
  formatMoney,
  formatMoneyShort,
  formatMonth,
  monthOf,
  monthRange,
  shiftMonth,
  toArs,
  todayISO,
} from '../lib/format'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import type { TransactionWithCategory } from '../types'

function lastMonths(n: number, endMonth: string): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(endMonth, -i))
  return out
}

const TOOLTIP_STYLE = {
  background: '#1e293b',
  border: 'none',
  borderRadius: 12,
  color: '#fff',
}

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

/** Cuántas categorías se ven antes de "Ver todas". */
const TOP_CATEGORIES = 8

export default function Reports() {
  const { categories, categoriesById, accounts, accountsById } = useData()
  const [txs, setTxs] = useState<TransactionWithCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState(currentMonth())
  const [filterType, setFilterType] = useState<'all' | 'expense' | 'income'>('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterAccount, setFilterAccount] = useState('all')
  const [showAllCats, setShowAllCats] = useState(false)
  /** Categoría del gráfico de evolución; null = la de mayor gasto del mes. */
  const [trendCatId, setTrendCatId] = useState<string | null>(null)
  const months = useMemo(() => lastMonths(6, selectedMonth), [selectedMonth])

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

  const matchesFilters = useCallback(
    (t: TransactionWithCategory) => {
      if (t.is_transfer) return false
      if (filterType !== 'all' && t.type !== filterType) return false
      if (filterCategory !== 'all' && t.category_id !== filterCategory) return false
      if (filterAccount !== 'all' && t.account_id !== filterAccount) return false
      return true
    },
    [filterAccount, filterCategory, filterType],
  )

  const selectedTxs = useMemo(
    () => (monthsData[selectedMonth] ?? []).filter(matchesFilters),
    [matchesFilters, monthsData, selectedMonth],
  )

  // Agrupa por categoría las transacciones del tipo pedido en el mes filtrado.
  // De los gastos compartidos cuenta solo tu parte.
  function byCategory(type: 'expense' | 'income') {
    const map = new Map<string, number>()
    for (const t of selectedTxs) {
      if (t.type !== type || !t.category_id) continue
      const ars =
        type === 'expense' ? netArs(t) : toArs(Number(t.amount), t.currency, t.ars_rate)
      map.set(t.category_id, (map.get(t.category_id) ?? 0) + ars)
    }
    return [...map.entries()]
      .map(([id, value]) => ({
        id,
        name: categoriesById[id]?.name ?? 'Otros',
        icon: categoriesById[id]?.icon ?? '❔',
        value,
        color: categoriesById[id]?.color ?? '#64748b',
      }))
      .sort((a, b) => b.value - a.value)
  }

  const pieData = useMemo(
    () => byCategory('expense'),
    [selectedTxs, categoriesById],
  )

  // Torta: ingreso por categoría del mes actual.
  const incomePieData = useMemo(
    () => byCategory('income'),
    [selectedTxs, categoriesById],
  )

  // Barras: gasto e ingreso por mes (últimos 6 meses).
  const barData = useMemo(() => {
    return months.map((m) => {
      const txs = (monthsData[m] ?? []).filter(matchesFilters)
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
  }, [matchesFilters, months, monthsData])

  // Presupuesto vs real para el mes y los filtros elegidos.
  const budgetData = useMemo(() => {
    const spentByCat = new Map<string, number>()
    for (const t of selectedTxs) {
      if (t.type !== 'expense' || !t.category_id) continue
      spentByCat.set(t.category_id, (spentByCat.get(t.category_id) ?? 0) + netArs(t))
    }
    return categories
      .filter((c) => c.monthly_budget != null && c.monthly_budget > 0)
      .map((c) => ({
        cat: c,
        used: spentByCat.get(c.id) ?? 0,
        budget: c.monthly_budget!,
      }))
  }, [categories, selectedTxs])

  const paymentData = useMemo(() => {
    const byAccount = new Map<string, number>()
    for (const t of selectedTxs) {
      if (t.type !== 'expense') continue
      const id = t.account_id ?? 'sin-cuenta'
      byAccount.set(id, (byAccount.get(id) ?? 0) + netArs(t))
    }
    return [...byAccount.entries()]
      .map(([id, value]) => ({
        id,
        name: id === 'sin-cuenta' ? 'Sin medio de pago' : accountsById[id]?.name ?? 'Cuenta eliminada',
        icon: id === 'sin-cuenta' ? '❔' : accountsById[id]?.icon ?? '❔',
        value,
      }))
      .sort((a, b) => b.value - a.value)
  }, [accountsById, selectedTxs])

  // Gastos del mes que pasan los filtros (excluye transferencias).
  const isExpense = useCallback(
    (t: TransactionWithCategory) => t.type === 'expense' && matchesFilters(t),
    [matchesFilters],
  )

  // Ritmo del mes: gasto acumulado día a día contra el mes anterior.
  const prevMonth = shiftMonth(selectedMonth, -1)
  const pace = useMemo(() => {
    const daily = (m: string) => {
      const arr = new Array<number>(32).fill(0)
      for (const t of monthsData[m] ?? []) {
        if (isExpense(t)) arr[Number(t.transaction_date.slice(8, 10))] += netArs(t)
      }
      return arr
    }
    const cur = daily(selectedMonth)
    const prev = daily(prevMonth)
    const daysCur = Number(monthRange(selectedMonth).end.slice(8))
    const daysPrev = Number(monthRange(prevMonth).end.slice(8))
    // En el mes en curso la línea se corta hoy; los días que faltan no son $0.
    const lastDay =
      selectedMonth === currentMonth() ? Number(todayISO().slice(8)) : daysCur
    const rows: { day: number; actual: number | null; anterior: number | null }[] = []
    let a = 0
    let b = 0
    let actualAtLast = 0
    let prevAtLast = 0
    for (let d = 1; d <= Math.max(daysCur, daysPrev); d++) {
      a += cur[d]
      b += prev[d]
      if (d === Math.min(lastDay, daysCur)) actualAtLast = a
      if (d === Math.min(lastDay, daysPrev)) prevAtLast = b
      rows.push({
        day: d,
        actual: d <= Math.min(lastDay, daysCur) ? a : null,
        anterior: d <= daysPrev ? b : null,
      })
    }
    return { rows, lastDay: Math.min(lastDay, daysCur), diff: actualAtLast - prevAtLast }
  }, [isExpense, monthsData, prevMonth, selectedMonth])

  // Evolución de una categoría en los últimos 6 meses.
  const trendCat =
    categoriesById[trendCatId ?? ''] ?? (pieData[0] ? categoriesById[pieData[0].id] : null)
  const trendData = useMemo(() => {
    if (!trendCat) return []
    return months.map((m) => {
      let gasto = 0
      for (const t of monthsData[m] ?? []) {
        if (t.category_id === trendCat.id && isExpense(t)) gasto += netArs(t)
      }
      return { month: format(parseISO(m + '-01'), 'MMM', { locale: es }), gasto }
    })
  }, [isExpense, months, monthsData, trendCat])

  // Gasto por día de la semana del mes elegido.
  const weekdayData = useMemo(() => {
    const rows = WEEKDAYS.map((name) => ({ name, gasto: 0, count: 0 }))
    for (const t of selectedTxs) {
      if (t.type !== 'expense') continue
      // getDay(): 0 = domingo; lo corremos para que la semana arranque el lunes.
      const i = (parseISO(t.transaction_date).getDay() + 6) % 7
      rows[i].gasto += netArs(t)
      rows[i].count += 1
    }
    return rows
  }, [selectedTxs])

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

      <section className="card mb-4 space-y-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedMonth((m) => shiftMonth(m, -1))}
            className="btn bg-slate-800 px-3"
            aria-label="Mes anterior"
          >
            ‹
          </button>
          <input
            type="month"
            className="input min-w-0 flex-1 text-center font-semibold"
            value={selectedMonth}
            onChange={(e) => e.target.value && setSelectedMonth(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setSelectedMonth((m) => shiftMonth(m, 1))}
            disabled={selectedMonth >= currentMonth()}
            className="btn bg-slate-800 px-3 disabled:opacity-30"
            aria-label="Mes siguiente"
          >
            ›
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select
            className="input"
            value={filterType}
            onChange={(e) =>
              setFilterType(e.target.value as 'all' | 'expense' | 'income')
            }
            aria-label="Tipo de movimiento"
          >
            <option value="all">Gastos e ingresos</option>
            <option value="expense">Solo gastos</option>
            <option value="income">Solo ingresos</option>
          </select>
          <select
            className="input"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            aria-label="Categoría"
          >
            <option value="all">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={filterAccount}
            onChange={(e) => setFilterAccount(e.target.value)}
            aria-label="Medio de pago"
          >
            <option value="all">Todos los medios de pago</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icon} {a.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : (
        <div className="space-y-6">
          {/* Ritmo del mes: acumulado vs mes anterior */}
          <section className="card">
            <h2 className="font-semibold text-slate-200">
              Ritmo de gasto · {formatMonth(selectedMonth)}
            </h2>
            {totalSpent === 0 && pace.rows.every((r) => !r.anterior) ? (
              <p className="py-6 text-center text-sm text-slate-500">
                Sin gastos para estos filtros.
              </p>
            ) : (
              <>
                <p className="mb-2 text-sm text-slate-400">
                  {Math.round(pace.diff) === 0 ? (
                    <>Al día {pace.lastDay} vas igual que {formatMonth(prevMonth)}</>
                  ) : (
                    <>
                      Al día {pace.lastDay} vas{' '}
                      <span className="font-semibold text-slate-100">
                        {formatMoney(Math.abs(pace.diff))}
                      </span>{' '}
                      {pace.diff > 0 ? 'arriba ▲' : 'abajo ▼'} de {formatMonth(prevMonth)}
                    </>
                  )}
                </p>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={pace.rows}>
                      <XAxis
                        dataKey="day"
                        stroke="#94a3b8"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        ticks={[1, 8, 15, 22, 29]}
                      />
                      <YAxis
                        stroke="#94a3b8"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        width={44}
                        tickFormatter={(v: number) => formatMoneyShort(v)}
                      />
                      <Tooltip
                        labelFormatter={(d) => `Día ${d}`}
                        formatter={(v: number, name: string) => [
                          formatMoney(v),
                          name === 'actual'
                            ? formatMonth(selectedMonth)
                            : formatMonth(prevMonth),
                        ]}
                        contentStyle={TOOLTIP_STYLE}
                      />
                      <Legend
                        formatter={(value) =>
                          value === 'actual'
                            ? formatMonth(selectedMonth)
                            : formatMonth(prevMonth)
                        }
                        wrapperStyle={{ fontSize: 12 }}
                      />
                      <Line
                        dataKey="anterior"
                        stroke="#64748b"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={false}
                        connectNulls={false}
                      />
                      <Line
                        dataKey="actual"
                        stroke="#6366f1"
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </section>

          {/* Gasto por categoría: barras ordenadas (tocar una abre su evolución) */}
          <section className="card">
            <h2 className="mb-1 font-semibold text-slate-200">
              Gasto por categoría · {formatMonth(selectedMonth)}
            </h2>
            {pieData.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                Sin gastos para estos filtros.
              </p>
            ) : (
              <>
                <p className="mb-3 text-xs text-slate-500">
                  Total {formatMoney(totalSpent)} · tocá una para ver su evolución
                </p>
                <div className="space-y-2.5">
                  {(showAllCats ? pieData : pieData.slice(0, TOP_CATEGORIES)).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setTrendCatId(d.id)}
                      className={`block w-full rounded-lg px-1 py-0.5 text-left transition ${
                        trendCat?.id === d.id ? 'bg-white/5' : ''
                      }`}
                    >
                      <div className="mb-1 flex justify-between gap-2 text-sm">
                        <span className="truncate text-slate-200">
                          {d.icon} {d.name}
                        </span>
                        <span className="shrink-0 text-slate-400">
                          {formatMoney(d.value)} ·{' '}
                          {Math.round((d.value / totalSpent) * 100)}%
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-700/60">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max((d.value / pieData[0].value) * 100, 1)}%`,
                            backgroundColor: d.color,
                          }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
                {pieData.length > TOP_CATEGORIES && (
                  <button
                    type="button"
                    onClick={() => setShowAllCats((v) => !v)}
                    className="mt-3 w-full text-sm font-medium text-brand"
                  >
                    {showAllCats
                      ? 'Ver menos'
                      : `Ver todas (${pieData.length - TOP_CATEGORIES} más)`}
                  </button>
                )}
              </>
            )}
          </section>

          {/* Evolución de la categoría elegida */}
          {trendCat && (
            <section className="card">
              <h2 className="mb-2 font-semibold text-slate-200">
                {trendCat.icon} {trendCat.name} · últimos 6 meses
              </h2>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendData}>
                    <XAxis
                      dataKey="month"
                      stroke="#94a3b8"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: '#ffffff11' }}
                      formatter={(v: number) => [formatMoney(v), 'Gasto']}
                      contentStyle={TOOLTIP_STYLE}
                    />
                    <Bar dataKey="gasto" fill={trendCat.color} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Gasto por día de la semana */}
          {totalSpent > 0 && (
            <section className="card">
              <h2 className="mb-2 font-semibold text-slate-200">
                Por día de la semana · {formatMonth(selectedMonth)}
              </h2>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekdayData}>
                    <XAxis
                      dataKey="name"
                      stroke="#94a3b8"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: '#ffffff11' }}
                      formatter={(v: number, _n, item) => [
                        `${formatMoney(v)} · ${item.payload.count} mov.`,
                        'Gasto',
                      ]}
                      contentStyle={TOOLTIP_STYLE}
                    />
                    <Bar dataKey="gasto" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Torta de ingresos por categoría */}
          <section className="card">
            <h2 className="mb-2 font-semibold text-slate-200">
              Ingreso por categoría · {formatMonth(selectedMonth)}
            </h2>
            {incomePieData.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                Sin ingresos para estos filtros.
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
                        contentStyle={TOOLTIP_STYLE}
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

          {/* Cuánto se pagó con cada cuenta o tarjeta. */}
          <section className="card">
            <h2 className="mb-3 font-semibold text-slate-200">
              Gastos por medio de pago
            </h2>
            {paymentData.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">
                Sin gastos para estos filtros.
              </p>
            ) : (
              <div className="space-y-2">
                {paymentData.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between rounded-xl bg-slate-800/70 px-3 py-2"
                  >
                    <span className="text-sm text-slate-200">
                      {row.icon} {row.name}
                    </span>
                    <span className="text-sm font-semibold text-slate-100">
                      {formatMoney(row.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Detalle auditable del mes: qué fue y con qué se pagó o cobró. */}
          <section className="card">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-slate-200">Detalle del mes</h2>
              <span className="text-xs text-slate-500">
                {selectedTxs.length} movimientos
              </span>
            </div>
            {selectedTxs.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">
                No hay movimientos para mostrar.
              </p>
            ) : (
              <div className="divide-y divide-white/5">
                {selectedTxs.map((t) => {
                  const cat = t.category_id ? categoriesById[t.category_id] : null
                  const account = t.account_id ? accountsById[t.account_id] : null
                  return (
                    <div key={t.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg"
                        style={{ backgroundColor: (cat?.color ?? '#64748b') + '33' }}
                      >
                        {cat?.icon ?? '❔'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-100">
                          {t.description || cat?.name || 'Sin categoría'}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDate(t.transaction_date)} · {cat?.name ?? 'Sin categoría'} ·{' '}
                          {account ? `${account.icon} ${account.name}` : 'Sin cuenta'}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-sm font-semibold ${
                          t.type === 'income' ? 'text-emerald-400' : 'text-slate-100'
                        }`}
                      >
                        {t.type === 'income' ? '+' : '−'}
                        {formatMoney(Number(t.amount), t.currency)}
                      </span>
                    </div>
                  )
                })}
              </div>
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
                    contentStyle={TOOLTIP_STYLE}
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
                Presupuesto vs real · {formatMonth(selectedMonth)}
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
