import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { countryName } from '@/lib/intl/countries'
import {
  ANYWHERE,
  effectiveCountry,
  getExplicitCountry,
  setExplicitCountry,
  type CountryPreference,
} from '@/lib/intl/country-preference'
import { useGeoSuggestion } from '@/lib/intl/geo'
import { getCurrentPosition, type Coordinates } from '@/lib/geolocation'

/**
 * Where the customer is, said only as accurately as FadeUp actually knows.
 *
 * ============================================================================
 * THREE PRECISIONS, AND NEVER A FOURTH
 * ============================================================================
 *
 * The blueprint's Home sketch shows "Paris 8e ⌄" above the headline, and that
 * is the right shape — but the neighbourhood in it is an illustration, not a
 * value FadeUp can produce. Nothing in this product resolves a customer to an
 * arrondissement: `locale-detect` returns a COUNTRY (server-side, from the
 * forwarded client address), and `navigator.geolocation` returns a latitude
 * and longitude with no reverse geocoder behind it. Printing a district name
 * would be inventing one, which CLAUDE.md forbids outright.
 *
 * So this hook exposes exactly what is known and lets the UI phrase it:
 *
 *   'precise'  the customer granted geolocation. Real coordinates go to the
 *              search, `distance_km` comes back real, and the label can say
 *              "Near you" — a claim the data supports.
 *   'country'  detection or an explicit pick resolved a country. The label is
 *              that country's name in the reader's own language.
 *   'unknown'  neither. The search is unfiltered and the label says so.
 *
 * ============================================================================
 * NOTHING IS REQUESTED WITHOUT A TAP
 * ============================================================================
 *
 * `lib/geolocation.ts` states the rule in its own source: only call it from an
 * explicit user action. A permission prompt on first paint is the pattern the
 * marketplace search already refuses, and Home — the first screen a customer
 * ever sees — is the worst possible place to break it. `requestPrecise` is
 * therefore only ever reachable from a button.
 *
 * ============================================================================
 * REUSED WHOLESALE, NOT REIMPLEMENTED
 * ============================================================================
 *
 * The country precedence (explicit choice > GeoIP > nothing), the "anywhere is
 * a stored choice, not a cleared key" distinction, the 24h localStorage cache
 * and the never-throws failure contract all already exist and are already
 * tested. This composes them; it does not restate them.
 */

export type LocationPrecision = 'precise' | 'country' | 'unknown'

/** What happened the last time precise location was asked for. */
export type PreciseLocationStatus = 'idle' | 'locating' | 'granted' | 'denied' | 'unsupported'

/** Radius applied when the customer shares precise coordinates. */
export const PRECISE_RADIUS_KM = 25

export interface CustomerLocation {
  precision: LocationPrecision
  /** ISO 3166-1 alpha-2 to filter the marketplace by, or null for everywhere. */
  countryCode: string | null
  /** That country's name in the reader's language, or null when unknown. */
  countryLabel: string | null
  /** True when the customer explicitly chose to search everywhere. */
  isAnywhere: boolean
  coordinates: Coordinates | null
  radiusKm: number | null
  preciseStatus: PreciseLocationStatus
  requestPrecise: () => void
  clearPrecise: () => void
  chooseCountry: (value: CountryPreference | null) => void
}

export function useCustomerLocation(): CustomerLocation {
  const { i18n } = useTranslation()
  const geo = useGeoSuggestion()

  // Mirrors the stored preference into React state so a change re-renders.
  // localStorage stays the source of truth — this is a view of it, written
  // through `chooseCountry` and never edited directly.
  const [explicit, setExplicit] = useState<CountryPreference | null>(() => getExplicitCountry())
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null)
  const [preciseStatus, setPreciseStatus] = useState<PreciseLocationStatus>('idle')

  // Deliberately not memoised: `effectiveCountry` reads the preference store
  // itself, so the value it returns is not a function of this component's
  // arguments and a dependency array would either be a lie or would go stale.
  // A localStorage read and two comparisons per render is cheaper than either.
  // `explicit` above is what turns a write into a re-render, which is what
  // makes this line re-read at the right moment.
  const countryCode = effectiveCountry(geo.countryCode)

  const requestPrecise = useCallback(() => {
    setPreciseStatus('locating')
    getCurrentPosition().then(
      (position) => {
        setCoordinates(position)
        setPreciseStatus('granted')
      },
      (error: unknown) => {
        setCoordinates(null)
        // `lib/geolocation.ts` rejects with exactly these two messages, and the
        // difference matters to the customer: one is a device that cannot do
        // this at all, the other is a permission they can still change.
        const reason = error instanceof Error ? error.message : ''
        setPreciseStatus(reason === 'geolocation-unavailable' ? 'unsupported' : 'denied')
      },
    )
  }, [])

  const clearPrecise = useCallback(() => {
    setCoordinates(null)
    setPreciseStatus('idle')
  }, [])

  const chooseCountry = useCallback((value: CountryPreference | null) => {
    setExplicitCountry(value)
    setExplicit(getExplicitCountry())
  }, [])

  const precision: LocationPrecision = coordinates ? 'precise' : countryCode ? 'country' : 'unknown'

  return {
    precision,
    countryCode,
    countryLabel: countryCode ? countryName(countryCode, i18n.language) : null,
    isAnywhere: explicit === ANYWHERE,
    coordinates,
    radiusKm: coordinates ? PRECISE_RADIUS_KM : null,
    preciseStatus,
    requestPrecise,
    clearPrecise,
    chooseCountry,
  }
}
