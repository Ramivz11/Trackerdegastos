/** Selector de ícono (cualquier emoji) y color (cualquier color) reutilizable. */

const PRESET_COLORS = [
  '#6366f1', '#f97316', '#22c55e', '#3b82f6', '#eab308',
  '#ef4444', '#a855f7', '#14b8a6', '#ec4899', '#64748b',
]

const DEFAULT_ICONS = [
  '💸', '🍔', '🛒', '🚌', '💡', '💊', '🎉', '🏠', '👕', '📚',
  '🎮', '✈️', '🐶', '☕', '⛽', '💰', '🥇', '🤖', '💵', '💳', '🏦', '📈',
]

// Deja solo el último emoji/grafema escrito, para aceptar cualquier emoji del
// teclado pero guardar uno solo.
export function lastGrapheme(value: string): string {
  if (!value) return ''
  const Segmenter = (Intl as unknown as { Segmenter?: unknown }).Segmenter as
    | (new (locale: undefined, opts: { granularity: string }) => {
        segment: (v: string) => Iterable<{ segment: string }>
      })
    | undefined
  if (Segmenter) {
    const seg = new Segmenter(undefined, { granularity: 'grapheme' })
    const parts = Array.from(seg.segment(value), (s) => s.segment)
    return parts[parts.length - 1] ?? ''
  }
  const arr = Array.from(value)
  return arr[arr.length - 1] ?? ''
}

interface Props {
  icon: string
  color: string
  onIcon: (icon: string) => void
  onColor: (color: string) => void
  icons?: string[]
}

export default function IconColorPicker({
  icon,
  color,
  onIcon,
  onColor,
  icons = DEFAULT_ICONS,
}: Props) {
  return (
    <div className="space-y-4">
      <div>
        <label className="label">Ícono</label>
        <div className="mb-2 flex items-center gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl"
            style={{ backgroundColor: color + '33' }}
          >
            {icon}
          </span>
          <input
            className="input flex-1 text-center text-xl"
            value={icon}
            onChange={(e) => onIcon(lastGrapheme(e.target.value))}
            placeholder="Tocá y elegí un emoji"
            aria-label="Emoji"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {icons.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => onIcon(i)}
              className={`flex h-10 w-10 items-center justify-center rounded-lg text-xl ${
                icon === i ? 'ring-2 ring-brand' : 'bg-slate-800'
              }`}
            >
              {i}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Color</label>
        <div className="flex flex-wrap items-center gap-2">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onColor(c)}
              className={`h-9 w-9 rounded-full ${
                color.toLowerCase() === c.toLowerCase()
                  ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900'
                  : ''
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
          {/* Color libre */}
          <label
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full ring-1 ring-white/20"
            style={{ backgroundColor: color }}
            title="Elegir cualquier color"
          >
            <span className="text-xs">🎨</span>
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6366f1'}
              onChange={(e) => onColor(e.target.value)}
              className="sr-only"
            />
          </label>
        </div>
      </div>
    </div>
  )
}
