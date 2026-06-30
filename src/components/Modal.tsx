import type { ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}

/** Hoja inferior (bottom sheet) pensada para mobile. */
export default function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="safe-bottom max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-slate-900 p-5 shadow-2xl ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-600" />
        {title && (
          <h2 className="mb-4 text-lg font-bold text-slate-100">{title}</h2>
        )}
        {children}
      </div>
    </div>
  )
}
