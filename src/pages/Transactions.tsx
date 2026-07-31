import { useCallback, useEffect, useMemo, useState } from 'react'
import Modal from '../components/Modal'
import QuickAdd from '../components/QuickAdd'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import {
  createTransaction,
  createTransactions,
  deleteTransaction,
  fetchTransactionsByMonth,
  updateTransaction,
} from '../lib/api'
import { isShared, netAmount, netArs } from '../lib/amounts'
import { buildInstallmentRows } from '../lib/statements'
import { findDuplicate } from '../lib/duplicates'
import { downloadCsv, transactionsToCsv } from '../lib/export'
import { suggestCategory } from '../lib/rules'
import { processReceipt, receiptScanEnabled } from '../lib/receipts'
import {
  currentMonth,
  formatDate,
  formatMoney,
  formatMonth,
  rateFor,
  shiftMonth,
  toArs,
  todayISO,
} from '../lib/format'
import type { Currency, TransactionType, TransactionWithCategory } from '../types'

export default function Transactions() {
  const { categories, categoriesById, accounts, accountsById, rules } = useData()
  const { user } = useAuth()
  const [month, setMonth] = useState(currentMonth())
  const [items, setItems] = useState<TransactionWithCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCat, setFilterCat] = useState<string>('all')
  const [filterType, setFilterType] = useState<'all' | TransactionType>('all')
  const [filterAccount, setFilterAccount] = useState<string>('all')
  const [search, setSearch] = useState('')

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<TransactionWithCategory | null>(null)
  const [type, setType] = useState<TransactionType>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [description, setDescription] = useState('')
  const [installments, setInstallments] = useState(1)
  const [saving, setSaving] = useState(false)
  const [owedAmount, setOwedAmount] = useState('')
  const [owedNote, setOwedNote] = useState('')
  const [receiptPath, setReceiptPath] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState<string | null>(null)
  const [dupWarning, setDupWarning] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await fetchTransactionsByMonth(month))
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((t) => {
      if (filterType !== 'all' && t.type !== filterType) return false
      if (filterCat !== 'all' && t.category_id !== filterCat) return false
      if (filterAccount !== 'all' && t.account_id !== filterAccount) return false
      if (q) {
        const cat = t.category_id ? categoriesById[t.category_id] : null
        const hay = `${t.description ?? ''} ${cat?.name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, filterType, filterCat, filterAccount, search, categoriesById])

  // En el modal solo se ofrecen categorías que coincidan con el tipo elegido.
  const modalCats = useMemo(
    () =>
      type === 'income'
        ? categories.filter((c) => c.kind === 'income')
        : categories.filter((c) => c.kind !== 'income'),
    [categories, type],
  )

  function changeType(next: TransactionType) {
    setType(next)
    // Si la categoría actual no pertenece al nuevo tipo, la limpiamos.
    const pool =
      next === 'income'
        ? categories.filter((c) => c.kind === 'income')
        : categories.filter((c) => c.kind !== 'income')
    if (!pool.some((c) => c.id === categoryId)) {
      setCategoryId(pool[0]?.id ?? '')
    }
  }

  const totals = useMemo(() => {
    let expense = 0
    let income = 0
    for (const t of filtered) {
      if (t.is_transfer) continue
      // De un gasto compartido se cuenta solo tu parte.
      if (t.type === 'expense') expense += netArs(t)
      else income += toArs(Number(t.amount), t.currency, t.ars_rate)
    }
    return { expense, income }
  }, [filtered])

  function resetExtras() {
    setReceiptPath(null)
    setScanMsg(null)
    setDupWarning(null)
    setScanning(false)
    setOwedAmount('')
    setOwedNote('')
  }

  function openNew() {
    setEditing(null)
    setType('expense')
    setAmount('')
    setCategoryId(categories.find((c) => c.kind !== 'income')?.id ?? '')
    setAccountId(accounts[0]?.id ?? '')
    setDate(todayISO())
    setDescription('')
    setInstallments(1)
    resetExtras()
    setOpen(true)
  }

  function openEdit(t: TransactionWithCategory) {
    setEditing(t)
    setType(t.type)
    setAmount(String(t.amount))
    setCategoryId(t.category_id ?? '')
    setAccountId(t.account_id ?? '')
    setDate(t.transaction_date)
    setDescription(t.description ?? '')
    setInstallments(1)
    resetExtras()
    setReceiptPath(t.receipt_path)
    const owed = Number(t.reimbursable_amount ?? 0)
    setOwedAmount(owed > 0 ? String(owed) : '')
    setOwedNote(t.reimbursable_note ?? '')
    setOpen(true)
  }

  /**
   * Al escribir la nota, si alguna regla coincide y todavía no elegiste
   * categoría a mano, se sugiere sola.
   */
  function changeDescription(text: string) {
    setDescription(text)
    setDupWarning(null)
    if (type !== 'expense' || categoryId) return
    const suggested = suggestCategory(text, rules)
    if (suggested) setCategoryId(suggested)
  }

  /** Foto del ticket: la sube y, si está habilitado, la lee con Claude. */
  async function onReceipt(file: File | undefined) {
    if (!file || !user) return
    setScanning(true)
    setScanMsg(null)
    try {
      const { path, scan, scanError } = await processReceipt(file, user.id)
      setReceiptPath(path)

      if (scanError) {
        setScanMsg(`Foto guardada, pero no se pudo leer: ${scanError}`)
        return
      }
      if (!scan) {
        setScanMsg('Foto guardada.')
        return
      }
      if (!scan.encontrado) {
        setScanMsg('Foto guardada, pero no se leyó como ticket. Cargalo a mano.')
        return
      }

      if (scan.monto_total > 0) setAmount(String(scan.monto_total))
      if (scan.comercio) changeDescription(scan.comercio)
      if (scan.fecha) setDate(scan.fecha)
      if (scan.cuotas > 1) setInstallments(scan.cuotas)

      // La categoría del ticket solo se aplica si existe una con ese nombre.
      const match = categories.find(
        (c) =>
          c.kind !== 'income' &&
          c.name.toLowerCase() === scan.categoria_sugerida.toLowerCase(),
      )
      if (match) setCategoryId(match.id)

      setScanMsg('Datos cargados desde el ticket. Revisalos antes de guardar.')
    } catch (e) {
      setScanMsg(`No se pudo procesar la foto: ${(e as Error).message}`)
    } finally {
      setScanning(false)
    }
  }

  async function save() {
    if (!user) return
    const value = parseFloat(amount)
    if (isNaN(value) || value <= 0) return

    // Aviso de posible duplicado (mismo monto, categoría, cuenta y día).
    if (!editing && !dupWarning) {
      const dup = findDuplicate(
        {
          amount: value,
          category_id: categoryId || null,
          account_id: accountId || null,
          transaction_date: date,
          type,
        },
        items,
      )
      if (dup) {
        setDupWarning(
          `Ya hay un movimiento igual el ${formatDate(dup.transaction_date)}` +
            `${dup.description ? ` (“${dup.description}”)` : ''}. ` +
            'Tocá Guardar de nuevo si querés cargarlo igual.',
        )
        return
      }
    }

    setSaving(true)
    try {
      const acc = accountsById[accountId]
      const currency: Currency = acc?.currency ?? 'ARS'
      // Lo que te tienen que devolver nunca puede superar lo que pagaste.
      const owed =
        type === 'expense'
          ? Math.min(Math.max(parseFloat(owedAmount) || 0, 0), value)
          : 0
      const base = {
        category_id: categoryId || null,
        account_id: accountId || null,
        currency,
        ars_rate: rateFor(currency),
        description: description.trim() || null,
        type,
        // Solo se manda si hay foto, así la carga normal sigue andando en bases
        // que todavía no corrieron el schema nuevo.
        ...(receiptPath ? { receipt_path: receiptPath } : {}),
        // Ídem con el gasto compartido: se manda si hay algo que informar, o si
        // se está editando un movimiento que ya lo tenía (para poder ponerlo en 0).
        ...(owed > 0 || Number(editing?.reimbursable_amount ?? 0) > 0
          ? {
              reimbursable_amount: owed,
              reimbursable_note: owedNote.trim() || null,
            }
          : {}),
      }
      const cuotas = !editing && type === 'expense' && acc?.type === 'card' ? installments : 1
      if (cuotas > 1) {
        const groupId = crypto.randomUUID()
        const rows = buildInstallmentRows(value, cuotas, date).map((r) => ({
          ...base,
          amount: r.amount,
          transaction_date: r.transaction_date,
          group_id: groupId,
          installment_n: r.installment_n,
          installment_total: r.installment_total,
        }))
        await createTransactions(rows, user.id)
      } else {
        const payload = { ...base, amount: value, transaction_date: date }
        if (editing) await updateTransaction(editing.id, payload)
        else await createTransaction(payload, user.id)
      }
      setOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function remove(t: TransactionWithCategory) {
    if (!confirm('¿Eliminar este movimiento?')) return
    await deleteTransaction(t.id)
    await load()
  }

  /** Exporta lo que se está viendo (respeta los filtros activos). */
  function exportar() {
    const csv = transactionsToCsv(filtered, categoriesById, accountsById)
    downloadCsv(`movimientos-${month}.csv`, csv)
  }

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Movimientos</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={exportar}
            disabled={filtered.length === 0}
            className="btn-ghost px-3 py-2 text-sm disabled:opacity-40"
            aria-label="Exportar a CSV"
          >
            ⬇ CSV
          </button>
          <button onClick={openNew} className="btn-primary px-3 py-2 text-sm">
            + Agregar
          </button>
        </div>
      </header>

      {/* Selector de mes */}
      <div className="mb-4 flex items-center justify-between rounded-xl bg-slate-800/60 p-2">
        <button
          onClick={() => setMonth(shiftMonth(month, -1))}
          className="rounded-lg px-3 py-1 text-lg text-slate-300"
        >
          ‹
        </button>
        <span className="font-semibold capitalize text-slate-100">
          {formatMonth(month)}
        </span>
        <button
          onClick={() => setMonth(shiftMonth(month, 1))}
          className="rounded-lg px-3 py-1 text-lg text-slate-300"
        >
          ›
        </button>
      </div>

      {/* Totales */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="card">
          <div className="text-xs text-slate-400">Gastos</div>
          <div className="text-lg font-bold text-red-400">
            {formatMoney(totals.expense)}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-slate-400">Ingresos</div>
          <div className="text-lg font-bold text-emerald-400">
            {formatMoney(totals.income)}
          </div>
        </div>
      </div>

      {/* Buscador */}
      <input
        className="input mb-3"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="🔍 Buscar por nota o categoría"
      />

      {/* Filtro por tipo */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        {(
          [
            ['all', 'Todos'],
            ['expense', 'Egresos'],
            ['income', 'Ingresos'],
          ] as [typeof filterType, string][]
        ).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFilterType(val)}
            className={`btn py-2 text-sm ${
              filterType === val
                ? val === 'expense'
                  ? 'bg-red-500/80 text-white'
                  : val === 'income'
                    ? 'bg-emerald-500/80 text-white'
                    : 'bg-brand text-white'
                : 'bg-slate-700/60 text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filtros por categoría y cuenta */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <select
          className="input"
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
        >
          <option value="all">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={filterAccount}
          onChange={(e) => setFilterAccount(e.target.value)}
        >
          <option value="all">Todas las cuentas</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.icon} {a.name}
            </option>
          ))}
        </select>
      </div>

      {/* Lista */}
      {loading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-slate-500">
          No hay movimientos este mes.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const cat = t.category_id ? categoriesById[t.category_id] : null
            const acc = t.account_id ? accountsById[t.account_id] : null
            return (
              <button
                key={t.id}
                onClick={() => openEdit(t)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  remove(t)
                }}
                className="card flex w-full items-center gap-3 text-left"
              >
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl"
                  style={{ backgroundColor: (cat?.color ?? '#64748b') + '33' }}
                >
                  {cat?.icon ?? '❓'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-slate-100">
                    {t.description || cat?.name || 'Sin categoría'}
                  </div>
                  <div className="truncate text-sm text-slate-400">
                    {formatDate(t.transaction_date)}
                    {cat && t.description ? ` · ${cat.name}` : ''}
                    {acc ? ` · ${acc.icon} ${acc.name}` : ''}
                  </div>
                  {isShared(t) && (
                    <div className="truncate text-xs text-emerald-400">
                      🤝 te deben {formatMoney(Number(t.reimbursable_amount), t.currency)}
                      {t.reimbursable_note ? ` · ${t.reimbursable_note}` : ''}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div
                    className={`font-bold ${
                      t.type === 'expense' ? 'text-red-400' : 'text-emerald-400'
                    }`}
                  >
                    {t.type === 'expense' ? '-' : '+'}
                    {formatMoney(Number(t.amount), t.currency)}
                  </div>
                  {isShared(t) && (
                    <div className="text-xs text-slate-500">
                      tuyo {formatMoney(netAmount(t), t.currency)}
                    </div>
                  )}
                </div>
              </button>
            )
          })}
          <p className="pt-2 text-center text-xs text-slate-500">
            Tocá para editar · mantené presionado / clic derecho para borrar
          </p>
        </div>
      )}

      <QuickAdd onSaved={load} />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Editar movimiento' : 'Nuevo movimiento'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => changeType('expense')}
              className={`btn ${type === 'expense' ? 'bg-red-500/80 text-white' : 'bg-slate-700/60 text-slate-300'}`}
            >
              Gasto
            </button>
            <button
              type="button"
              onClick={() => changeType('income')}
              className={`btn ${type === 'income' ? 'bg-emerald-500/80 text-white' : 'bg-slate-700/60 text-slate-300'}`}
            >
              Ingreso
            </button>
          </div>

          {/* Foto del ticket: precarga monto, comercio y fecha */}
          {!editing && type === 'expense' && (
            <div>
              <label
                className={`btn w-full ${
                  scanning
                    ? 'bg-slate-700/60 text-slate-400'
                    : 'bg-slate-700/60 text-slate-100'
                }`}
              >
                {scanning
                  ? 'Leyendo el ticket…'
                  : receiptPath
                    ? '📎 Cambiar foto del ticket'
                    : receiptScanEnabled()
                      ? '📷 Sacar foto del ticket'
                      : '📷 Adjuntar foto del ticket'}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  disabled={scanning}
                  onChange={(e) => {
                    void onReceipt(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </label>
              {scanMsg && (
                <p className="mt-1 text-xs text-slate-400">{scanMsg}</p>
              )}
            </div>
          )}

          <div>
            <label className="label">Monto</label>
            <input
              className="input text-2xl font-bold"
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                setDupWarning(null)
              }}
              placeholder="0"
            />
          </div>

          <div>
            <label className="label">Categoría</label>
            <select
              className="input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Sin categoría</option>
              {modalCats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </div>

          {accounts.length > 0 && (
            <div>
              <label className="label">
                {type === 'income' ? 'Cuenta que recibe' : 'Cuenta / medio de pago'}
              </label>
              <select
                className="input"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">Sin cuenta</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.icon} {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            </div>
          )}

          {!editing &&
            type === 'expense' &&
            accountsById[accountId]?.type === 'card' && (
              <div>
                <label className="label">Cuotas</label>
                <div className="grid grid-cols-6 gap-2">
                  {[1, 3, 6, 9, 12, 18].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setInstallments(n)}
                      className={`btn py-2 text-sm ${
                        installments === n
                          ? 'bg-brand text-white'
                          : 'bg-slate-700/60 text-slate-300'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                {installments > 1 && amount && (
                  <p className="mt-1 text-xs text-slate-500">
                    {installments} cuotas de aprox.{' '}
                    {formatMoney(parseFloat(amount) / installments)}. La 1ª entra en
                    el resumen de este ciclo.
                  </p>
                )}
              </div>
            )}

          <div>
            <label className="label">Fecha</label>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* Gasto compartido: pagaste vos y te devuelven después */}
          {type === 'expense' && installments === 1 && (
            <div className="rounded-xl bg-slate-900/60 p-3">
              <label className="label">Me deben (opcional)</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={owedAmount}
                onChange={(e) => setOwedAmount(e.target.value)}
                placeholder="0"
              />
              {owedAmount && parseFloat(owedAmount) > 0 && amount && (
                <p className="mt-1 text-xs text-slate-400">
                  De {formatMoney(parseFloat(amount) || 0, accountsById[accountId]?.currency ?? 'ARS')}{' '}
                  pagados, tu parte es{' '}
                  <span className="font-semibold text-slate-200">
                    {formatMoney(
                      Math.max(
                        (parseFloat(amount) || 0) -
                          Math.min(parseFloat(owedAmount) || 0, parseFloat(amount) || 0),
                        0,
                      ),
                      accountsById[accountId]?.currency ?? 'ARS',
                    )}
                  </span>
                  . Los reportes cuentan tu parte; de la cuenta sale el total.
                </p>
              )}
              <input
                className="input mt-2"
                value={owedNote}
                onChange={(e) => setOwedNote(e.target.value)}
                placeholder="¿Quiénes? Ej: Juan y Sofi"
              />
            </div>
          )}

          <div>
            <label className="label">Nota (opcional)</label>
            <input
              className="input"
              value={description}
              onChange={(e) => changeDescription(e.target.value)}
              placeholder="Ej: Cena con amigos"
            />
          </div>

          {dupWarning && (
            <p className="rounded-xl bg-amber-500/15 p-3 text-sm text-amber-400">
              ⚠️ {dupWarning}
            </p>
          )}

          <div className="flex gap-2">
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  remove(editing)
                }}
                className="btn bg-red-500/20 text-red-400"
              >
                Borrar
              </button>
            )}
            <button
              onClick={save}
              disabled={saving || !amount}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
