import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { fetchNetWorthSeries } from '../lib/api'
import { formatMoney, formatMoneyShort, toArs } from '../lib/format'
import type { NetWorthPoint } from '../types'

/**
 * Patrimonio neto mes a mes: la suma de los saldos de todas las cuentas al
 * cierre de cada mes, normalizada a ARS. Las tarjetas suman en negativo, así
 * que la deuda ya está descontada.
 */
export default function NetWorth() {
  const [points, setPoints] = useState<NetWorthPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [months, setMonths] = useState(12)

  useEffect(() => {
    let cancel = false
    setLoading(true)
    setError(null)
    fetchNetWorthSeries(months)
      .then((d) => !cancel && setPoints(d))
      .catch((e) => !cancel && setError((e as Error).message))
      .finally(() => !cancel && setLoading(false))
    return () => {
      cancel = true
    }
  }, [months])

  const data = useMemo(() => {
    // El RPC devuelve una fila por mes y moneda; las juntamos en ARS.
    const byMonth = new Map<string, number>()
    for (const p of points) {
      const ars = toArs(Number(p.balance), p.currency)
      byMonth.set(p.month, (byMonth.get(p.month) ?? 0) + ars)
    }
    return [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, total]) => ({
        month,
        label: format(parseISO(month), 'MMM yy', { locale: es }),
        total,
      }))
  }, [points])

  const stats = useMemo(() => {
    if (data.length === 0) return null
    const current = data[data.length - 1].total
    const previous = data.length > 1 ? data[data.length - 2].total : null
    const first = data[0].total
    const deltaMes = previous == null ? null : current - previous
    const deltaPeriodo = current - first
    return { current, deltaMes, deltaPeriodo }
  }, [data])

  /** Reparto actual por moneda, tomando el último punto de la serie. */
  const porMoneda = useMemo(() => {
    if (points.length === 0) return []
    const lastMonth = points.reduce(
      (max, p) => (p.month > max ? p.month : max),
      points[0].month,
    )
    return points
      .filter((p) => p.month === lastMonth && Number(p.balance) !== 0)
      .map((p) => ({
        currency: p.currency,
        raw: Number(p.balance),
        ars: toArs(Number(p.balance), p.currency),
      }))
      .sort((a, b) => b.ars - a.ars)
  }, [points])

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-white">Patrimonio</h1>

      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : error ? (
        <div className="card border border-amber-500/30">
          <p className="text-sm text-amber-400">
            No se pudo calcular el patrimonio.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Si es la primera vez, corré de nuevo <code>supabase/schema.sql</code>{' '}
            para crear la función <code>net_worth_series</code>.
          </p>
          <p className="mt-2 text-xs text-slate-600">{error}</p>
        </div>
      ) : data.length === 0 ? (
        <p className="py-8 text-center text-slate-500">
          Todavía no hay cuentas para calcular el patrimonio.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="card bg-gradient-to-br from-brand to-brand-dark">
            <div className="text-sm text-white/80">Patrimonio neto hoy</div>
            <div className="text-4xl font-bold text-white">
              {formatMoney(stats!.current)}
            </div>
            {stats!.deltaMes != null && (
              <div className="mt-2 text-sm text-white/80">
                {stats!.deltaMes >= 0 ? '▲' : '▼'}{' '}
                {formatMoney(Math.abs(stats!.deltaMes))} vs. el mes pasado
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {[12, 24].map((n) => (
              <button
                key={n}
                onClick={() => setMonths(n)}
                className={`btn py-2 text-sm ${
                  months === n
                    ? 'bg-brand text-white'
                    : 'bg-slate-700/60 text-slate-300'
                }`}
              >
                Últimos {n} meses
              </button>
            ))}
          </div>

          <section className="card">
            <h2 className="mb-2 font-semibold text-slate-200">Evolución</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="label"
                    stroke="#94a3b8"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    fontSize={11}
                    width={52}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => formatMoneyShort(v)}
                  />
                  <Tooltip
                    formatter={(v: number) => formatMoney(v)}
                    labelFormatter={(l) => String(l)}
                    contentStyle={{
                      background: '#1e293b',
                      border: 'none',
                      borderRadius: 12,
                      color: '#fff',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fill="url(#nw)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Cambio en {months} meses:{' '}
              <span
                className={
                  stats!.deltaPeriodo >= 0 ? 'text-emerald-400' : 'text-red-400'
                }
              >
                {stats!.deltaPeriodo >= 0 ? '+' : '−'}
                {formatMoney(Math.abs(stats!.deltaPeriodo))}
              </span>
            </p>
          </section>

          {porMoneda.length > 0 && (
            <section className="card">
              <h2 className="mb-3 font-semibold text-slate-200">Por moneda</h2>
              <div className="space-y-2">
                {porMoneda.map((m) => (
                  <div
                    key={m.currency}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-slate-300">{m.currency}</span>
                    <span className="text-slate-400">
                      {formatMoney(m.raw, m.currency)}
                      {m.currency !== 'ARS' && (
                        <span className="ml-2 text-xs text-slate-500">
                          ≈ {formatMoney(m.ars)}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
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
