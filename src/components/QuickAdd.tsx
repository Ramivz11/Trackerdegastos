import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import AmountKeypad from './AmountKeypad'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { createTransaction, createTransactions, fetchTopCategoryIds } from '../lib/api'
import { formatMoney, rateFor, todayISO } from '../lib/format'
import { splitShare } from '../lib/amounts'
import { buildInstallmentRows, cardCurrencies, currencyLabel } from '../lib/statements'
import type { Category, Currency } from '../types'

const LAST_ACCOUNT_KEY = 'tracker:lastAccount'

interface QuickAddProps {
  /** Se llama tras registrar un gasto, para refrescar la pantalla actual. */
  onSaved?: () => void
}

/**
 * Botón flotante "Gasto rápido": muestra las categorías de gasto más usadas como
 * botones grandes; al elegir una, solo pide el monto y guarda con fecha de hoy.
 */
export default function QuickAdd({ onSaved }: QuickAddProps) {
  const { user } = useAuth()
  const { categories, accounts } = useData()
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [topIds, setTopIds] = useState<string[]>([])
  const [selected, setSelected] = useState<Category | null>(null)
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState<string>('')
  /** null = la moneda de la cuenta. Solo se cambia en tarjetas. */
  const [cardCurrency, setCardCurrency] = useState<Currency | null>(null)
  const [installments, setInstallments] = useState(1)
  const [people, setPeople] = useState(1)
  const [owedNote, setOwedNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      fetchTopCategoryIds().then(setTopIds).catch(() => setTopIds([]))
    }
  }, [open])

  // Cuenta por defecto: la última usada, o la primera disponible.
  useEffect(() => {
    if (!accountId && accounts.length > 0) {
      const last = localStorage.getItem(LAST_ACCOUNT_KEY)
      const found = accounts.find((a) => a.id === last)
      setAccountId(found ? found.id : accounts[0].id)
    }
  }, [accounts, accountId])

  // Solo categorías de gasto, ordenadas: más usadas, luego favoritas, luego resto.
  const ordered = useMemo(() => {
    const rank = new Map(topIds.map((id, i) => [id, i]))
    return categories
      .filter((c) => c.kind !== 'income')
      .sort((a, b) => {
        const ra = rank.has(a.id) ? rank.get(a.id)! : 999
        const rb = rank.has(b.id) ? rank.get(b.id)! : 999
        if (ra !== rb) return ra - rb
        if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }, [categories, topIds])

  const shortcuts = showAll ? ordered : ordered.slice(0, 6)

  function reset() {
    setSelected(null)
    setAmount('')
    setShowAll(false)
    setCardCurrency(null)
    setInstallments(1)
    setPeople(1)
    setOwedNote('')
  }

  function close() {
    setOpen(false)
    reset()
  }

  const account = accounts.find((a) => a.id === accountId) ?? null
  // Una tarjeta en pesos también tiene consumos en dólares; el resto de las
  // cuentas siempre usan su propia moneda.
  const currency: Currency =
    account?.type === 'card'
      ? (cardCurrency ?? account.currency)
      : (account?.currency ?? 'ARS')

  // Si se divide entre varias personas, tu parte es la que va a reportes;
  // el resto queda como "te deben" en el movimiento.
  const split = useMemo(() => {
    const value = parseFloat(amount)
    if (isNaN(value) || value <= 0 || people <= 1) return null
    return splitShare(value, people)
  }, [amount, people])

  async function save() {
    if (!user || !selected) return
    const value = parseFloat(amount)
    if (isNaN(value) || value <= 0) return
    setSaving(true)
    try {
      const isCard = account?.type === 'card'
      const cuotas = isCard ? installments : 1
      const base = {
        category_id: selected.id,
        account_id: account?.id ?? null,
        currency,
        ars_rate: rateFor(currency),
        description: null,
        type: 'expense' as const,
        // Gasto compartido: se manda si se eligió dividir con alguien más
        // (no aplica con cuotas, cada una ya es una parte del total).
        ...(split && cuotas === 1
          ? {
              reimbursable_amount: split.owed,
              reimbursable_note: owedNote.trim() || null,
            }
          : {}),
      }
      if (cuotas > 1) {
        const groupId = crypto.randomUUID()
        const rows = buildInstallmentRows(value, cuotas, todayISO()).map((r) => ({
          ...base,
          amount: r.amount,
          transaction_date: r.transaction_date,
          group_id: groupId,
          installment_n: r.installment_n,
          installment_total: r.installment_total,
        }))
        await createTransactions(rows, user.id)
      } else {
        await createTransaction(
          { ...base, amount: value, transaction_date: todayISO() },
          user.id,
        )
      }
      if (account) localStorage.setItem(LAST_ACCOUNT_KEY, account.id)
      close()
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Registrar gasto rápido"
        className="fixed bottom-24 right-5 z-40 flex h-16 w-16 items-center justify-center rounded-full bg-brand text-3xl text-white shadow-xl shadow-brand/30 transition active:scale-90"
      >
        +
      </button>

      <Modal
        open={open}
        onClose={close}
        title={selected ? `Gasto en ${selected.name}` : 'Gasto rápido'}
      >
        {!selected ? (
          <>
            <p className="mb-3 text-sm text-slate-400">Elegí una categoría</p>
            {shortcuts.length === 0 ? (
              <p className="text-sm text-slate-500">
                No tenés categorías de gasto todavía.
              </p>
            ) : (
            <div className="grid grid-cols-3 gap-3">
              {shortcuts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelected(c)}
                  className="flex flex-col items-center gap-2 rounded-2xl bg-slate-800 p-4 transition active:scale-95"
                >
                  <span
                    className="flex h-12 w-12 items-center justify-center rounded-full text-2xl"
                    style={{ backgroundColor: c.color + '33' }}
                  >
                    {c.icon}
                  </span>
                  <span className="text-center text-xs text-slate-300">
                    {c.name}
                  </span>
                </button>
              ))}
            </div>
            )}
            {ordered.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAll((s) => !s)}
                className="mt-4 w-full text-sm font-medium text-brand"
              >
                {showAll ? 'Ver menos' : 'Más categorías'}
              </button>
            )}
          </>
        ) : (
          <>
            <AmountKeypad value={amount} onChange={setAmount} />

            {accounts.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium text-slate-400">Pagué con</p>
                <div className="grid grid-cols-2 gap-2">
                  {accounts.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setAccountId(a.id)
                        setCardCurrency(null) // vuelve a la moneda de la cuenta
                      }}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition active:scale-95 ${
                        accountId === a.id
                          ? 'bg-brand text-white'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      <span>{a.icon}</span>
                      <span className="truncate">{a.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {account?.type === 'card' && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium text-slate-400">Moneda</p>
                <div className="grid grid-cols-2 gap-2">
                  {cardCurrencies(account.currency).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCardCurrency(c)}
                      className={`rounded-xl py-2 text-sm transition active:scale-95 ${
                        currency === c
                          ? 'bg-brand text-white'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {currencyLabel(c)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {account?.type === 'card' && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium text-slate-400">Cuotas</p>
                <div className="grid grid-cols-6 gap-2">
                  {[1, 3, 6, 9, 12, 18].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setInstallments(n)}
                      className={`rounded-xl py-2 text-sm transition active:scale-95 ${
                        installments === n
                          ? 'bg-brand text-white'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                {installments > 1 && amount && (
                  <p className="mt-2 text-xs text-slate-500">
                    {installments} cuotas de aprox.{' '}
                    {(parseFloat(amount) / installments).toLocaleString('es-AR', {
                      maximumFractionDigits: 2,
                    })}
                  </p>
                )}
              </div>
            )}

            {installments === 1 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium text-slate-400">
                  Dividir entre (incluyéndote)
                </p>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setPeople(n)}
                      className={`rounded-xl py-2 text-sm transition active:scale-95 ${
                        people === n
                          ? 'bg-brand text-white'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                {split && (
                  <>
                    <p className="mt-2 text-xs text-slate-500">
                      Tu parte{' '}
                      <span className="font-semibold text-slate-200">
                        {formatMoney(split.mine, currency)}
                      </span>{' '}
                      · te deben{' '}
                      <span className="font-semibold text-emerald-400">
                        {formatMoney(split.owed, currency)}
                      </span>
                    </p>
                    <input
                      className="input mt-2"
                      value={owedNote}
                      onChange={(e) => setOwedNote(e.target.value)}
                      placeholder="¿Quiénes? Ej: Juan y Sofi"
                    />
                  </>
                )}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="btn-ghost flex-1"
              >
                Atrás
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || !amount}
                className="btn-primary flex-1 disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
