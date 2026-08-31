/**
 * FadeUp V3 — Marketplace.
 *
 * Desktop is a genuine location marketplace: results beside a sticky map
 * with two-way pin↔row coordination. Mobile is list-first with a compact
 * chip rail; the Map view exists only when at least one result carries real
 * coordinates (the RPC returns them only when the customer shares location).
 *
 * State survives navigation: `?q&city&open&sort&view` — the same URL
 * contract the product has carried since R5R, plus `city` so the landing
 * search deep-links honestly. maplibre stays lazy (~950kB pre-gzip).
 *
 * Truth rules: `marketplace_supply_type` consumed verbatim; totalCount from
 * the server; keepPreviousData so refinement narrows in place; no fake pins;
 * no invented sorts (`rating` and `available_soonest` have no contracts).
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  useSearchPublicProfessionals,
  usePublicCurrencies,
  isMarketplaceSort,
  type MarketplaceSort,
  type MarketplaceProfessionalResult,
} from '@/lib/queries/marketplace'
import { useCustomerLocation } from '@/customer-v2/hooks/use-customer-location'
import { useDebounced } from '@/customer-v2/hooks/use-delayed'
import { useMoney } from '@/lib/intl/use-intl'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { ResultRow } from '@/customer-v3/ui/result-row'

const V3ResultsMap = lazy(() => import('@/customer-v3/marketplace/v3-results-map'))

const PAGE_SIZE = 24

export function CustomerV3MarketplacePage() {
  const { t } = useTranslation('v3')
  useDocumentMeta({ title: t('app.market.metaTitle'), description: t('app.market.metaDescription'), noIndex: true })

  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') ?? ''
  const city = searchParams.get('city') ?? ''
  const openNowOnly = searchParams.get('open') === '1'
  const sortParam = searchParams.get('sort')
  const sort: MarketplaceSort = isMarketplaceSort(sortParam) ? sortParam : 'recommended'

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (value === null || value === '') next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  const location = useCustomerLocation()
  const nearestAvailable = location.coordinates != null
  const effectiveSort: MarketplaceSort = sort === 'nearest' && !nearestAvailable ? 'recommended' : sort

  const debouncedQuery = useDebounced(query, 300)
  const debouncedCity = useDebounced(city, 300)

  const search = useSearchPublicProfessionals(
    {
      country: location.isAnywhere ? null : location.countryCode,
      city: debouncedCity || null,
      query: debouncedQuery || null,
      latitude: location.coordinates?.latitude ?? null,
      longitude: location.coordinates?.longitude ?? null,
      openNowOnly,
      sort: effectiveSort,
      entityType: 'shop',
      limit: PAGE_SIZE,
    },
    { keepPreviousData: true },
  )

  const results = search.data ?? []
  const totalCount = results[0]?.totalCount ?? 0
  const currencies = usePublicCurrencies(results.map((r) => r.organizationId))
  const money = useMoney()

  const hasCoordinates = useMemo(() => results.some((r) => r.latitude != null && r.longitude != null), [results])
  const mapView = hasCoordinates && searchParams.get('view') === 'map'
  const [activeId, setActiveId] = useState<string | null>(null)
  const isDesktop = useIsDesktop()

  const priceLabelFor = (result: MarketplaceProfessionalResult) =>
    result.startingPriceCents != null && currencies[result.organizationId]
      ? money(result.startingPriceCents, currencies[result.organizationId], { trimWholeAmounts: true })
      : null

  const sortOptions: Array<{ value: MarketplaceSort; label: string }> = [
    { value: 'recommended', label: t('app.market.sortRecommended') },
    ...(nearestAvailable ? [{ value: 'nearest' as MarketplaceSort, label: t('app.market.sortNearest') }] : []),
    { value: 'price', label: t('app.market.sortPrice') },
  ]

  const list = search.isError ? (
    <p className="v3a-error" role="alert">
      {t('app.errors.load')}
    </p>
  ) : search.isPending ? (
    <div className="v3a-results" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="v3a-skeleton-row">
          <span className="v3-skeleton" style={{ inlineSize: '38%', blockSize: '1.1rem' }} />
          <span className="v3-skeleton" style={{ inlineSize: '60%', blockSize: '0.85rem' }} />
        </div>
      ))}
    </div>
  ) : results.length === 0 ? (
    <div className="v3a-empty">
      <p className="v3a-empty-title">{t('app.market.emptyTitle')}</p>
      <p className="v3-meta">{t('app.market.emptyBody')}</p>
      {(query || city || openNowOnly) && (
        <button
          type="button"
          className="v3-btn v3-btn--quiet v3-press"
          onClick={() => {
            setParam('q', null)
            setParam('city', null)
            setParam('open', null)
          }}
        >
          {t('app.market.clearFilters')}
        </button>
      )}
    </div>
  ) : (
    <div className="v3a-results">
      {results.map((result) => (
        <ResultRow
          key={result.locationId}
          result={result}
          currency={currencies[result.organizationId]}
          active={activeId === result.locationId}
          onHover={setActiveId}
        />
      ))}
    </div>
  )

  const map = hasCoordinates ? (
    <Suspense fallback={<div className="v3a-map-panel v3-skeleton" aria-hidden="true" />}>
      <V3ResultsMap
        className={mapView ? 'v3a-map-panel v3a-map-mobile' : 'v3a-map-panel'}
        results={results}
        activeId={activeId}
        onSelect={(result) => setActiveId(result.locationId)}
        priceLabelFor={priceLabelFor}
      />
    </Suspense>
  ) : null

  return (
    <div>
      <header className="v3a-page-head">
        <h1 className="v3-h1">{t('app.market.title')}</h1>
        {!search.isPending && !search.isError ? (
          <p className="v3-meta v3a-market-count" role="status">
            {t('app.market.count', { count: totalCount })}
          </p>
        ) : null}
      </header>

      <label className="v3a-search">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(event) => setParam('q', event.target.value || null)}
          placeholder={t('landing.search.whatPlaceholder')}
          aria-label={t('landing.search.whatLabel')}
        />
      </label>

      <div className="v3a-chips" role="group" aria-label={t('app.market.filtersLabel')}>
        <button
          type="button"
          className="v3-chip v3-press"
          aria-pressed={openNowOnly}
          onClick={() => setParam('open', openNowOnly ? null : '1')}
        >
          {t('app.market.openNow')}
        </button>
        {sortOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className="v3-chip v3-press"
            aria-pressed={effectiveSort === option.value}
            onClick={() => setParam('sort', option.value === 'recommended' ? null : option.value)}
          >
            {option.label}
          </button>
        ))}
        {hasCoordinates ? (
          <button
            type="button"
            className="v3-chip v3-press"
            aria-pressed={mapView}
            onClick={() => setParam('view', mapView ? null : 'map')}
          >
            {t('app.market.mapView')}
          </button>
        ) : null}
      </div>

      {/* Mobile: list OR map (toggled). Desktop: list AND sticky map. */}
      <div className="v3a-market" data-has-map={hasCoordinates}>
        <div className="v3a-market-list" hidden={mapView && !isDesktop}>
          {list}
        </div>
        {mapView || isDesktop ? map : null}
      </div>
    </div>
  )
}

/**
 * The desktop split renders the map permanently; on mobile it mounts only in
 * map view — maplibre never loads on a phone that never asked for it.
 */
function useIsDesktop(): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 64rem)').matches,
  )
  useEffect(() => {
    const media = window.matchMedia('(min-width: 64rem)')
    const onChange = () => setMatches(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return matches
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" strokeLinecap="round" />
    </svg>
  )
}
