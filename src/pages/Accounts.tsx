import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../components/Modal'
import IconColorPicker from '../components/IconColorPicker'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import {
  buyCurrency,
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
import {
  errorText,
  formatDate,
  formatMoney,
  getUsdRate,
  rateFor,
  todayISO,
} from '../lib/format'
import { openCycleTotals, type CurrencyTotal } from '../lib/statements'
import type { Account, AccountType, Currency, Transfer } from '../types'

const ACCOUNT_ICONS = ['💵', '🏦', '💳', '🪙', '📱', '💰', '🐷', '🟠', '💜', '🔵', '🟢']
const TYPE_LABEL: Record<AccountType, string> = {
  cash: 'Efectivo',
  bank: 'Banco',
  card: 'Tarjeta',
}

export default function Accounts() {
  const { accounts, categories, reloadAccounts, loadingAccounts } = useData()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [balances, setBalances] = useState<Record<string, number>>({})
  // Deuda del ciclo abierto de cada tarjeta (lo que mostramos como su "saldo"),
  // separada por moneda: una tarjeta en pesos puede tener consumos en dólares.
  const [cardDebt, setCardDebt] = useState<Record<string, CurrencyTotal[]>>({})
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
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
          return [c.id, openCycleTotals(c, txs, today)] as const
        }),
      )
      setCardDebt(Object.fromEntries(debts))
    } catch (e) {
      // Si falla el RPC de saldos, cada cuenta cae a su saldo inicial y parece
      // que los movimientos no se reflejan. Antes eso pasaba en silencio.
      setLoadError(errorText(e))
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
    setInitial(String(balances[a.id] ?? a.initial_balance))
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
        sort_order: editing?.sort_order ?? accounts.length,
        closing_day: type === 'card' && closingDay ? parseInt(closingDay, 10) : null,
        due_day: type === 'card' && dueDay ? parseInt(dueDay, 10) : null,
      }
      if (editing) {
        await updateAccount(editing.id, payload)
        // El campo "Saldo actual" edita el saldo de hoy, no el inicial: si
        // cambió, se crea un movimiento de ajuste por la diferencia.
        if (type !== 'card') {
          const newBalance = parseFloat(initial)
          const current = balances[editing.id] ?? editing.initial_balance
          const diff = !isNaN(newBalance)
            ? Math.round((newBalance - current) * 100) / 100
            : 0
          if (diff !== 0) {
            await createTransaction(
              {
                category_id: null,
                account_id: editing.id,
                amount: Math.abs(diff),
                currency: editing.currency,
                ars_rate: rateFor(editing.currency),
                description: 'Ajuste de saldo',
                transaction_date: todayISO(),
                type: diff > 0 ? 'income' : 'expense',
              },
              user.id,
            )
          }
        }
      } else {
        await createAccount(
          { ...payload, initial_balance: initial ? parseFloat(initial) : 0 },
          user.id,
        )
      }
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

  // ----- Modal de comprar moneda -----
  // Alcanza con tener una cuenta: si todavía no tenés una en la otra moneda,
  // se crea desde el mismo modal (si no, no habría forma de empezar a comprar).
  const expenseCategories = useMemo(
    () => categories.filter((c) => c.kind !== 'income'),
    [categories],
  )

  const [buyOpen, setBuyOpen] = useState(false)
  const [buyFromId, setBuyFromId] = useState('')
  const [buyToId, setBuyToId] = useState('')
  const [buyAmount, setBuyAmount] = useState('')
  const [buyReceived, setBuyReceived] = useState('')
  const [buyCategoryId, setBuyCategoryId] = useState('')
  const [buyDate, setBuyDate] = useState(todayISO())
  const [buyNote, setBuyNote] = useState('')
  const [savingBuy, setSavingBuy] = useState(false)
  const [buyError, setBuyError] = useState<string | null>(null)
  // Nombre de la cuenta a crear cuando el destino es "+ Crear cuenta nueva".
  const [buyNewName, setBuyNewName] = useState('')

  /** Valor de "Se acredita en" cuando todavía no tenés cuenta en esa moneda. */
  const NEW_ACCOUNT = '__new__'

  const buyFromAcc = accountsById[buyFromId]
  const buyToOptions = accounts.filter(
    (a) => a.id !== buyFromId && a.currency !== buyFromAcc?.currency,
  )
  const buyToAcc = accountsById[buyToId]
  const creatingBuyToAcc = buyToId === NEW_ACCOUNT
  /** La moneda que comprás: la de la cuenta destino, o la de la que vas a crear. */
  const buyToCurrency: Currency | null = creatingBuyToAcc
    ? buyFromAcc?.currency === 'USD'
      ? 'ARS'
      : 'USD'
    : (buyToAcc?.currency ?? null)

  function openBuyCurrency() {
    const from = accounts[0]?.id ?? ''
    const fromAcc = accountsById[from]
    const to = accounts.find((a) => a.id !== from && a.currency !== fromAcc?.currency)
    setBuyFromId(from)
    // Sin cuenta en la otra moneda, arranca directo en "crear una".
    setBuyToId(to?.id ?? NEW_ACCOUNT)
    setBuyNewName(fromAcc?.currency === 'USD' ? 'Pesos' : 'Dólares')
    setBuyAmount('')
    setBuyReceived('')
    const defaultCat =
      expenseCategories.find((c) => c.name === 'Compra de moneda') ?? expenseCategories[0]
    setBuyCategoryId(defaultCat?.id ?? '')
    setBuyDate(todayISO())
    setBuyNote('')
    setBuyError(null)
    setBuyOpen(true)
  }

  // Sugerencia de cuánto se acredita en destino según la cotización.
  function onBuyAmountChange(v: string) {
    setBuyAmount(v)
    if (buyFromAcc && buyToCurrency) {
      const n = parseFloat(v)
      if (!isNaN(n)) {
        const rate = getUsdRate()
        const converted =
          buyFromAcc.currency === 'USD' ? n * rate : n / rate // USD→ARS o ARS→USD
        setBuyReceived(converted ? String(Math.round(converted * 100) / 100) : '')
      }
    }
  }

  /**
   * Resumen en vivo de la compra: cuánto sale, cuánto se acredita y a qué tipo
   * de cambio. Sale de los dos montos tipeados, no de la cotización de Ajustes,
   * así ves el TC real de la operación aunque hayas retocado los números.
   */
  const buySummary = useMemo(() => {
    if (!buyFromAcc || !buyToCurrency) return null
    const spent = parseFloat(buyAmount)
    const received = parseFloat(buyReceived)
    if (!(spent > 0) || !(received > 0)) return null
    return { spent, received, rate: spent / received }
  }, [buyAmount, buyReceived, buyFromAcc, buyToCurrency])

  const canBuy =
    !!buySummary && (creatingBuyToAcc ? buyNewName.trim().length > 0 : !!buyToAcc)

  async function saveBuyCurrency() {
    if (!user || !buyFromAcc || !buyToCurrency || !buySummary || !canBuy) return
    const { spent, received, rate } = buySummary
    setSavingBuy(true)
    setBuyError(null)
    try {
      // Si todavía no tenías cuenta en la moneda que comprás, se crea ahora:
      // ahí quedan los dólares y desde ahí se puede pagar una tarjeta.
      const target = creatingBuyToAcc
        ? await createAccount(
            {
              name: buyNewName.trim(),
              icon: buyToCurrency === 'USD' ? '💵' : '🏦',
              color: '#22c55e',
              type: 'bank',
              currency: buyToCurrency,
              initial_balance: 0,
              sort_order: accounts.length,
            },
            user.id,
          )
        : buyToAcc

      await buyCurrency(
        {
          fromAccountId: buyFromAcc.id,
          toAccountId: target.id,
          fromCurrency: buyFromAcc.currency,
          toCurrency: target.currency,
          spentAmount: spent,
          receivedAmount: received,
          categoryId: buyCategoryId || null,
          date: buyDate,
          // Sin nota, la descripción deja el TC a la vista en el historial.
          description:
            buyNote.trim() ||
            `Compra ${formatMoney(received, target.currency)} a ${formatMoney(
              rate,
              buyFromAcc.currency,
            )}`,
        },
        user.id,
      )
      setBuyOpen(false)
      await reloadAccounts()
      await load()
    } catch (e) {
      // Sin esto la compra fallaba en silencio: el botón parecía no hacer nada.
      setBuyError(errorText(e))
    } finally {
      setSavingBuy(false)
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

      {loadError && (
        <div className="card mb-4 bg-red-500/10 text-sm text-red-300">
          <p className="font-semibold">No se pudieron calcular los saldos.</p>
          <p className="mt-1 break-words">{loadError}</p>
          <p className="mt-2 text-xs text-red-300/80">
            Mientras tanto cada cuenta muestra su saldo inicial, así que los
            movimientos nuevos no se ven reflejados. Volvé a correr
            <code className="mx-1">supabase/schema.sql</code>en el SQL Editor.
          </p>
        </div>
      )}

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
                const debt = isCard ? (cardDebt[a.id] ?? []) : []
                const bal = isCard
                  ? debt.reduce((s, d) => s + d.amount, 0)
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
                        {isCard
                          ? debt.length === 0
                            ? formatMoney(0, a.currency)
                            : debt
                                .map((d) => formatMoney(d.amount, d.currency))
                                .join(' + ')
                          : formatMoney(bal, a.currency)}
                        {isCard && (
                          <div className="text-[10px] font-normal text-slate-500">
                            ciclo actual
                          </div>
                        )}
                      </div>
                    </button>
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

          {accounts.length >= 1 && (
            <button
              onClick={openBuyCurrency}
              className="btn-ghost mt-2 w-full"
            >
              💱 Comprar moneda
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
              <label className="label">Saldo actual</label>
              <input
                className="input text-2xl font-bold"
                type="number"
                inputMode="decimal"
                value={initial}
                onChange={(e) => setInitial(e.target.value)}
                placeholder="0"
              />
              <p className="mt-1 text-xs text-slate-500">
                {editing
                  ? 'Si lo cambiás, se crea un movimiento de ajuste por la diferencia con el saldo actual.'
                  : 'El saldo que tenés hoy en esta cuenta. Después se ajusta solo con tus movimientos y transferencias.'}
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

      {/* ----- Modal comprar moneda ----- */}
      <Modal open={buyOpen} onClose={() => setBuyOpen(false)} title="Comprar moneda">
        <div className="space-y-4">
          <div>
            <label className="label">Pagás desde</label>
            <select
              className="input"
              value={buyFromId}
              onChange={(e) => {
                const from = accountsById[e.target.value]
                setBuyFromId(e.target.value)
                // Al cambiar el origen cambia la moneda que comprás: se elige
                // la primera cuenta compatible, o crear una nueva.
                const to = accounts.find(
                  (a) => a.id !== e.target.value && a.currency !== from?.currency,
                )
                setBuyToId(to?.id ?? NEW_ACCOUNT)
                setBuyNewName(from?.currency === 'USD' ? 'Pesos' : 'Dólares')
              }}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.icon} {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Se acredita en</label>
            <select
              className="input"
              value={buyToId}
              onChange={(e) => setBuyToId(e.target.value)}
            >
              {buyToOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.icon} {a.name} ({a.currency})
                </option>
              ))}
              <option value={NEW_ACCOUNT}>
                + Crear cuenta nueva {buyToCurrency ? `en ${buyToCurrency}` : ''}
              </option>
            </select>
          </div>

          {creatingBuyToAcc && (
            <div>
              <label className="label">Nombre de la cuenta nueva</label>
              <input
                className="input"
                value={buyNewName}
                onChange={(e) => setBuyNewName(e.target.value)}
                placeholder="Ej: Dólares NX"
              />
              <p className="mt-1 text-xs text-slate-500">
                Se crea una cuenta de banco en {buyToCurrency} con saldo 0 y ahí entran
                los {buyToCurrency} de esta compra.
              </p>
            </div>
          )}

          <div>
            <label className="label">
              Monto que gastás {buyFromAcc ? `(${buyFromAcc.currency})` : ''}
            </label>
            <input
              className="input text-2xl font-bold"
              type="number"
              inputMode="decimal"
              value={buyAmount}
              onChange={(e) => onBuyAmountChange(e.target.value)}
              placeholder="0"
            />
          </div>

          <div>
            <label className="label">
              Cuánto recibís {buyToCurrency ? `(${buyToCurrency})` : ''}
            </label>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              value={buyReceived}
              onChange={(e) => setBuyReceived(e.target.value)}
              placeholder="0"
            />
            <p className="mt-1 text-xs text-slate-500">
              Sugerido con el dólar a {formatMoney(getUsdRate(), 'ARS')} · ajustable en
              Ajustes.
            </p>
          </div>

          <div>
            <label className="label">Categoría del gasto</label>
            <select
              className="input"
              value={buyCategoryId}
              onChange={(e) => setBuyCategoryId(e.target.value)}
            >
              <option value="">Sin categoría</option>
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Fecha</label>
            <input
              className="input"
              type="date"
              value={buyDate}
              onChange={(e) => setBuyDate(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Nota (opcional)</label>
            <input
              className="input"
              value={buyNote}
              onChange={(e) => setBuyNote(e.target.value)}
              placeholder="Ej: Compra de dólares"
            />
          </div>

          {buySummary && buyFromAcc && buyToCurrency && (
            <div className="rounded-xl bg-slate-800/60 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Gastás</span>
                <span className="font-semibold text-red-300">
                  {formatMoney(buySummary.spent, buyFromAcc.currency)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Se te acreditan</span>
                <span className="font-semibold text-emerald-300">
                  {formatMoney(buySummary.received, buyToCurrency)}
                </span>
              </div>
              <div className="mt-1 border-t border-white/5 pt-1 text-xs text-slate-400">
                Tipo de cambio: {formatMoney(buySummary.rate, buyFromAcc.currency)} por
                cada {formatMoney(1, buyToCurrency)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Los {buyToCurrency} quedan en{' '}
                {creatingBuyToAcc
                  ? `la cuenta nueva "${buyNewName.trim() || '…'}"`
                  : `${buyToAcc.icon} ${buyToAcc.name}`}{' '}
                y podés usarlos para pagar el resumen de una tarjeta.
              </div>
            </div>
          )}

          {buyError && (
            <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">
              No se pudo guardar la compra: {buyError}
            </p>
          )}

          <button
            onClick={saveBuyCurrency}
            disabled={savingBuy || !canBuy}
            className="btn-primary w-full disabled:opacity-50"
          >
            {savingBuy ? 'Guardando…' : 'Comprar'}
          </button>
          {!canBuy && (
            <p className="text-center text-xs text-slate-500">
              {!buySummary
                ? 'Cargá cuánto gastás y cuánto recibís.'
                : 'Poné un nombre para la cuenta nueva.'}
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}
