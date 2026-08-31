/**
 * The discovery scope control — the V3 port of the reviewed v2 location
 * selector's three real choices: share precise location (grants distance and
 * the Nearest sort), search the detected/chosen country, or search
 * everywhere. No choice is invented; every chip reflects the hook's actual
 * state, and a denied permission is said out loud rather than retried
 * silently.
 */
import { useTranslation } from 'react-i18next'

import { ANYWHERE } from '@/lib/intl/country-preference'
import type { CustomerLocation } from '@/customer-v3/hooks/use-customer-location'

export function LocationScope({ location }: { location: CustomerLocation }) {
  const { t } = useTranslation('v3')

  const preciseLabel =
    location.preciseStatus === 'granted'
      ? t('app.location.nearMe')
      : location.preciseStatus === 'locating'
        ? t('app.location.locating')
        : location.preciseStatus === 'denied'
          ? t('app.location.denied')
          : t('app.location.useMine')

  return (
    <div className="v3a-chips" role="group" aria-label={t('app.location.label')}>
      {location.preciseStatus !== 'unsupported' ? (
        <button
          type="button"
          className="v3-chip v3-press"
          aria-pressed={location.preciseStatus === 'granted'}
          disabled={location.preciseStatus === 'locating' || location.preciseStatus === 'denied'}
          onClick={() =>
            location.preciseStatus === 'granted' ? location.clearPrecise() : location.requestPrecise()
          }
        >
          {preciseLabel}
        </button>
      ) : null}
      <button
        type="button"
        className="v3-chip v3-press"
        aria-pressed={location.isAnywhere}
        onClick={() => location.chooseCountry(location.isAnywhere ? null : ANYWHERE)}
      >
        {location.isAnywhere
          ? t('app.location.everywhere')
          : (location.countryLabel ?? t('app.location.everywhere'))}
      </button>
    </div>
  )
}
