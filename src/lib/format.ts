import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

const CURRENCY_KEY = 'tracker:currency'

export function getCurrency(): string {
  return localStorage.getItem(CURRENCY_KEY) ?? 'ARS'
}

export function setCurrency(code: string) {
  localStorage.setItem(CURRENCY_KEY, code)
}

export function formatMoney(amount: number, currency = getCurrency()): string {
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `$ ${amount.toFixed(2)}`
  }
}

/** Fecha de hoy en formato YYYY-MM-DD respetando la zona horaria local. */
export function todayISO(): string {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

export function formatDate(iso: string, pattern = "d 'de' MMM"): string {
  return format(parseISO(iso), pattern, { locale: es })
}

export function formatMonth(iso: string): string {
  return format(parseISO(iso + '-01'), 'MMMM yyyy', { locale: es })
}

/** Devuelve el mes (YYYY-MM) de una fecha YYYY-MM-DD. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

export function currentMonth(): string {
  return todayISO().slice(0, 7)
}
