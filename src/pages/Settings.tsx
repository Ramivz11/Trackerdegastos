import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { useSettings } from '../context/SettingsContext'
import { fetchFullBackup, fetchTransactionsRange } from '../lib/api'
import { downloadCsv, downloadJson, transactionsToCsv } from '../lib/export'
import {
  currentMonth,
  formatMoney,
  getDisplayCurrency,
  getRates,
  monthRange,
  shiftMonth,
  todayISO,
} from '../lib/format'
import { RATE_SOURCES } from '../lib/rates'
import {
  currentSubscription,
  disablePush,
  enablePush,
  pushSupported,
  testNotification,
} from '../lib/push'
import { CURRENCIES, type Currency, type RateSource } from '../types'

export default function Settings() {
  const { user, signOut } = useAuth()
  const { categoriesById, accountsById } = useData()
  const { settings, update, refreshRates } = useSettings()

  const [usdInput, setUsdInput] = useState(String(getRates().USD ?? 1000))
  const [savingRate, setSavingRate] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [rateMsg, setRateMsg] = useState<string | null>(null)

  const [pushOn, setPushOn] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushMsg, setPushMsg] = useState<string | null>(null)

  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)

  useEffect(() => {
    setUsdInput(String(getRates().USD ?? 1000))
  }, [settings?.rates])

  useEffect(() => {
    void currentSubscription().then((s) => setPushOn(!!s))
  }, [])

  const source: RateSource = settings?.rate_source ?? 'manual'
  const actualizado = settings?.rates_updated_at
    ? new Date(settings.rates_updated_at).toLocaleString('es-AR', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : null

  async function changeCurrency(code: Currency) {
    await update({ display_currency: code })
  }

  async function changeSource(next: RateSource) {
    setRateMsg(null)
    await update({ rate_source: next })
    if (next !== 'manual') {
      setRefreshing(true)
      const ok = await refreshRates()
      setRefreshing(false)
      setRateMsg(
        ok
          ? 'Cotizaciones actualizadas.'
          : 'No se pudieron traer las cotizaciones; seguimos con las guardadas.',
      )
    }
  }

  async function saveUsdRate() {
    const n = parseFloat(usdInput)
    if (!(n > 0)) return
    setSavingRate(true)
    try {
      await update({
        rates: { ...(settings?.rates ?? {}), USD: n },
        rate_source: 'manual',
        rates_updated_at: new Date().toISOString(),
      })
      setRateMsg('Cotización guardada.')
    } finally {
      setSavingRate(false)
    }
  }

  async function actualizarAhora() {
    setRefreshing(true)
    setRateMsg(null)
    const ok = await refreshRates()
    setRefreshing(false)
    setRateMsg(ok ? 'Cotizaciones actualizadas.' : 'No hubo cambios para traer.')
  }

  async function togglePush() {
    if (!user) return
    setPushBusy(true)
    setPushMsg(null)
    try {
      if (pushOn) {
        await disablePush()
        await update({ push_enabled: false })
        setPushOn(false)
        setPushMsg('Notificaciones desactivadas.')
      } else {
        const err = await enablePush(user.id)
        if (err) {
          setPushMsg(err)
        } else {
          await update({ push_enabled: true })
          setPushOn(true)
          setPushMsg('Listo: te vamos a avisar de los vencimientos.')
        }
      }
    } finally {
      setPushBusy(false)
    }
  }

  /** CSV de los últimos 12 meses. */
  async function exportarCsv() {
    setExporting(true)
    setExportMsg(null)
    try {
      const start = monthRange(shiftMonth(currentMonth(), -11)).start
      const txs = await fetchTransactionsRange(start, todayISO())
      if (txs.length === 0) {
        setExportMsg('No hay movimientos para exportar.')
        return
      }
      downloadCsv(
        `tracker-${todayISO()}.csv`,
        transactionsToCsv(txs, categoriesById, accountsById),
      )
      setExportMsg(`Exportados ${txs.length} movimientos.`)
    } catch (e) {
      setExportMsg(`No se pudo exportar: ${(e as Error).message}`)
    } finally {
      setExporting(false)
    }
  }

  /** Backup completo en JSON (todas las tablas). */
  async function exportarBackup() {
    setExporting(true)
    setExportMsg(null)
    try {
      const data = await fetchFullBackup()
      downloadJson(`tracker-backup-${todayISO()}.json`, {
        exportado: new Date().toISOString(),
        version: 2,
        datos: data,
      })
      setExportMsg('Backup descargado.')
    } catch (e) {
      setExportMsg(`No se pudo hacer el backup: ${(e as Error).message}`)
    } finally {
      setExporting(false)
    }
  }

  const links: [string, string, string][] = [
    ['/cuentas', '👛', 'Administrar cuentas'],
    ['/deudas', '🤝', 'Te deben (gastos compartidos)'],
    ['/metas', '🎯', 'Metas de ahorro'],
    ['/presupuesto', '📊', 'Presupuesto y arrastre'],
    ['/categorias', '🏷️', 'Administrar categorías'],
    ['/reglas', '🪄', 'Reglas de auto-categorización'],
    ['/hogar', '👥', 'Modo hogar (compartir)'],
    ['/patrimonio', '📈', 'Patrimonio en el tiempo'],
  ]

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-white">Ajustes</h1>

      <div className="space-y-4">
        <section className="card">
          <div className="text-sm text-slate-400">Sesión iniciada como</div>
          <div className="font-medium text-slate-100">{user?.email}</div>
        </section>

        {/* Moneda de visualización */}
        <section className="card">
          <label className="label">Mostrar los totales en</label>
          <select
            className="input"
            value={settings?.display_currency ?? getDisplayCurrency()}
            onChange={(e) => changeCurrency(e.target.value as Currency)}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Los movimientos se siguen guardando en su moneda original; esto solo
            cambia en qué moneda se muestran los totales, convertidos con las
            cotizaciones de abajo.
          </p>
        </section>

        {/* Cotizaciones */}
        <section className="card">
          <label className="label">Cotizaciones</label>
          <select
            className="input"
            value={source}
            onChange={(e) => changeSource(e.target.value as RateSource)}
          >
            {RATE_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          {source === 'manual' ? (
            <div className="mt-3">
              <label className="label">Cuántos pesos vale 1 dólar</label>
              <div className="flex gap-2">
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  value={usdInput}
                  onChange={(e) => setUsdInput(e.target.value)}
                  placeholder="Ej: 1450"
                />
                <button
                  onClick={saveUsdRate}
                  disabled={savingRate}
                  className="btn-primary px-4 disabled:opacity-50"
                >
                  {savingRate ? '…' : 'Guardar'}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-300">Dólar</span>
                <span className="font-semibold text-slate-100">
                  {formatMoney(getRates().USD ?? 0, 'ARS')}
                </span>
              </div>
              <button
                onClick={actualizarAhora}
                disabled={refreshing}
                className="btn-ghost w-full py-2 text-sm disabled:opacity-50"
              >
                {refreshing ? 'Actualizando…' : '↻ Actualizar ahora'}
              </button>
            </div>
          )}

          {actualizado && (
            <p className="mt-2 text-xs text-slate-500">
              Última actualización: {actualizado}
            </p>
          )}
          {rateMsg && <p className="mt-1 text-xs text-slate-400">{rateMsg}</p>}
          <p className="mt-2 text-xs text-slate-600">
            Automático: se traen de dolarapi.com una vez por día. Los pesos
            mexicano y colombiano no están en esa API y quedan siempre manuales.
          </p>
        </section>

        {/* Notificaciones push */}
        <section className="card">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="font-medium text-slate-100">
                Avisos de vencimiento
              </div>
              <div className="text-xs text-slate-400">
                Llegan aunque tengas la app cerrada
              </div>
            </div>
            <button
              onClick={togglePush}
              disabled={pushBusy || !pushSupported()}
              aria-label="Activar notificaciones"
              className={`h-7 w-12 shrink-0 rounded-full p-1 transition disabled:opacity-40 ${
                pushOn ? 'bg-emerald-500' : 'bg-slate-600'
              }`}
            >
              <span
                className={`block h-5 w-5 rounded-full bg-white transition ${
                  pushOn ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </div>

          {!pushSupported() && (
            <p className="text-xs text-slate-500">
              Tu navegador no soporta push, o falta configurar{' '}
              <code>VITE_VAPID_PUBLIC_KEY</code>. En iPhone hay que instalar la
              app en la pantalla de inicio primero.
            </p>
          )}
          {pushMsg && <p className="text-xs text-slate-400">{pushMsg}</p>}
          {pushOn && (
            <button
              onClick={() => testNotification()}
              className="mt-2 text-xs text-brand"
            >
              Enviar una notificación de prueba
            </button>
          )}
        </section>

        {/* Exportar */}
        <section className="card space-y-2">
          <div className="font-medium text-slate-100">Exportar mis datos</div>
          <button
            onClick={exportarCsv}
            disabled={exporting}
            className="btn-ghost w-full py-2 text-sm disabled:opacity-50"
          >
            ⬇ Movimientos del último año (CSV)
          </button>
          <button
            onClick={exportarBackup}
            disabled={exporting}
            className="btn-ghost w-full py-2 text-sm disabled:opacity-50"
          >
            ⬇ Backup completo (JSON)
          </button>
          {exportMsg && (
            <p className="text-xs text-slate-400">{exportMsg}</p>
          )}
          <p className="text-xs text-slate-600">
            El CSV se abre con doble clic en Excel. El JSON es una copia de
            seguridad de todas tus tablas.
          </p>
        </section>

        {/* Navegación */}
        <section className="card space-y-3">
          {links.map(([to, icon, label]) => (
            <Link
              key={to}
              to={to}
              className="flex items-center justify-between text-slate-100"
            >
              <span>
                {icon} {label}
              </span>
              <span className="text-slate-500">›</span>
            </Link>
          ))}
        </section>

        <button onClick={signOut} className="btn bg-red-500/20 w-full text-red-400">
          Cerrar sesión
        </button>

        <p className="pt-4 text-center text-xs text-slate-600">
          Tracker de Gastos · datos guardados en Supabase
        </p>
      </div>
    </div>
  )
}
