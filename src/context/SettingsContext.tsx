import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { acceptPendingInvites, fetchSettings, saveSettings } from '../lib/api'
import { applySettings, getDisplayCurrency, getRates, getRateSource } from '../lib/format'
import { fetchRates } from '../lib/rates'
import type { Currency, RateMap, RateSource, UserSettings } from '../types'

interface SettingsContextValue {
  settings: UserSettings | null
  loading: boolean
  /** Guarda en Supabase y refresca el caché de formato. */
  update: (patch: Partial<Omit<UserSettings, 'user_id'>>) => Promise<void>
  /** Vuelve a pedir las cotizaciones a dolarapi (ignora el caché diario). */
  refreshRates: () => Promise<boolean>
  displayCurrency: Currency
  rates: RateMap
  rateSource: RateSource
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined)

export function SettingsProvider({
  userId,
  children,
}: {
  userId: string
  children: ReactNode
}) {
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [loading, setLoading] = useState(true)
  // Fuerza el re-render de la app cuando cambian moneda o cotizaciones, ya que
  // formatMoney lee de un caché sincrónico fuera de React.
  const [, bump] = useState(0)

  const absorb = useCallback((s: UserSettings) => {
    setSettings(s)
    applySettings(s)
    bump((n) => n + 1)
  }, [])

  const update = useCallback(
    async (patch: Partial<Omit<UserSettings, 'user_id'>>) => {
      const saved = await saveSettings(userId, patch)
      absorb(saved)
    },
    [userId, absorb],
  )

  const refreshRates = useCallback(async () => {
    const source = settings?.rate_source ?? getRateSource()
    if (source === 'manual') return false
    const next = await fetchRates(source, { force: true })
    if (!next) return false
    await update({
      rates: { ...(settings?.rates ?? {}), ...next },
      rates_updated_at: new Date().toISOString(),
    })
    return true
  }, [settings, update])

  useEffect(() => {
    let cancel = false

    async function boot() {
      try {
        // Si alguien me invitó a su hogar, la invitación se acepta acá.
        await acceptPendingInvites().catch(() => 0)

        const s = await fetchSettings(userId)
        if (cancel) return
        absorb(s)

        // Cotización automática: una vez por día, sin bloquear la pantalla.
        if (s.rate_source !== 'manual') {
          const next = await fetchRates(s.rate_source)
          if (next && !cancel) {
            const saved = await saveSettings(userId, {
              rates: { ...s.rates, ...next },
              rates_updated_at: new Date().toISOString(),
            })
            if (!cancel) absorb(saved)
          }
        }
      } catch (e) {
        // Sin ajustes en la nube seguimos con el caché local: la app funciona igual.
        console.error('No se pudieron cargar los ajustes:', e)
      } finally {
        if (!cancel) setLoading(false)
      }
    }

    void boot()
    return () => {
      cancel = true
    }
  }, [userId, absorb])

  return (
    <SettingsContext.Provider
      value={{
        settings,
        loading,
        update,
        refreshRates,
        displayCurrency: getDisplayCurrency(),
        rates: getRates(),
        rateSource: getRateSource(),
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings debe usarse dentro de SettingsProvider')
  return ctx
}
