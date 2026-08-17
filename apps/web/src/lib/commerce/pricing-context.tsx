import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { getSupabaseClient } from '@/lib/supabase'
import {
  currencyForRegion,
  formatPlanPrice,
  planPriceMinor,
  regionForCountry,
  type PricingRegion,
} from '@/lib/commerce/pricing'
import type { PlanId } from '@/lib/commerce/plans'

/**
 * Resolves which commercial region a visitor is billed in, and formats FadeUp
 * plan prices for them.
 *
 * The country comes from the same first-party `locale-detect` edge function the
 * language default uses — it already returns `{ locale, source, country }` from
 * a reverse-proxy geo header. Reusing it means one network call and one trusted
 * server-side answer, rather than a second third-party IP lookup.
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
  currency: string
  /** False until the geo lookup settles; lets callers avoid flashing the wrong currency. */
  isResolved: boolean
  /** A plan's monthly price, in the visitor's region, formatted in their UI locale. */
  formatPlan: (planId: PlanId) => string
  /** Raw minor units, for callers that need to compare rather than display. */
  planMinor: (planId: PlanId) => number
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
    return {
      region,
      currency: currencyForRegion(region).currency,
      isResolved,
      formatPlan: (planId: PlanId) => formatPlanPrice(planId, region, i18n.language),
      planMinor: (planId: PlanId) => planPriceMinor(planId, region),
    }
  }, [country, isResolved, i18n.language])

  return <PricingContext.Provider value={value}>{children}</PricingContext.Provider>
}

export function useFadeUpPricing(): PricingContextValue {
  const ctx = useContext(PricingContext)
  if (!ctx) throw new Error('useFadeUpPricing must be used within a PricingProvider')
  return ctx
}

/**
 * Pricing where it is a nice-to-have rather than the point of the screen.
 *
 * Returns null outside a provider instead of throwing. The one caller is the
 * plan-intent banner on /pro/register: a professional application must render
 * whether or not commerce is mounted, and a decorative price line is not a
 * reason to make the whole form depend on geo detection.
 */
export function useOptionalFadeUpPricing(): PricingContextValue | null {
  return useContext(PricingContext)
}
