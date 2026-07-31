import { useCallback, useEffect, useMemo, useState } from 'react'
import { useData } from '../context/DataContext'
import { netArs } from '../lib/amounts'
import { fetchTransactionsRange } from '../lib/api'
import { transactionsToCsv, downloadCsv } from '../lib/export'
import { formatDate, formatMoney, toArs, todayISO } from '../lib/format'
import type { TransactionType, TransactionWithCategory } from '../types'

/** Rangos rápidos, calculados sobre la fecha de hoy. */
function presetRange(preset: string): { from: string; to: string } {
  const today = todayISO()
  const [y, m] = today.split('-').map(Number)
  switch (preset) {
    case 'año':
      return { from: `${y}-01-01`, to: today }
    case 'año-pasado':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
    case '3meses': {
      const d = new Date(y, m - 3, 1)
      return {
        from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`,
        to: today,
      }
    }
    case '12meses': {
      const d = new Date(y - 1, m - 1, 1)
      return {
        from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`,
        to: today,
      }
    }
    default:
      return { from: `${y}-01-01`, to: today }
  }
}

/**
 * Búsqueda global: a diferencia de Movimientos, no está atada a un mes.
 * Sirve para "¿cuánto gasté en X en todo el año?".
 */
export default function Search() {
  const { categories, categoriesById, accounts, accountsById } = useData()
  const initial = useMemo(() => presetRange('año'), [])
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [q, setQ] = useState('')
  const [filterCat, setFilterCat] = useState('all')
  const [filterAccount, setFilterAccount] = useState('all')
  const [filterType, setFilterType] = useState<'all' | TransactionType>('all')
  const [items, setItems] = useState<TransactionWithCategory[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!from || !to || from > to) return
    setLoading(true)
    try {
      setItems(await fetchTransactionsRange(from, to))
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    void load()
  }, [load])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter((t) => {
      if (filterType !== 'all' && t.type !== filterType) return false
      if (filterCat !== 'all' && t.category_id !== filterCat) return false
      if (filterAccount !== 'all' && t.account_id !== filterAccount) return false
      if (needle) {
        const cat = t.category_id ? categoriesById[t.category_id] : null
        const acc = t.account_id ? accountsById[t.account_id] : null
        const hay =
          `${t.description ?? ''} ${cat?.name ?? ''} ${acc?.name ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [items, q, filterType, filterCat, filterAccount, categoriesById, accountsById])

  const totals = useMemo(() => {
    let expense = 0
    let income = 0
    for (const t of results) {
      if (t.is_transfer) continue
      if (t.type === 'expense') expense += netArs(t)
      else income += toArs(Number(t.amount), t.currency, t.ars_rate)
    }
    const meses = new Set(results.map((t) => t.transaction_date.slice(0, 7))).size
    return { expense, income, meses: Math.max(meses, 1) }
  }, [results])

  function exportar() {
    const csv = transactionsToCsv(results, categoriesById, accountsById)
    downloadCsv(`movimientos-${from}_a_${to}.csv`, csv)
  }

  const presets: [string, string][] = [
    ['3meses', 'Últimos 3 meses'],
    ['12meses', 'Últimos 12 meses'],
    ['año', 'Este año'],
    ['año-pasado', 'Año pasado'],
  ]

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-white">Buscar</h1>

      <input
        className="input mb-3"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="🔍 Nota, categoría o cuenta"
      />

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="label">Desde</label>
          <input
            className="input"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Hasta</label>
          <input
            className="input"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        {presets.map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              const r = presetRange(key)
              setFrom(r.from)
              setTo(r.to)
            }}
            className="btn bg-slate-700/60 py-2 text-sm text-slate-300"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        {(
          [
            ['all', 'Todos'],
            ['expense', 'Egresos'],
            ['income', 'Ingresos'],
          ] as [typeof filterType, string][]
        ).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFilterType(val)}
            className={`btn py-2 text-sm ${
              filterType === val
                ? 'bg-brand text-white'
                : 'bg-slate-700/60 text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <select
          className="input"
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
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
        >
          <option value="all">Todas las cuentas</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.icon} {a.name}
            </option>
          ))}
        </select>
      </div>

      {/* Resumen del resultado */}
      <div className="card mb-4">
        <div className="mb-2 flex justify-between text-sm">
          <span className="text-slate-400">
            {results.length} movimiento{results.length === 1 ? '' : 's'}
          </span>
          <button
            onClick={exportar}
            disabled={results.length === 0}
            className="text-xs font-semibold text-brand disabled:opacity-40"
          >
            ⬇ Exportar CSV
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-slate-400">Gastos</div>
            <div className="text-lg font-bold text-red-400">
              {formatMoney(totals.expense)}
            </div>
            <div className="text-xs text-slate-500">
              {formatMoney(totals.expense / totals.meses)} por mes
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Ingresos</div>
            <div className="text-lg font-bold text-emerald-400">
              {formatMoney(totals.income)}
            </div>
            <div className="text-xs text-slate-500">
              {formatMoney(totals.income / totals.meses)} por mes
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-slate-400">Buscando…</p>
      ) : results.length === 0 ? (
        <p className="py-8 text-center text-slate-500">
          No hay movimientos con esos filtros.
        </p>
      ) : (
        <div className="space-y-2">
          {results.map((t) => {
            const cat = t.category_id ? categoriesById[t.category_id] : null
            const acc = t.account_id ? accountsById[t.account_id] : null
            return (
              <div key={t.id} className="card flex items-center gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg"
                  style={{ backgroundColor: (cat?.color ?? '#64748b') + '33' }}
                >
                  {cat?.icon ?? '❓'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-100">
                    {t.description || cat?.name || 'Sin categoría'}
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    {formatDate(t.transaction_date, "d 'de' MMM yyyy")}
                    {acc ? ` · ${acc.name}` : ''}
                  </div>
                </div>
                <div
                  className={`shrink-0 font-bold ${
                    t.type === 'expense' ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >
                  {t.type === 'expense' ? '-' : '+'}
                  {formatMoney(Number(t.amount), t.currency)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
