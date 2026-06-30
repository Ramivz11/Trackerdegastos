import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import AmountKeypad from './AmountKeypad'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { createTransaction, fetchTopCategoryIds } from '../lib/api'
import { todayISO } from '../lib/format'
import type { Category } from '../types'

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
  const { categories } = useData()
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [topIds, setTopIds] = useState<string[]>([])
  const [selected, setSelected] = useState<Category | null>(null)
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      fetchTopCategoryIds().then(setTopIds).catch(() => setTopIds([]))
    }
  }, [open])

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
  }

  function close() {
    setOpen(false)
    reset()
  }

  async function save() {
    if (!user || !selected) return
    const value = parseFloat(amount)
    if (isNaN(value) || value <= 0) return
    setSaving(true)
    try {
      await createTransaction(
        {
          category_id: selected.id,
          amount: value,
          description: null,
          transaction_date: todayISO(),
          type: 'expense',
        },
        user.id,
      )
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
