import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  cancelInvite,
  createHousehold,
  deleteHousehold,
  fetchHouseholdInvites,
  fetchHouseholdMembers,
  fetchMyHousehold,
  fetchTransactionsByMonth,
  inviteToHousehold,
  removeHouseholdMember,
} from '../lib/api'
import { netArs } from '../lib/amounts'
import { currentMonth, formatMoney, formatMonth } from '../lib/format'
import type { Household as HouseholdType, HouseholdInvite, HouseholdMember } from '../types'

/**
 * Modo hogar: dos o más personas comparten el mismo tracker. Cada movimiento
 * guarda quién lo cargó, así que se puede ver cuánto puso cada uno y quién le
 * debe a quién para emparejar.
 */
export default function Household() {
  const { user } = useAuth()
  const [household, setHousehold] = useState<HouseholdType | null>(null)
  const [members, setMembers] = useState<HouseholdMember[]>([])
  const [invites, setInvites] = useState<HouseholdInvite[]>([])
  const [spentByUser, setSpentByUser] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('Nuestro hogar')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const month = currentMonth()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const h = await fetchMyHousehold()
      setHousehold(h)
      if (h) {
        const [m, i, txs] = await Promise.all([
          fetchHouseholdMembers(h.id),
          fetchHouseholdInvites(h.id).catch(() => []),
          fetchTransactionsByMonth(month),
        ])
        setMembers(m)
        setInvites(i)

        // Gasto del mes por persona (en ARS, para poder compararlos).
        const acc: Record<string, number> = {}
        for (const t of txs) {
          if (t.is_transfer || t.type !== 'expense') continue
          acc[t.user_id] = (acc[t.user_id] ?? 0) + netArs(t)
        }
        setSpentByUser(acc)
      } else {
        setMembers([])
        setInvites([])
        setSpentByUser({})
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => {
    void load()
  }, [load])

  const isOwner = household?.owner_id === user?.id

  /** Cuánto puso cada uno vs. lo que le tocaría si se divide en partes iguales. */
  const balances = useMemo(() => {
    if (members.length < 2) return []
    const total = members.reduce((s, m) => s + (spentByUser[m.user_id] ?? 0), 0)
    const share = total / members.length
    return members
      .map((m) => ({
        member: m,
        spent: spentByUser[m.user_id] ?? 0,
        diff: (spentByUser[m.user_id] ?? 0) - share,
      }))
      .sort((a, b) => b.diff - a.diff)
  }, [members, spentByUser])

  async function crear() {
    if (!user || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await createHousehold(name.trim(), user.id)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function invitar() {
    if (!user || !household || !email.trim()) return
    setBusy(true)
    setError(null)
    try {
      await inviteToHousehold(household.id, email, user.id)
      setEmail('')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function quitar(m: HouseholdMember) {
    if (!household) return
    const yo = m.user_id === user?.id
    const texto = yo
      ? '¿Salir del hogar? Vas a dejar de ver los movimientos de los demás.'
      : `¿Sacar a ${m.email ?? 'esta persona'} del hogar?`
    if (!confirm(texto)) return
    await removeHouseholdMember(household.id, m.user_id)
    await load()
  }

  async function disolver() {
    if (!household) return
    if (
      !confirm(
        'Se disuelve el hogar y cada uno vuelve a ver solo sus propios datos. ' +
          'No se borra ningún movimiento. ¿Seguir?',
      )
    )
      return
    await deleteHousehold(household.id)
    await load()
  }

  if (loading) return <p className="text-slate-400">Cargando…</p>

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-white">Modo hogar</h1>

      {error && (
        <p className="card mb-4 border border-red-500/30 text-sm text-red-400">
          {error}
        </p>
      )}

      {!household ? (
        <>
          <div className="card mb-4">
            <p className="text-sm text-slate-300">
              Creá un hogar para compartir el tracker con otra persona. Los dos
              ven los mismos movimientos, cuentas y categorías, y queda
              registrado quién cargó cada gasto.
            </p>
          </div>
          <div className="card space-y-3">
            <div>
              <label className="label">Nombre del hogar</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Casa"
              />
            </div>
            <button
              onClick={crear}
              disabled={busy || !name.trim()}
              className="btn-primary w-full disabled:opacity-50"
            >
              {busy ? 'Creando…' : 'Crear hogar'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="card mb-4">
            <div className="text-sm text-slate-400">Hogar</div>
            <div className="text-lg font-semibold text-slate-100">
              {household.name}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {members.length} miembro{members.length === 1 ? '' : 's'}
              {isOwner ? ' · sos el administrador' : ''}
            </div>
          </div>

          <section className="mb-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-300">
              👥 Miembros
            </h2>
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.user_id} className="card flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/20 text-lg">
                    {m.role === 'owner' ? '👑' : '🙂'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-100">
                      {m.email ?? 'Sin email'}
                      {m.user_id === user?.id ? ' (vos)' : ''}
                    </div>
                    <div className="text-xs text-slate-400">
                      Gastó {formatMoney(spentByUser[m.user_id] ?? 0)} este mes
                    </div>
                  </div>
                  {(isOwner || m.user_id === user?.id) && (
                    <button
                      onClick={() => quitar(m)}
                      className="shrink-0 px-2 text-red-400"
                      aria-label="Quitar del hogar"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {balances.length >= 2 && (
            <section className="mb-4">
              <h2 className="mb-2 text-sm font-semibold text-slate-300">
                ⚖️ Quién debe a quién · <span className="capitalize">{formatMonth(month)}</span>
              </h2>
              <div className="card space-y-2">
                {balances.map(({ member, spent, diff }) => (
                  <div
                    key={member.user_id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate text-slate-300">
                      {member.email ?? 'Sin email'}
                    </span>
                    <span className="mx-2 text-xs text-slate-500">
                      {formatMoney(spent)}
                    </span>
                    <span
                      className={`font-semibold ${
                        diff > 0 ? 'text-emerald-400' : diff < 0 ? 'text-red-400' : 'text-slate-400'
                      }`}
                    >
                      {diff > 0
                        ? `le deben ${formatMoney(diff)}`
                        : diff < 0
                          ? `debe ${formatMoney(-diff)}`
                          : 'al día'}
                    </span>
                  </div>
                ))}
                <p className="border-t border-white/5 pt-2 text-xs text-slate-500">
                  Calculado dividiendo el gasto total del mes en partes iguales.
                </p>
              </div>
            </section>
          )}

          {isOwner && (
            <section className="mb-4">
              <h2 className="mb-2 text-sm font-semibold text-slate-300">
                ✉️ Invitar
              </h2>
              <div className="card space-y-3">
                <div className="flex gap-2">
                  <input
                    className="input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@ejemplo.com"
                  />
                  <button
                    onClick={invitar}
                    disabled={busy || !email.trim()}
                    className="btn-primary px-4 disabled:opacity-50"
                  >
                    Invitar
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  La persona tiene que tener cuenta en la app con ese mismo
                  email. Entra al hogar sola la próxima vez que inicie sesión.
                </p>

                {invites.length > 0 && (
                  <div className="space-y-2 border-t border-white/5 pt-3">
                    <div className="text-xs font-medium text-slate-400">
                      Invitaciones pendientes
                    </div>
                    {invites.map((i) => (
                      <div
                        key={i.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="truncate text-slate-300">{i.email}</span>
                        <button
                          onClick={async () => {
                            await cancelInvite(i.id)
                            await load()
                          }}
                          className="shrink-0 px-2 text-red-400"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {isOwner && (
            <button
              onClick={disolver}
              className="btn w-full bg-red-500/20 text-red-400"
            >
              Disolver el hogar
            </button>
          )}
        </>
      )}

      <Link
        to="/ajustes"
        className="mt-6 block text-center text-sm text-slate-500"
      >
        ‹ Volver a Ajustes
      </Link>
    </div>
  )
}
