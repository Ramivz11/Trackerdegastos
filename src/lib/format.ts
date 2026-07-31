import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import type { Currency, RateMap, RateSource } from '../types'

/**
 * ARS es la moneda base: los montos de distintas monedas se normalizan a ARS
 * para poder sumarlos, y recién al mostrarlos se convierten a la moneda de
 * visualización que el usuario eligió en Ajustes.
 *
 * Los valores acá son un caché sincrónico (para que `formatMoney` no tenga que
 * ser async); la fuente de verdad es la tabla `user_settings` de Supabase, que
 * `SettingsContext` vuelca acá con `applySettings` al iniciar sesión.
 */

const CURRENCY_KEY = 'tracker:currency'
const RATES_KEY = 'tracker:rates'
const RATE_SOURCE_KEY = 'tracker:rateSource'
// Clave vieja: una sola cotización de dólar. Se migra a RATES_KEY.
const LEGACY_USD_RATE_KEY = 'tracker:usdRate'

const DEFAULT_RATES: RateMap = { ARS: 1, USD: 1000 }

function readRates(): RateMap {
  try {
    const raw = localStorage.getItem(RATES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as RateMap
      return { ...DEFAULT_RATES, ...parsed, ARS: 1 }
    }
  } catch {
    /* json inválido: caemos al default */
  }
  // Migración desde la cotización única de dólar.
  const legacy = Number(localStorage.getItem(LEGACY_USD_RATE_KEY))
  if (legacy > 0) return { ...DEFAULT_RATES, USD: legacy }
  return { ...DEFAULT_RATES }
}

let displayCurrency: Currency =
  (localStorage.getItem(CURRENCY_KEY) as Currency | null) ?? 'ARS'
let rates: RateMap = readRates()
let rateSource: RateSource =
  (localStorage.getItem(RATE_SOURCE_KEY) as RateSource | null) ?? 'manual'

/** Vuelca en el caché sincrónico los ajustes que llegaron de Supabase. */
export function applySettings(s: {
  display_currency?: Currency
  rates?: RateMap
  rate_source?: RateSource
}) {
  if (s.display_currency) setDisplayCurrency(s.display_currency)
  if (s.rates) setRates(s.rates)
  if (s.rate_source) setRateSource(s.rate_source)
}

export function getDisplayCurrency(): Currency {
  return displayCurrency
}

export function setDisplayCurrency(code: Currency) {
  displayCurrency = code
  localStorage.setItem(CURRENCY_KEY, code)
}

export function getRates(): RateMap {
  return rates
}

export function setRates(next: RateMap) {
  rates = { ...rates, ...next, ARS: 1 }
  localStorage.setItem(RATES_KEY, JSON.stringify(rates))
}

export function getRateSource(): RateSource {
  return rateSource
}

export function setRateSource(src: RateSource) {
  rateSource = src
  localStorage.setItem(RATE_SOURCE_KEY, src)
}

/** ARS por 1 unidad de la moneda dada. */
export function rateFor(currency: string): number {
  if (currency === 'ARS') return 1
  const r = rates[currency as Currency]
  return r && r > 0 ? r : 1
}

/** Cotización del dólar. Se mantiene por compatibilidad con el código viejo. */
export function getUsdRate(): number {
  return rateFor('USD')
}

export function setUsdRate(rate: number) {
  setRates({ USD: rate })
}

/**
 * Equivalente en ARS de un monto en su moneda, usando el `ars_rate` guardado en
 * la transacción (la cotización del día en que se cargó) o la actual si no hay
 * uno. Sirve para sumar montos de distintas monedas.
 */
export function toArs(amount: number, currency: string, arsRate?: number): number {
  if (currency === 'ARS') return amount
  const rate = arsRate && arsRate > 0 ? arsRate : rateFor(currency)
  return amount * rate
}

/** Pasa un monto en ARS a otra moneda. */
export function fromArs(ars: number, currency: Currency): number {
  const rate = rateFor(currency)
  return rate > 0 ? ars / rate : ars
}

/**
 * Formatea un monto.
 *
 * - Con `currency`: el monto ya está en esa moneda y se muestra tal cual
 *   (ej. el renglón de un gasto en dólares).
 * - Sin `currency`: el monto está en ARS (un total normalizado) y se convierte
 *   a la moneda de visualización antes de mostrarlo.
 */
export function formatMoney(amount: number, currency?: Currency): string {
  const code = currency ?? displayCurrency
  const value = currency ? amount : fromArs(amount, displayCurrency)
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `$ ${value.toFixed(2)}`
  }
}

/** Formato corto para ejes de gráficos: $ 1,2 M / $ 340 k. */
export function formatMoneyShort(amount: number): string {
  const v = fromArs(amount, displayCurrency)
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`
  return `${sign}$${Math.round(abs)}`
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

/** Corre un mes YYYY-MM hacia adelante o atrás. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Primer y último día de un mes YYYY-MM, en YYYY-MM-DD. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return {
    start: `${month}-01`,
    end: `${month}-${String(last).padStart(2, '0')}`,
  }
}
