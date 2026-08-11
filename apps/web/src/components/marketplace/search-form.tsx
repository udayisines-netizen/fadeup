import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LocateFixed, Search } from 'lucide-react'
import { TextField } from '@/components/ui/text-field'
import { Button } from '@/components/ui/button'
import { getCurrentPosition } from '@/lib/geolocation'

export interface MarketplaceSearchValues {
  query: string
  city: string
  latitude: number | null
  longitude: number | null
}

interface MarketplaceSearchFormProps {
  initialValues?: Partial<MarketplaceSearchValues>
  onSubmit: (values: MarketplaceSearchValues) => void
  /** Compact layout for the results page's refine bar vs. the full hero form. */
  compact?: boolean
}

const POPULAR_KEYS = ['popularFade', 'popularHaircut', 'popularBeard', 'popularHaircutBeard'] as const

/**
 * The one search entry point shared by the marketplace home hero and the
 * results page's refine bar. Geolocation is only ever requested from this
 * component's explicit "Use my location" button click — never on mount —
 * per spec section 09.
 */
export function MarketplaceSearchForm({ initialValues, onSubmit, compact = false }: MarketplaceSearchFormProps) {
  const { t } = useTranslation('marketplace')
  const [query, setQuery] = useState(initialValues?.query ?? '')
  const [city, setCity] = useState(initialValues?.city ?? '')
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(
    initialValues?.latitude != null && initialValues?.longitude != null
      ? { latitude: initialValues.latitude, longitude: initialValues.longitude }
      : null,
  )
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)

  async function handleUseLocation() {
    setLocating(true)
    setLocationError(null)
    try {
      const position = await getCurrentPosition()
      setCoords(position)
      setCity('')
    } catch {
      setLocationError(t('searchForm.locationUnavailable'))
    } finally {
      setLocating(false)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    onSubmit({ query: query.trim(), city: city.trim(), latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null })
  }

  function handleCityChange(value: string) {
    setCity(value)
    if (value) setCoords(null)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className={compact ? 'grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]' : 'grid grid-cols-1 gap-3 sm:grid-cols-2'}>
        <TextField
          label={t('searchForm.whatLabel')}
          placeholder={t('searchForm.whatPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <TextField
            label={t('searchForm.whereLabel')}
            placeholder={t('searchForm.wherePlaceholder')}
            value={coords ? t('searchForm.currentLocation') : city}
            onChange={(event) => handleCityChange(event.target.value)}
            disabled={Boolean(coords)}
          />
          <button
            type="button"
            onClick={handleUseLocation}
            disabled={locating}
            className="flex items-center gap-1.5 self-start text-xs font-medium text-accent-700 hover:text-accent-800 disabled:text-ink-300"
          >
            <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
            {locating ? t('searchForm.locating') : t('searchForm.useLocation')}
          </button>
          {locationError ? <p className="text-xs text-danger-600">{locationError}</p> : null}
        </div>
        <Button type="submit" size="lg" leftIcon={<Search className="h-4 w-4" aria-hidden="true" />} className={compact ? 'sm:self-end' : ''}>
          {t('searchForm.submit')}
        </Button>
      </div>

      {!compact ? (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-500">{t('searchForm.popularLabel')}:</span>
          {POPULAR_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setQuery(t(`searchForm.${key}`))
                onSubmit({ query: t(`searchForm.${key}`), city, latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null })
              }}
              className="rounded-full border border-border-strong px-3 py-1 text-ink-700 hover:bg-paper-100"
            >
              {t(`searchForm.${key}`)}
            </button>
          ))}
        </div>
      ) : null}
    </form>
  )
}
