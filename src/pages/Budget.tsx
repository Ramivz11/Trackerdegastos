import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { useSettings } from '../context/SettingsContext'
import { fetchTransactionsRange, updateCategory } from '../lib/api'
import { buildBudgetLines, spentByMonthAndCategory, totalSpent } from '../lib/budget'
import {
  currentMonth,
  formatMoney,
  formatMonth,
  fromArs,
  getDisplayCurrency,
  monthRange,
  rateFor,
  shiftMonth,
} from '../lib/format'
import type { TransactionWithCategory } from '../types'

const HISTORY_MONTHS = 11

/**
 * Presupuesto: techo mensual global + límite por categoría con arrastre
 * (lo que sobra de un mes se suma al siguiente).
 */
export default function Budget() {
  const { categories, reloadCategories } = useData()
  const { settings, update } = useSettings()
  const [month, setMonth] = useState(currentMonth())
  const [txs, setTxs] = useState<TransactionWithCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [totalInput, setTotalInput] = useState('')
  const [savingTotal, setSavingTotal] = useState(false)

  // Traemos el mes actual más el histórico necesario para el arrastre, en una
  // sola consulta por rango.
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const start = monthRange(shiftMonth(month, -HISTORY_MONTHS)).start
      const end = monthRange(month).end
      setTxs(await fetchTransactionsRange(start, end))
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const t = settings?.monthly_budget_total
    setTotalInput(
      t != null && t > 0
        ? String(Math.round(fromArs(Number(t), getDisplayCurrency())))
        : '',
    )
  }, [settings?.monthly_budget_total])

  const spent = useMemo(() => spentByMonthAndCategory(txs), [txs])
  const lines = useMemo(
    () => buildBudgetLines(month, categories, spent, HISTORY_MONTHS),
    [month, categories, spent],
  )
  const gastado = useMemo(() => totalSpent(month, spent), [month, spent])
  const techo = settings?.monthly_budget_total ?? null

  async function guardarTecho() {
    const n = parseFloat(totalInput)
    setSavingTotal(true)
    try {
      // El input está en la moneda de visualización; guardamos en ARS.
      const ars = isNaN(n) || n <= 0 ? null : n * rateFor(getDisplayCurrency())
      await update({ monthly_budget_total: ars })
    } finally {
      setSavingTotal(false)
    }
  }

  async function toggleRollover(categoryId: string, next: boolean) {
    await updateCategory(categoryId, { rollover: next })
    await reloadCategories()
  }

  const ratioTotal = techo && techo > 0 ? gastado / techo : 0

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Presupuesto</h1>
        <div className="flex items-center gap-1 rounded-xl bg-slate-800/60 p-1">
          <button
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="rounded-lg px-2 py-1 text-slate-300"
            aria-label="Mes anterior"
          >
            ‹
          </button>
          <span className="min-w-[6.5rem] text-center text-xs font-semibold capitalize text-slate-100">
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

      {/* Techo mensual global */}
      <section className="card mb-4">
        <label className="label">Techo de gasto mensual (todas las categorías)</label>
        <div className="flex gap-2">
          <input
            className="input"
            type="number"
            inputMode="decimal"
            value={totalInput}
            onChange={(e) => setTotalInput(e.target.value)}
            placeholder="Sin techo"
          />
          <button
            onClick={guardarTecho}
            disabled={savingTotal}
            className="btn-primary px-4 disabled:opacity-50"
          >
            {savingTotal ? '…' : 'Guardar'}
          </button>
        </div>

        {techo && techo > 0 ? (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-slate-300">Gastado</span>
              <span
                className={ratioTotal >= 1 ? 'text-red-400' : 'text-slate-400'}
              >
                {formatMoney(gastado)} / {formatMoney(techo)}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-700">
              <div
                className={`h-full rounded-full ${
                  ratioTotal >= 1
                    ? 'bg-red-500'
                    : ratioTotal >= 0.8
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(ratioTotal * 100, 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {ratioTotal >= 1
                ? `Te pasaste ${formatMoney(gastado - techo)}`
                : `Te quedan ${formatMoney(techo - gastado)}`}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-500">
            Dejalo vacío si no querés un límite global. Se guarda en tu cuenta,
            así que vale para todos tus dispositivos.
          </p>
        )}
      </section>

      {/* Presupuesto por categoría */}
      <h2 className="mb-2 text-sm font-semibold text-slate-300">
        🏷️ Por categoría
      </h2>

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : lines.length === 0 ? (
        <div className="card text-center">
          <p className="text-slate-400">
            Ninguna categoría tiene presupuesto mensual.
          </p>
          <Link to="/categorias" className="mt-2 inline-block text-sm text-brand">
            Configurar categorías ›
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {lines.map((l) => {
            const over = l.ratio >= 1
            return (
              <div key={l.category.id} className="card">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-slate-200">
                    {l.category.icon} {l.category.name}
                  </span>
                  <span className={over ? 'text-red-400' : 'text-slate-400'}>
                    {formatMoney(l.spent)} / {formatMoney(l.limit)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className={`h-full rounded-full ${
                      over
                        ? 'bg-red-500'
                        : l.ratio >= 0.8
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(l.ratio * 100, 100)}%` }}
                  />
                </div>

                <div className="mt-2 flex items-center justify-between">
                  <div className="text-xs">
                    {l.category.rollover && l.carry !== 0 ? (
                      <span
                        className={
                          l.carry > 0 ? 'text-emerald-400' : 'text-amber-400'
                        }
                      >
                        {l.carry > 0 ? 'Arrastra +' : 'Arrastra −'}
                        {formatMoney(Math.abs(l.carry))} sobre{' '}
                        {formatMoney(l.budget)}
                      </span>
                    ) : (
                      <span className="text-slate-500">
                        Límite base {formatMoney(l.budget)}
                      </span>
                    )}
                  </div>

                  <label className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
                    Arrastrar
                    <button
                      type="button"
                      onClick={() =>
                        toggleRollover(l.category.id, !l.category.rollover)
                      }
                      aria-label="Activar arrastre de presupuesto"
                      className={`h-5 w-9 rounded-full p-0.5 transition ${
                        l.category.rollover ? 'bg-emerald-500' : 'bg-slate-600'
                      }`}
                    >
                      <span
                        className={`block h-4 w-4 rounded-full bg-white transition ${
                          l.category.rollover ? 'translate-x-4' : ''
                        }`}
                      />
                    </button>
                  </label>
                </div>
              </div>
            )
          })}
          <p className="pt-2 text-center text-xs text-slate-500">
            Con el arrastre activado, lo que sobra de un mes se suma al límite
            del siguiente (y lo que te pasás, se resta).
          </p>
        </div>
      )}

      <Link
        to="/reportes"
        className="mt-6 block text-center text-sm text-slate-500"
      >
        ‹ Volver a Reportes
      </Link>
    </div>
  )
}
