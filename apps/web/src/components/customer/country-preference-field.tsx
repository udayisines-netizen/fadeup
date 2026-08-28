import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SelectField } from '@/components/ui/select-field'
import { KNOWN_COUNTRIES, countryName } from '@/lib/intl/countries'
import { useGeoSuggestion } from '@/lib/intl/geo'
import { ANYWHERE, getExplicitCountry, setExplicitCountry } from '@/lib/intl/country-preference'

/**
 * ============================================================================
 * WHERE THE COUNTRY CHOICE LIVES
 * ============================================================================
 *
 * §31 requires a manual country override that persists, and the marketplace's
 * "Search everywhere" chip already sets one. That chip is a good place to turn
 * a filter OFF and a poor place to turn it back on: once it is gone, nothing
 * on the screen mentions countries at all, and the customer has no way to
 * discover why the results changed or how to change them back.
 *
 * So the reversible control lives in Profile, beside the other preferences —
 * language, habits — because that is where a person looks for a setting they
 * once changed and now want back.
 *
 * ============================================================================
 * THREE STATES, NOT TWO
 * ============================================================================
 *
 *   AUTOMATIC   no stored choice; GeoIP decides, and the option says which
 *               country that currently is, so "automatic" is never a mystery
 *   ANYWHERE    an explicit decision to search everywhere
 *   A COUNTRY   an explicit decision to search there
 *
 * Automatic and Anywhere look identical in the marketplace — both filter by
 * nothing when GeoIP knows nothing — and they behave completely differently
 * on the next visit, which is why they are separate options rather than one.
 */
export function CountryPreferenceField() {
  const { t, i18n } = useTranslation('customer-app')
  const geo = useGeoSuggestion()
  const [value, setValue] = useState<string>(() => getExplicitCountry() ?? '')

  const detectedLabel = geo.countryCode
    ? t('preferences.countryAutomaticWith', { country: countryName(geo.countryCode, i18n.language) })
    : t('preferences.countryAutomatic')

  return (
    <SelectField
      label={t('preferences.countryLabel')}
      value={value}
      onChange={(event) => {
        const next = event.target.value
        setValue(next)
        // Empty string is "no stored choice", which is a different thing from
        // ANYWHERE — see the note above and in country-preference.ts.
        setExplicitCountry(next === '' ? null : next)
      }}
      options={[
        { value: '', label: detectedLabel },
        { value: ANYWHERE, label: t('preferences.countryAnywhere') },
        // Sorted by the reader's own language, not by ISO code: an alphabetical
        // list of English names is not alphabetical in French or Japanese.
        ...KNOWN_COUNTRIES.map((country) => ({
          value: country.code,
          label: countryName(country.code, i18n.language),
        })).sort((a, b) => a.label.localeCompare(b.label, i18n.language)),
      ]}
    />
  )
}
