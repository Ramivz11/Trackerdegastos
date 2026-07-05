import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

const CURRENCY_KEY = 'tracker:currency'
const USD_RATE_KEY = 'tracker:usdRate'

export function getCurrency(): string {
  return localStorage.getItem(CURRENCY_KEY) ?? 'ARS'
}

export function setCurrency(code: string) {
  localStorage.setItem(CURRENCY_KEY, code)
}

/** Cotización del dólar (cuántos ARS vale 1 USD). Editable en Ajustes. */
export function getUsdRate(): number {
  const v = Number(localStorage.getItem(USD_RATE_KEY))
  return v > 0 ? v : 1000
}

export function setUsdRate(rate: number) {
  localStorage.setItem(USD_RATE_KEY, String(rate))
}

/** ARS por 1 unidad de la moneda dada, según la cotización guardada. */
export function rateFor(currency: string): number {
  return currency === 'USD' ? getUsdRate() : 1
}

/**
 * Equivalente en ARS de un monto en su moneda, usando el ars_rate guardado en
 * la transacción (o la cotización actual si no hay uno). Sirve para sumar
 * montos de distintas monedas en reportes y totales.
 */
export function toArs(amount: number, currency: string, arsRate?: number): number {
  if (currency !== 'USD') return amount
  const rate = arsRate && arsRate > 0 ? arsRate : getUsdRate()
  return amount * rate
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
