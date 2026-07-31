import type { Currency, RateMap, RateSource } from '../types'

/**
 * Cotizaciones automáticas desde dolarapi.com (API pública, sin key).
 *
 * - `/v1/dolares` trae las variantes del dólar (oficial, blue, bolsa, cripto,
 *   tarjeta, mayorista); el usuario elige cuál usar en Ajustes.
 * - `/v1/cotizaciones` trae el resto de las monedas contra el peso.
 *
 * MXN y COP no están en la API: esas quedan siempre en el valor manual.
 */

const DOLARES_URL = 'https://dolarapi.com/v1/dolares'
const OTRAS_URL = 'https://dolarapi.com/v1/cotizaciones'
const CACHE_KEY = 'tracker:ratesCache'

/** Fuentes que se pueden pedir a la API (todas menos "manual"). */
export const RATE_SOURCES: { value: RateSource; label: string }[] = [
  { value: 'manual', label: 'A mano (la cargo yo)' },
  { value: 'blue', label: 'Dólar blue' },
  { value: 'oficial', label: 'Dólar oficial' },
  { value: 'bolsa', label: 'Dólar MEP / bolsa' },
  { value: 'cripto', label: 'Dólar cripto' },
  { value: 'tarjeta', label: 'Dólar tarjeta' },
  { value: 'mayorista', label: 'Dólar mayorista' },
]

interface DolarApiRow {
  casa: string
  nombre: string
  compra: number | null
  venta: number | null
  fechaActualizacion: string
}

interface CotizacionRow {
  moneda: string
  compra: number | null
  venta: number | null
  fechaActualizacion: string
}

interface RatesCache {
  day: string // YYYY-MM-DD
  source: RateSource
  rates: RateMap
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function readCache(): RatesCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as RatesCache) : null
  } catch {
    return null
  }
}

/** Toma el valor de venta; si no hay, el de compra. */
function priceOf(row: { compra: number | null; venta: number | null }): number | null {
  const v = row.venta ?? row.compra
  return v && v > 0 ? v : null
}

/**
 * Trae las cotizaciones del día para la fuente elegida.
 *
 * Devuelve `null` si la fuente es manual, si ya se consultó hoy con esa misma
 * fuente (caché diario) o si la API no responde: en todos esos casos se sigue
 * usando lo que ya estaba guardado.
 */
export async function fetchRates(
  source: RateSource,
  opts: { force?: boolean } = {},
): Promise<RateMap | null> {
  if (source === 'manual') return null

  const cached = readCache()
  if (!opts.force && cached && cached.day === today() && cached.source === source) {
    return null
  }

  try {
    const [dolares, otras] = await Promise.all([
      fetch(DOLARES_URL).then((r) => (r.ok ? (r.json() as Promise<DolarApiRow[]>) : [])),
      fetch(OTRAS_URL).then((r) => (r.ok ? (r.json() as Promise<CotizacionRow[]>) : [])),
    ])

    const next: RateMap = { ARS: 1 }

    const dolar = dolares.find((d) => d.casa === source)
    const usd = dolar ? priceOf(dolar) : null
    if (usd) next.USD = usd

    // El resto de las monedas viene contra el peso en la otra ruta.
    const byCode: Record<string, Currency> = {
      EUR: 'EUR',
      BRL: 'BRL',
      CLP: 'CLP',
      UYU: 'UYU',
    }
    for (const row of otras) {
      const code = byCode[row.moneda?.toUpperCase() ?? '']
      if (!code) continue
      const p = priceOf(row)
      if (p) next[code] = p
    }

    if (!next.USD && Object.keys(next).length <= 1) return null

    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ day: today(), source, rates: next } satisfies RatesCache),
    )
    return next
  } catch {
    // Sin internet o API caída: seguimos con las cotizaciones guardadas.
    return null
  }
}

/** Todas las variantes del dólar, para mostrarlas en Ajustes. */
export async function fetchDolarVariants(): Promise<
  { casa: string; nombre: string; valor: number }[]
> {
  try {
    const res = await fetch(DOLARES_URL)
    if (!res.ok) return []
    const rows = (await res.json()) as DolarApiRow[]
    return rows
      .map((r) => ({ casa: r.casa, nombre: r.nombre, valor: priceOf(r) ?? 0 }))
      .filter((r) => r.valor > 0)
  } catch {
    return []
  }
}
