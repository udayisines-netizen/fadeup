import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { getSupabaseClient } from '@/lib/supabase'
import {
  formatPrice,
  pricingForRegion,
  regionForCountry,
  type PricingRegion,
  type RegionPricing,
} from '@/lib/commerce/pricing'

/**
 * Resolves which commercial region a visitor is billed in, and formats FadeUp
 * prices for them.
 *
 * The country comes from the same first-party `locale-detect` edge function
 * the language default uses — it already returns `{ locale, source, country }`
 * from a reverse-proxy geo header. Reusing it means one network call and one
 * trusted server-side answer, rather than a second third-party IP lookup.
 *
 * The two consumers of that call are deliberately independent:
 *
 *   country -> LANGUAGE default   (overridable by the user, forever)
 *   country -> PRICING region     (not a preference — it is where you are)
 *
 * So switching the interface to English in Paris changes the words and not the
 * currency. `intl` is the honest answer while detection is pending or has
 * failed, and the UI can show a neutral state rather than guessing wrong.
 */

interface PricingContextValue {
  region: PricingRegion
  pricing: RegionPricing
  /** False until the geo lookup settles; lets callers avoid flashing the wrong currency. */
  isResolved: boolean
  /** FadeUp's monthly subscription, formatted in the visitor's UI locale. */
  formattedMonthly: string
}

const PricingContext = createContext<PricingContextValue | null>(null)

const COUNTRY_CACHE_KEY = 'fadeup-commercial-country'

function readCachedCountry(): string | null {
  try {
    return localStorage.getItem(COUNTRY_CACHE_KEY)
  } catch {
    return null
  }
}

function writeCachedCountry(country: string): void {
  try {
    localStorage.setItem(COUNTRY_CACHE_KEY, country)
  } catch {
    // Non-fatal — detection just repeats next load.
  }
}

export function PricingProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  const cached = readCachedCountry()
  const [country, setCountry] = useState<string | null>(cached)
  const [isResolved, setIsResolved] = useState(cached !== null)

  useEffect(() => {
    if (cached) return
    let cancelled = false

    async function detect() {
      try {
        const supabase = getSupabaseClient()
        const { data, error } = await supabase.functions.invoke<{ country: string | null }>('locale-detect')
        if (error) throw error
        if (cancelled) return
        if (data?.country) {
          writeCachedCountry(data.country)
          setCountry(data.country)
        }
      } catch {
        // Geo unavailable — `intl` pricing stands, which is the documented
        // default rather than a guess dressed up as a local price.
      } finally {
        if (!cancelled) setIsResolved(true)
      }
    }

    void detect()
    return () => {
      cancelled = true
    }
  }, [cached])

  const value = useMemo<PricingContextValue>(() => {
    const region = regionForCountry(country)
    const pricing = pricingForRegion(region)
    return {
      region,
      pricing,
      isResolved,
      formattedMonthly: formatPrice(pricing, i18n.language),
    }
  }, [country, isResolved, i18n.language])

  return <PricingContext.Provider value={value}>{children}</PricingContext.Provider>
}

export function useFadeUpPricing(): PricingContextValue {
  const ctx = useContext(PricingContext)
  if (!ctx) throw new Error('useFadeUpPricing must be used within a PricingProvider')
  return ctx
}
