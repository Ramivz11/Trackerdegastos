import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { isSupabaseConfigured } from '../lib/supabase'

export default function Login() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setLoading(true)
    try {
      const fn = mode === 'in' ? signIn : signUp
      const { error } = await fn(email.trim(), password)
      if (error) {
        setError(traducir(error))
      } else if (mode === 'up') {
        setInfo(
          'Cuenta creada. Si tu proyecto pide confirmar email, revisá tu correo; si no, ya podés iniciar sesión.',
        )
        setMode('in')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-3xl">
            💸
          </div>
          <h1 className="text-2xl font-bold text-white">Tracker de Gastos</h1>
          <p className="mt-1 text-sm text-slate-400">
            {mode === 'in' ? 'Iniciá sesión para continuar' : 'Creá tu cuenta'}
          </p>
        </div>

        {!isSupabaseConfigured && (
          <div className="mb-4 rounded-xl bg-amber-500/15 p-3 text-sm text-amber-300">
            Faltan las variables de entorno de Supabase. Configurá tu archivo
            <code className="mx-1">.env</code> (ver README) y recargá.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {info && <p className="text-sm text-emerald-400">{info}</p>}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full disabled:opacity-50"
          >
            {loading
              ? 'Cargando…'
              : mode === 'in'
                ? 'Iniciar sesión'
                : 'Crear cuenta'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          {mode === 'in' ? '¿No tenés cuenta?' : '¿Ya tenés cuenta?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'in' ? 'up' : 'in')
              setError(null)
              setInfo(null)
            }}
            className="font-semibold text-brand"
          >
            {mode === 'in' ? 'Registrate' : 'Iniciá sesión'}
          </button>
        </p>
      </div>
    </div>
  )
}

function traducir(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('invalid login')) return 'Email o contraseña incorrectos.'
  if (m.includes('already registered')) return 'Ese email ya está registrado.'
  if (m.includes('password')) return 'La contraseña debe tener al menos 6 caracteres.'
  if (m.includes('email')) return 'Revisá el email ingresado.'
  return msg
}
