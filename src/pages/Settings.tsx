import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getCurrency, setCurrency } from '../lib/format'

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

  function changeCurrency(code: string) {
    setCurrency(code)
    setCur(code)
    // Recarga para aplicar el formato de moneda en toda la app.
    window.location.reload()
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
