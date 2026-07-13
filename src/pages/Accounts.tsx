import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../components/Modal'
import IconColorPicker from '../components/IconColorPicker'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import {
  createAccount,
  createTransaction,
  createTransfer,
  deleteAccount,
  deleteTransfer,
  fetchAccountBalances,
  fetchTransactionsByAccount,
  fetchTransfers,
  updateAccount,
} from '../lib/api'
import { formatDate, formatMoney, getUsdRate, rateFor, todayISO } from '../lib/format'
import { openCycleTotal } from '../lib/statements'
import type { Account, AccountType, Currency, Transfer } from '../types'

const ACCOUNT_ICONS = ['💵', '🏦', '💳', '🪙', '📱', '💰', '🐷', '🟠', '💜', '🔵', '🟢']
const TYPE_LABEL: Record<AccountType, string> = {
  cash: 'Efectivo',
  bank: 'Banco',
  card: 'Tarjeta',
}

export default function Accounts() {
  const { accounts, reloadAccounts, loadingAccounts } = useData()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [balances, setBalances] = useState<Record<string, number>>({})
  // Deuda del ciclo abierto de cada tarjeta (lo que mostramos como su "saldo").
  const [cardDebt, setCardDebt] = useState<Record<string, number>>({})
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [bal, tr] = await Promise.all([fetchAccountBalances(), fetchTransfers()])
      setBalances(Object.fromEntries(bal.map((b) => [b.account_id, Number(b.balance)])))
      setTransfers(tr)

      // Para las tarjetas, el "saldo" es la deuda del ciclo abierto.
      const cards = accounts.filter((a) => a.type === 'card')
      const today = todayISO()
      const debts = await Promise.all(
        cards.map(async (c) => {
          const txs = await fetchTransactionsByAccount(c.id)
          return [c.id, openCycleTotal(c, txs, today)] as const
        }),
      )
      setCardDebt(Object.fromEntries(debts))
    } finally {
      setLoading(false)
    }
  }, [accounts])

  useEffect(() => {
    void load()
  }, [load])

  const accountsById = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a])),
    [accounts],
  )

  // Total en ARS (convierte las cuentas en USD con la cotización actual). Las
  // tarjetas no suman: representan deuda, no plata disponible.
  const totalArs = useMemo(() => {
    const rate = getUsdRate()
    return accounts.reduce((sum, a) => {
      if (a.type === 'card') return sum
      const bal = balances[a.id] ?? a.initial_balance
      return sum + (a.currency === 'USD' ? bal * rate : bal)
    }, 0)
  }, [accounts, balances])

  // ----- Modal de cuenta -----
  const [accOpen, setAccOpen] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState(ACCOUNT_ICONS[0])
  const [color, setColor] = useState('#22c55e')
  const [type, setType] = useState<AccountType>('bank')
  const [currency, setCur] = useState<Currency>('ARS')
  const [initial, setInitial] = useState('')
  const [closingDay, setClosingDay] = useState('')
  const [dueDay, setDueDay] = useState('')
  const [savingAcc, setSavingAcc] = useState(false)

  function openNewAcc() {
    setEditing(null)
    setName('')
    setIcon(ACCOUNT_ICONS[1])
    setColor('#6366f1')
    setType('bank')
    setCur('ARS')
    setInitial('')
    setClosingDay('')
    setDueDay('')
    setAccOpen(true)
  }

  function openEditAcc(a: Account) {
    setEditing(a)
    setName(a.name)
    setIcon(a.icon)
    setColor(a.color)
    setType(a.type)
    setCur(a.currency)
    setInitial(String(a.initial_balance))
    setClosingDay(a.closing_day != null ? String(a.closing_day) : '')
    setDueDay(a.due_day != null ? String(a.due_day) : '')
    setAccOpen(true)
  }

  async function saveAcc() {
    if (!user || !name.trim()) return
    setSavingAcc(true)
    try {
      const payload = {
        name: name.trim(),
        icon,
        color,
        type,
        currency,
        initial_balance: initial ? parseFloat(initial) : 0,
        sort_order: editing?.sort_order ?? accounts.length,
        closing_day: type === 'card' && closingDay ? parseInt(closingDay, 10) : null,
        due_day: type === 'card' && dueDay ? parseInt(dueDay, 10) : null,
      }
      if (editing) await updateAccount(editing.id, payload)
      else await createAccount(payload, user.id)
      setAccOpen(false)
      await reloadAccounts()
      await load()
    } finally {
      setSavingAcc(false)
    }
  }

  async function removeAcc(a: Account) {
    if (
      !confirm(
        `¿Eliminar la cuenta "${a.name}"? Los movimientos y transferencias asociados se borran o quedan sin cuenta.`,
      )
    )
      return
    await deleteAccount(a.id)
    await reloadAccounts()
    await load()
  }

  // ----- Modal de transferencia -----
  const [trOpen, setTrOpen] = useState(false)
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [trDate, setTrDate] = useState(todayISO())
  const [trNote, setTrNote] = useState('')
  const [savingTr, setSavingTr] = useState(false)

  const fromAcc = accountsById[fromId]
  const toAcc = accountsById[toId]
  const crossCurrency = fromAcc && toAcc && fromAcc.currency !== toAcc.currency

  function openTransfer() {
    setFromId(accounts[0]?.id ?? '')
    setToId(accounts[1]?.id ?? accounts[0]?.id ?? '')
    setAmount('')
    setToAmount('')
    setTrDate(todayISO())
    setTrNote('')
    setTrOpen(true)
  }

  // Sugerencia de monto de destino cuando cambian de moneda.
  function onAmountChange(v: string) {
    setAmount(v)
    if (crossCurrency && fromAcc && toAcc) {
      const n = parseFloat(v)
      if (!isNaN(n)) {
        const rate = getUsdRate()
        const converted =
          fromAcc.currency === 'USD' ? n * rate : n / rate // USD→ARS o ARS→USD
        setToAmount(converted ? String(Math.round(converted * 100) / 100) : '')
      }
    }
  }

  async function saveTransfer() {
    if (!user || !fromId || !toId || fromId === toId) return
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) return
    const toAmt = crossCurrency ? parseFloat(toAmount) : amt
    if (isNaN(toAmt) || toAmt <= 0) return
    setSavingTr(true)
    try {
      await createTransfer(
        {
          from_account_id: fromId,
          to_account_id: toId,
          amount: amt,
          to_amount: toAmt,
          description: trNote.trim() || null,
          transfer_date: trDate,
        },
        user.id,
      )
      setTrOpen(false)
      await load()
    } finally {
      setSavingTr(false)
    }
  }

  async function removeTransfer(t: Transfer) {
    if (!confirm('¿Eliminar esta transferencia?')) return
    await deleteTransfer(t.id)
    await load()
  }

  // ----- Modal de conciliación de saldo -----
  const [recAcc, setRecAcc] = useState<Account | null>(null)
  const [realBalance, setRealBalance] = useState('')
  const [recDate, setRecDate] = useState(todayISO())
  const [savingRec, setSavingRec] = useState(false)

  const recCurrent = recAcc ? (balances[recAcc.id] ?? recAcc.initial_balance) : 0
  const recReal = parseFloat(realBalance)
  const recDiff = isNaN(recReal) ? 0 : Math.round((recReal - recCurrent) * 100) / 100

  function openReconcile(a: Account) {
    setRecAcc(a)
    setRealBalance('')
    setRecDate(todayISO())
  }

  async function saveReconcile() {
    if (!user || !recAcc || isNaN(recReal)) return
    if (recDiff === 0) {
      setRecAcc(null)
      return
    }
    setSavingRec(true)
    try {
      await createTransaction(
        {
          category_id: null,
          account_id: recAcc.id,
          amount: Math.abs(recDiff),
          currency: recAcc.currency,
          ars_rate: rateFor(recAcc.currency),
          description: 'Ajuste de saldo (conciliación)',
          transaction_date: recDate,
          type: recDiff > 0 ? 'income' : 'expense',
        },
        user.id,
      )
      setRecAcc(null)
      await load()
    } finally {
      setSavingRec(false)
    }
  }

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Cuentas</h1>
        <button onClick={openNewAcc} className="btn-primary px-3 py-2 text-sm">
          + Nueva
        </button>
      </header>

      {/* Total */}
      <div className="card mb-4 bg-gradient-to-br from-brand to-brand-dark">
        <div className="text-sm text-white/80">Saldo total (en pesos)</div>
        <div className="text-3xl font-bold text-white">{formatMoney(totalArs, 'ARS')}</div>
        {accounts.some((a) => a.currency === 'USD') && (
          <div className="mt-1 text-xs text-white/70">
            Dólar a {formatMoney(getUsdRate(), 'ARS')} · ajustable en Ajustes
          </div>
        )}
      </div>

      {loadingAccounts || loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : (
        <>
          {/* Lista de cuentas */}
          <div className="space-y-2">
            {accounts.length === 0 ? (
              <p className="card text-sm text-slate-500">
                No tenés cuentas. Creá una con “+ Nueva”.
              </p>
            ) : (
              accounts.map((a) => {
                const isCard = a.type === 'card'
                const bal = isCard
                  ? (cardDebt[a.id] ?? 0)
                  : (balances[a.id] ?? a.initial_balance)
                return (
                  <div key={a.id} className="card flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        isCard ? navigate(`/tarjetas/${a.id}`) : openEditAcc(a)
                      }
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl"
                        style={{ backgroundColor: a.color + '33' }}
                      >
                        {a.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-slate-100">
                          {a.name}
                        </div>
                        <div className="text-xs text-slate-400">
                          {isCard && a.closing_day
                            ? `Tarjeta · cierra el ${a.closing_day} · ver resúmenes ›`
                            : `${TYPE_LABEL[a.type]} · ${a.currency}`}
                        </div>
                      </div>
                      <div
                        className={`shrink-0 text-right font-bold ${
                          isCard
                            ? bal > 0
                              ? 'text-orange-400'
                              : 'text-slate-400'
                            : bal < 0
                              ? 'text-red-400'
                              : 'text-slate-100'
                        }`}
                      >
                        {formatMoney(bal, a.currency)}
                        {isCard && (
                          <div className="text-[10px] font-normal text-slate-500">
                            ciclo actual
                          </div>
                        )}
                      </div>
                    </button>
                    {!isCard && (
                      <button
                        onClick={() => openReconcile(a)}
                        title="Conciliar saldo"
                        className="rounded-lg px-1 py-1 text-slate-400 hover:text-slate-100"
                      >
                        ⚖️
                      </button>
                    )}
                    <button
                      onClick={() => openEditAcc(a)}
                      className="rounded-lg px-1 py-1 text-slate-400 hover:text-slate-100"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => removeAcc(a)}
                      className="rounded-lg px-1 py-1 text-slate-400 hover:text-red-400"
                    >
                      🗑️
                    </button>
                  </div>
                )
              })
            )}
          </div>

          {accounts.length >= 2 && (
            <button
              onClick={openTransfer}
              className="btn-ghost mt-4 w-full"
            >
              ⇄ Transferir entre cuentas
            </button>
          )}

          {/* Transferencias recientes */}
          {transfers.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-sm font-semibold text-slate-300">
                Transferencias
              </h2>
              <div className="space-y-2">
                {transfers.map((t) => {
                  const from = accountsById[t.from_account_id]
                  const to = accountsById[t.to_account_id]
                  const cross =
                    from && to && from.currency !== to.currency
                  return (
                    <div key={t.id} className="card flex items-center gap-3">
                      <span className="text-lg">⇄</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-100">
                          {from?.name ?? '—'} → {to?.name ?? '—'}
                        </div>
                        <div className="text-xs text-slate-400">
                          {formatDate(t.transfer_date)}
                          {t.description ? ` · ${t.description}` : ''}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-sm text-slate-200">
                        {formatMoney(Number(t.amount), from?.currency ?? 'ARS')}
                        {cross && (
                          <div className="text-xs text-slate-400">
                            → {formatMoney(Number(t.to_amount), to?.currency ?? 'ARS')}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => removeTransfer(t)}
                        className="rounded-lg px-1 py-1 text-slate-400 hover:text-red-400"
                      >
                        🗑️
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}

      {/* ----- Modal cuenta ----- */}
      <Modal
        open={accOpen}
        onClose={() => setAccOpen(false)}
        title={editing ? 'Editar cuenta' : 'Nueva cuenta'}
      >
        <div className="space-y-4">
          <div>
            <label className="label">Nombre</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: BBVA, Naranja X, Brubank"
            />
          </div>

          <div>
            <label className="label">Tipo</label>
            <div className="grid grid-cols-3 gap-2">
              {(['cash', 'bank', 'card'] as AccountType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`btn py-2 text-sm ${
                    type === t ? 'bg-brand text-white' : 'bg-slate-700/60 text-slate-300'
                  }`}
                >
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          {type === 'card' && (
            <div className="rounded-xl bg-slate-800/60 p-3">
              <p className="mb-2 text-xs font-medium text-slate-400">
                Tarjeta de crédito
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Día de cierre</label>
                  <input
                    className="input"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={31}
                    value={closingDay}
                    onChange={(e) => setClosingDay(e.target.value)}
                    placeholder="28"
                  />
                </div>
                <div>
                  <label className="label">Día de vencimiento</label>
                  <input
                    className="input"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={31}
                    value={dueDay}
                    onChange={(e) => setDueDay(e.target.value)}
                    placeholder="10"
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                El resumen junta los gastos del ciclo (ej: del 29 al 28) y vence el
                día que indiques del mes siguiente.
              </p>
            </div>
          )}

          <div>
            <label className="label">Moneda</label>
            <div className="grid grid-cols-2 gap-2">
              {(['ARS', 'USD'] as Currency[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCur(c)}
                  className={`btn py-2 text-sm ${
                    currency === c ? 'bg-brand text-white' : 'bg-slate-700/60 text-slate-300'
                  }`}
                >
                  {c === 'ARS' ? 'Pesos (ARS)' : 'Dólares (USD)'}
                </button>
              ))}
            </div>
          </div>

          {type !== 'card' && (
            <div>
              <label className="label">Saldo actual (inicial)</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={initial}
                onChange={(e) => setInitial(e.target.value)}
                placeholder="0"
              />
              <p className="mt-1 text-xs text-slate-500">
                El saldo que tenés hoy en esta cuenta. Después se ajusta solo con tus
                movimientos y transferencias.
              </p>
            </div>
          )}

          <IconColorPicker
            icon={icon}
            color={color}
            onIcon={setIcon}
            onColor={setColor}
            icons={ACCOUNT_ICONS}
          />

          <div className="flex gap-2">
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setAccOpen(false)
                  removeAcc(editing)
                }}
                className="btn bg-red-500/20 text-red-400"
              >
                Borrar
              </button>
            )}
            <button
              onClick={saveAcc}
              disabled={savingAcc || !name.trim()}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {savingAcc ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ----- Modal transferencia ----- */}
      <Modal
        open={trOpen}
        onClose={() => setTrOpen(false)}
        title="Transferir entre cuentas"
      >
        <div className="space-y-4">
          <div>
            <label className="label">Desde</label>
            <select
              className="input"
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.icon} {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Hacia</label>
            <select
              className="input"
              value={toId}
              onChange={(e) => setToId(e.target.value)}
            >
              {accounts
                .filter((a) => a.id !== fromId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.icon} {a.name} ({a.currency})
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="label">
              Monto {fromAcc ? `(${fromAcc.currency})` : ''}
            </label>
            <input
              className="input text-2xl font-bold"
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              placeholder="0"
            />
          </div>

          {crossCurrency && (
            <div>
              <label className="label">
                Se acredita en destino ({toAcc?.currency})
              </label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={toAmount}
                onChange={(e) => setToAmount(e.target.value)}
                placeholder="0"
              />
              <p className="mt-1 text-xs text-slate-500">
                Como cambian de moneda, ingresá cuánto entra realmente (ej: comprar
                dólares). Sugerido con el dólar a {formatMoney(getUsdRate(), 'ARS')}.
              </p>
            </div>
          )}

          <div>
            <label className="label">Fecha</label>
            <input
              className="input"
              type="date"
              value={trDate}
              onChange={(e) => setTrDate(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Nota (opcional)</label>
            <input
              className="input"
              value={trNote}
              onChange={(e) => setTrNote(e.target.value)}
              placeholder="Ej: Compra de dólares"
            />
          </div>

          <button
            onClick={saveTransfer}
            disabled={savingTr || !amount || fromId === toId}
            className="btn-primary w-full disabled:opacity-50"
          >
            {savingTr ? 'Guardando…' : 'Transferir'}
          </button>
        </div>
      </Modal>

      {/* ----- Modal conciliación de saldo ----- */}
      <Modal
        open={recAcc !== null}
        onClose={() => setRecAcc(null)}
        title="Conciliar saldo"
      >
        {recAcc && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-800/60 p-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">{recAcc.icon}</span>
                <span className="font-semibold text-slate-100">{recAcc.name}</span>
              </div>
              <div className="mt-2 text-sm text-slate-400">
                Saldo según la app:{' '}
                <span className="font-semibold text-slate-200">
                  {formatMoney(recCurrent, recAcc.currency)}
                </span>
              </div>
            </div>

            <div>
              <label className="label">Saldo real ({recAcc.currency})</label>
              <input
                className="input text-2xl font-bold"
                type="number"
                inputMode="decimal"
                value={realBalance}
                onChange={(e) => setRealBalance(e.target.value)}
                placeholder="0"
                autoFocus
              />
              <p className="mt-1 text-xs text-slate-500">
                El saldo que ves hoy en tu banco o billetera. Se crea un movimiento
                de ajuste por la diferencia.
              </p>
            </div>

            {!isNaN(recReal) && (
              <div
                className={`rounded-xl p-3 text-sm ${
                  recDiff === 0
                    ? 'bg-slate-800/60 text-slate-400'
                    : recDiff > 0
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-red-500/10 text-red-400'
                }`}
              >
                {recDiff === 0
                  ? 'Los saldos ya coinciden, no hace falta ajustar.'
                  : `Ajuste: ${recDiff > 0 ? '+' : '−'}${formatMoney(
                      Math.abs(recDiff),
                      recAcc.currency,
                    )} (${recDiff > 0 ? 'ingreso' : 'gasto'} de ajuste)`}
              </div>
            )}

            <div>
              <label className="label">Fecha del ajuste</label>
              <input
                className="input"
                type="date"
                value={recDate}
                onChange={(e) => setRecDate(e.target.value)}
              />
            </div>

            <button
              onClick={saveReconcile}
              disabled={savingRec || isNaN(recReal) || recDiff === 0}
              className="btn-primary w-full disabled:opacity-50"
            >
              {savingRec ? 'Guardando…' : 'Ajustar saldo'}
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
