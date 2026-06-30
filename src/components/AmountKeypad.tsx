import { formatMoney } from '../lib/format'

interface AmountKeypadProps {
  value: string
  onChange: (value: string) => void
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '←']

/** Teclado numérico grande para cargar montos con el pulgar. */
export default function AmountKeypad({ value, onChange }: AmountKeypadProps) {
  function press(key: string) {
    if (key === '←') {
      onChange(value.slice(0, -1))
      return
    }
    if (key === '.') {
      if (value.includes('.')) return
      onChange(value === '' ? '0.' : value + '.')
      return
    }
    // Evita ceros a la izquierda y limita a 2 decimales.
    if (value.includes('.') && value.split('.')[1]?.length >= 2) return
    const next = value === '0' ? key : value + key
    onChange(next)
  }

  const numeric = parseFloat(value || '0')

  return (
    <div>
      <div className="mb-4 rounded-2xl bg-slate-800 py-6 text-center">
        <div className="text-4xl font-bold tabular-nums text-white">
          {formatMoney(isNaN(numeric) ? 0 : numeric)}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            className="rounded-xl bg-slate-700/70 py-4 text-2xl font-semibold text-slate-100 transition active:scale-95 active:bg-slate-600"
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  )
}
