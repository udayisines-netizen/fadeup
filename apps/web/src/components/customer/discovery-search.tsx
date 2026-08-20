import { useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LocateFixed, MapPin, Search, SearchX, X } from 'lucide-react'
import { useSearchPublicProfessionals, usePublicCurrencies } from '@/lib/queries/marketplace'
import { getCurrentPosition } from '@/lib/geolocation'
import { countryName } from '@/lib/intl/countries'
import { BusinessListingCard } from '@/components/customer/business-listing-card'
import { SectionHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'

/**
 * The marketplace search experience: one component, used by the public
 * `/search` page and by the signed-in customer home.
 *
 * It exists as a component rather than a page because those two surfaces were
 * previously a real dead end in the product — the signed-in home's entire
 * "discover" section was a card whose only content was a button to /search.
 * A customer's most common intent cost them a navigation before it could even
 * begin. Now both surfaces ARE the search.
 *
 * ============================================================================
 * THE CHIPS ARE REAL FILTERS
 * ============================================================================
 *
 * The reference puts a row of category chips under the search bar. FadeUp has
 * no cross-shop service taxonomy, so "categories" in that sense do not exist —
 * but `search_public_professionals` takes `p_service_query`, an accent-
 * insensitive match against the service names shops actually publish. Each
 * service chip sends its own translated label into that parameter, which is
 * correct precisely BECAUSE it is translated: a French shop names the service
 * "Dégradé", and a French customer's chip searches for "Dégradé".
 *
 * The remaining chips map to `p_entity_type` and `p_open_now_only`. Nothing on
 * this rail is a client-side re-filter of an already-loaded page, so an empty
 * result is a true statement about the database rather than about this render.
 *
 * ============================================================================
 * STATE LIVES IN THE URL
 * ============================================================================
 *
 * Shareable, and Back does what a customer means by Back. Text typing uses
 * `replace` so Back leaves the marketplace instead of walking the query string
 * backwards one character at a time.
 */

type EntityFilter = 'all' | 'shop' | 'barber'

/** Chips whose label IS the query. See the service-query note above. */
const SERVICE_CHIP_KEYS = ['popularFade', 'popularHaircut', 'popularBeard', 'popularHaircutBeard'] as const

export function DiscoverySearch({
  /**
   * GeoIP country, applied as a starting filter when the customer has not
   * chosen a place themselves. It is always rendered as a REMOVABLE chip —
   * a filter a customer cannot see is a filter that makes the product look
   * empty for reasons they can never discover.
   */
  suggestedCountry = null,
  headingAs = 'h2',
  className,
}: {
  suggestedCountry?: string | null
  headingAs?: 'h2' | 'h3'
  className?: string
}) {
  const { t, i18n } = useTranslation('marketplace')
  const [searchParams, setSearchParams] = useSearchParams()

  const query = searchParams.get('q') ?? ''
  const city = searchParams.get('city') ?? ''
  const latParam = searchParams.get('lat')
  const lngParam = searchParams.get('lng')
  const latitude = latParam ? Number(latParam) : null
  const longitude = lngParam ? Number(lngParam) : null
  const service = searchParams.get('service') ?? ''
  const openNowOnly = searchParams.get('openNow') === '1'
  const entityFilter = (searchParams.get('type') as EntityFilter | null) ?? 'all'

  // `country=any` is how a customer switches the geo suggestion off, and it
  // has to be a distinct value from "absent" so that removing it sticks.
  const countryParam = searchParams.get('country')
  const country = countryParam === 'any' ? null : (countryParam ?? (city || latitude != null ? null : suggestedCountry))
  const countryIsImplicit = countryParam === null && Boolean(country)

  const [draftQuery, setDraftQuery] = useState(query)
  const [draftCity, setDraftCity] = useState(city)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)

  const resultsQuery = useSearchPublicProfessionals({
    query: query || null,
    city: city || null,
    country,
    latitude,
    longitude,
    // A coordinate with no radius would rank by distance but still return the
    // whole world; 25km is the radius the marketplace has always used.
    radiusKm: latitude != null ? 25 : null,
    serviceQuery: service || null,
    openNowOnly,
    entityType: entityFilter === 'all' ? null : entityFilter,
    limit: 24,
  })

  const results = useMemo(() => resultsQuery.data ?? [], [resultsQuery.data])
  // One batch lookup for the shops on screen: a marketplace spans countries,
  // so every card is priced in ITS OWN shop's currency.
  const currencies = usePublicCurrencies(useMemo(() => results.map((r) => r.organizationId), [results]))

  const serviceChips = SERVICE_CHIP_KEYS.map((key) => t(`searchForm.${key}`))
  const hasCustomService = Boolean(service) && !serviceChips.includes(service)
  const hasActiveFilters = Boolean(service) || openNowOnly || entityFilter !== 'all'

  const usingCoords = latitude != null && longitude != null
  const placeLabel = city || (usingCoords ? t('searchForm.currentLocation') : '')
  const headingLabel = placeLabel || (country ? countryName(country, i18n.language) : '')

  function updateParams(mutate: (params: URLSearchParams) => void, options?: { replace?: boolean }) {
    const next = new URLSearchParams(searchParams)
    mutate(next)
    setSearchParams(next, { replace: options?.replace ?? false })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    updateParams((params) => {
      const trimmedQuery = draftQuery.trim()
      const trimmedCity = draftCity.trim()
      if (trimmedQuery) params.set('q', trimmedQuery)
      else params.delete('q')
      if (trimmedCity) {
        params.set('city', trimmedCity)
        // A typed city and a GPS fix are two answers to the same question.
        params.delete('lat')
        params.delete('lng')
      } else {
        params.delete('city')
      }
    })
  }

  async function handleUseLocation() {
    setLocating(true)
    setLocationError(null)
    try {
      const position = await getCurrentPosition()
      setDraftCity('')
      updateParams((params) => {
        params.set('lat', position.latitude.toString())
        params.set('lng', position.longitude.toString())
        params.delete('city')
      })
    } catch {
      setLocationError(t('searchForm.locationUnavailable'))
    } finally {
      setLocating(false)
    }
  }

  function toggleParam(key: string, value: string, active: boolean) {
    updateParams((params) => (active ? params.delete(key) : params.set(key, value)))
  }

  return (
    <div className={cn('flex flex-col gap-5', className)}>
      {/* ------------------------------------------------------------------
          The search panel. One object, two questions — what and where —
          separated by a rule rather than being two boxed inputs with two
          floating labels. This is the single most-looked-at element on the
          consumer side of FadeUp and it should read as one control.
          ------------------------------------------------------------------ */}
      <form
        role="search"
        onSubmit={handleSubmit}
        className={cn(
          'flex flex-col gap-1 rounded-2xl border border-border bg-paper-0 p-2 shadow-xs',
          'focus-within:border-accent-300 sm:flex-row sm:items-center sm:gap-0',
        )}
      >
        <div className="relative flex min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute start-3 h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
          <input
            type="search"
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder={t('searchForm.whatPlaceholder')}
            aria-label={t('searchForm.whatLabel')}
            className="h-12 w-full min-w-0 rounded-xl bg-transparent ps-10 pe-3 text-sm text-ink-950 placeholder:text-ink-500 focus:outline-none"
          />
        </div>

        <span aria-hidden="true" className="hidden h-7 w-px shrink-0 bg-border sm:block" />

        <div className="relative flex min-w-0 flex-1 items-center">
          <MapPin className="pointer-events-none absolute start-3 h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
          <input
            type="text"
            value={usingCoords ? t('searchForm.currentLocation') : draftCity}
            onChange={(event) => setDraftCity(event.target.value)}
            readOnly={usingCoords}
            placeholder={t('searchForm.wherePlaceholder')}
            aria-label={t('searchForm.whereLabel')}
            className="h-12 w-full min-w-0 rounded-xl bg-transparent ps-10 pe-12 text-sm text-ink-950 placeholder:text-ink-500 focus:outline-none read-only:text-ink-700"
          />
          {usingCoords ? (
            <button
              type="button"
              onClick={() => updateParams((params) => {
                params.delete('lat')
                params.delete('lng')
              })}
              aria-label={t('searchForm.clearLocation')}
              className="absolute end-2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-paper-100 hover:text-ink-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleUseLocation()}
              disabled={locating}
              aria-label={t('searchForm.useLocation')}
              title={t('searchForm.useLocation')}
              className="absolute end-2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-paper-100 hover:text-accent-700 disabled:text-ink-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            >
              <LocateFixed className={cn('h-4 w-4', locating && 'animate-pulse')} aria-hidden="true" />
            </button>
          )}
        </div>

        <Button type="submit" size="lg" className="h-12 shrink-0 sm:ms-1">
          {t('searchForm.submit')}
        </Button>
      </form>

      {locationError ? (
        <p role="status" className="-mt-3 text-xs text-danger-600">
          {locationError}
        </p>
      ) : null}

      {/* ------------------------------------------------------------------
          Filter rail. Scrolls horizontally on a phone rather than wrapping
          into three stacked rows that push the results below the fold.
          ------------------------------------------------------------------ */}
      <div
        role="group"
        aria-label={t('filters.label')}
        className="fu-scroll-x -mx-4 flex items-center gap-2 px-4 sm:mx-0 sm:flex-wrap sm:px-0"
      >
        <FilterChip
          active={openNowOnly}
          onClick={() => toggleParam('openNow', '1', openNowOnly)}
          label={t('results.filters.openNowLabel')}
        />
        <span aria-hidden="true" className="h-6 w-px shrink-0 bg-border" />
        <FilterChip
          active={entityFilter === 'shop'}
          onClick={() => toggleParam('type', 'shop', entityFilter === 'shop')}
          label={t('results.filters.typeShops')}
        />
        <FilterChip
          active={entityFilter === 'barber'}
          onClick={() => toggleParam('type', 'barber', entityFilter === 'barber')}
          label={t('results.filters.typeBarbers')}
        />
        <span aria-hidden="true" className="h-6 w-px shrink-0 bg-border" />
        {serviceChips.map((label) => (
          <FilterChip
            key={label}
            active={service === label}
            onClick={() => toggleParam('service', label, service === label)}
            label={label}
          />
        ))}
        {/* A service arriving from a shared link that is not one of the chips
            still shows as an active, removable filter. */}
        {hasCustomService ? (
          <FilterChip active onClick={() => toggleParam('service', service, true)} label={service} />
        ) : null}
      </div>

      <section className="flex flex-col gap-3">
        <SectionHeader
          as={headingAs}
          title={headingLabel ? t('results.headingWithLocation', { location: headingLabel }) : t('results.headingGeneric')}
          meta={resultsQuery.isSuccess ? t('results.resultCount', { count: results.length }) : undefined}
          action={
            // Only when implicit: a country the customer typed themselves is
            // not a surprise that needs explaining. And only alongside actual
            // results — when there are none, the empty state carries the same
            // escape hatch, and two of them is one too many.
            countryIsImplicit && country && results.length > 0 ? (
              <button
                type="button"
                onClick={() => updateParams((params) => params.set('country', 'any'))}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-ink-700 hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
              >
                {t('results.searchEverywhere')}
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : undefined
          }
        />

        {resultsQuery.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-72 w-full rounded-xl" />
            ))}
          </div>
        ) : resultsQuery.isError ? (
          <ErrorState
            title={t('results.errorTitle')}
            description={resultsQuery.error.message}
            action={
              <Button variant="secondary" onClick={() => void resultsQuery.refetch()}>
                {t('common:action.tryAgain')}
              </Button>
            }
          />
        ) : results.length === 0 ? (
          hasActiveFilters ? (
            <EmptyState
              icon={SearchX}
              title={t('results.emptyTitle')}
              description={t('results.emptyDescription')}
              action={
                <Button
                  variant="secondary"
                  onClick={() =>
                    updateParams((params) => {
                      params.delete('service')
                      params.delete('openNow')
                      params.delete('type')
                    })
                  }
                >
                  {t('results.clearFilters')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title={t('results.emptyNoneAtAllTitle')}
              description={t('results.emptyNoneAtAllDescription')}
              action={
                countryIsImplicit && country ? (
                  <Button variant="secondary" onClick={() => updateParams((params) => params.set('country', 'any'))}>
                    {t('results.searchEverywhere')}
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((result) => (
              <BusinessListingCard
                key={`${result.entityType}-${result.organizationId}-${result.barberId ?? result.locationId}`}
                result={result}
                currency={currencies[result.organizationId]}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * `aria-pressed` rather than a checkbox: these are toggle buttons that change
 * the content below them immediately, and a screen reader should hear the
 * pressed state, not a form control awaiting submission.
 */
function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center rounded-xl border px-3.5 text-sm font-medium',
        'transition-colors duration-[--fu-duration-quick] motion-reduce:transition-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700',
        active
          ? 'border-accent-600 bg-accent-100 text-accent-800'
          : 'border-border bg-paper-0 text-ink-700 hover:border-border-strong',
      )}
    >
      {label}
    </button>
  )
}
