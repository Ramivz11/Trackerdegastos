import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  getCurrency,
  getUsdRate,
  setCurrency,
  setUsdRate,
} from '../lib/format'

const CURRENCIES = [
  { code: 'ARS', label: 'Peso argentino ($)' },
  { code: 'USD', label: 'Dólar (US$)' },
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'MXN', label: 'Peso mexicano ($)' },
  { code: 'CLP', label: 'Peso chileno ($)' },
  { code: 'COP', label: 'Peso colombiano ($)' },
  { code: 'UYU', label: 'Peso uruguayo ($)' },
  { code: 'BRL', label: 'Real (R$)' },
]

export default function Settings() {
  const { user, signOut } = useAuth()
  const [currency, setCur] = useState(getCurrency())
  const [usdRate, setRate] = useState(String(getUsdRate()))

  function changeCurrency(code: string) {
    setCurrency(code)
    setCur(code)
    // Recarga para aplicar el formato de moneda en toda la app.
    window.location.reload()
  }

  function saveUsdRate() {
    const n = parseFloat(usdRate)
    if (n > 0) {
      setUsdRate(n)
      setRate(String(n))
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-white">Ajustes</h1>

      <div className="space-y-4">
        <section className="card">
          <div className="text-sm text-slate-400">Sesión iniciada como</div>
          <div className="font-medium text-slate-100">{user?.email}</div>
        </section>

        <section className="card">
          <label className="label">Moneda</label>
          <select
            className="input"
            value={currency}
            onChange={(e) => changeCurrency(e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </section>

        <section className="card">
          <label className="label">Cotización del dólar (ARS por 1 USD)</label>
          <div className="flex gap-2">
            <input
              className="input"
              type="number"
              inputMode="decimal"
              value={usdRate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="Ej: 1000"
            />
            <button onClick={saveUsdRate} className="btn-primary px-4">
              Guardar
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Se usa para mostrar en pesos los montos y cuentas en dólares.
          </p>
        </section>

        <section className="card space-y-3">
          <Link
            to="/cuentas"
            className="flex items-center justify-between text-slate-100"
          >
            <span>👛 Administrar cuentas</span>
            <span className="text-slate-500">›</span>
          </Link>
          <Link
            to="/metas"
            className="flex items-center justify-between text-slate-100"
          >
            <span>🎯 Metas de ahorro</span>
            <span className="text-slate-500">›</span>
          </Link>
          <Link
            to="/categorias"
            className="flex items-center justify-between text-slate-100"
          >
            <span>🏷️ Administrar categorías</span>
            <span className="text-slate-500">›</span>
          </Link>
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
