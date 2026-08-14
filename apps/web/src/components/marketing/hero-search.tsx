import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LocateFixed, Search } from 'lucide-react'
import { getCurrentPosition } from '@/lib/geolocation'
import { cn } from '@/lib/cn'

/**
 * The consumer landing's primary product element.
 *
 * Deliberately not the shared MarketplaceSearchForm: that one is a stacked
 * label-above-input form, correct for the results page's refine bar and wrong
 * as the single most important object on the homepage. Here the two fields and
 * the action read as ONE control — a search bar, the way a marketplace's
 * search bar looks — rather than a form floating inside a card.
 *
 * Semantics are identical to the rest of the marketplace: a free-text query
 * (barber, shop or service) plus a place, either typed or taken from the
 * device. Geolocation is only ever requested from an explicit press, never on
 * mount. Submitting navigates to /search with the query in the URL, so a
 * search stays shareable.
 */
export function HeroSearch({ className, autoFocus = false }: { className?: string; autoFocus?: boolean }) {
  const { t } = useTranslation('marketplace')
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [city, setCity] = useState('')
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null)
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
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (city.trim()) params.set('city', city.trim())
    if (coords) {
      params.set('lat', String(coords.latitude))
      params.set('lng', String(coords.longitude))
    }
    navigate(`/search?${params.toString()}`)
  }

  return (
    <div className={cn('w-full', className)}>
      <form onSubmit={handleSubmit} className="w-full">
        {/*
          One bar on desktop, stacked on phones. The divider between the two
          fields is a border on the second field rather than a separate
          element, so it flips correctly under RTL without any extra rules.
        */}
        <div className="flex flex-col overflow-hidden rounded-xl border border-border-strong bg-paper-0 shadow-sm transition-shadow focus-within:shadow-md sm:flex-row sm:items-stretch">
          <label className="flex min-w-0 flex-1 items-center gap-3 px-5 py-4">
            <Search className="h-5 w-5 shrink-0 text-ink-300" aria-hidden="true" />
            <span className="sr-only">{t('searchForm.whatLabel')}</span>
            <input
              type="search"
              autoFocus={autoFocus}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('searchForm.whatPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-base text-ink-950 outline-none placeholder:text-ink-300"
            />
          </label>

          <label className="flex min-w-0 flex-1 items-center gap-3 border-t border-border px-5 py-4 sm:border-t-0 sm:border-s">
            <span className="sr-only">{t('searchForm.whereLabel')}</span>
            <input
              type="text"
              value={coords ? t('searchForm.currentLocation') : city}
              onChange={(event) => {
                setCity(event.target.value)
                if (event.target.value) setCoords(null)
              }}
              placeholder={t('searchForm.wherePlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-base text-ink-950 outline-none placeholder:text-ink-300"
            />
            <button
              type="button"
              onClick={() => void handleUseLocation()}
              disabled={locating}
              aria-label={t('searchForm.useLocation')}
              title={t('searchForm.useLocation')}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-950 disabled:opacity-50"
            >
              <LocateFixed className={cn('h-4 w-4', locating && 'animate-pulse')} aria-hidden="true" />
            </button>
          </label>

          <div className="border-t border-border p-2 sm:border-t-0 sm:border-s sm:p-2">
            <button
              type="submit"
              className="inline-flex h-full min-h-12 w-full items-center justify-center rounded-lg bg-accent-600 px-7 text-base font-medium text-on-accent transition-colors hover:bg-accent-700 sm:w-auto"
            >
              {t('searchForm.submit')}
            </button>
          </div>
        </div>
      </form>

      {locationError ? (
        <p role="status" className="mt-2 text-sm text-danger-600">
          {locationError}
        </p>
      ) : null}
    </div>
  )
}
