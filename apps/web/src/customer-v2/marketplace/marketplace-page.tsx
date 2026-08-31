import { Suspense, lazy, useEffect, useLayoutEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { isMarketplaceSort, type MarketplaceSort } from '@/lib/queries/marketplace'
import { ANYWHERE } from '@/lib/intl/country-preference'
import { useTrackView } from '@/lib/analytics'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useCustomerLocation } from '@/customer-v2/hooks/use-customer-location'
import {
  useMarketplaceDiscovery,
  type MarketplaceDiscovery,
} from '@/customer-v2/hooks/use-marketplace-discovery'
import { useDebounced, useDelayedFlag } from '@/customer-v2/hooks/use-delayed'
import { LocationSelector } from '@/customer-v2/home/location-selector'
import { SearchEntry } from '@/customer-v2/home/search-entry'
import { ProfessionalResult } from '@/customer-v2/home/professional-result'
import { ResultSkeleton } from '@/customer-v2/home/result-skeleton'
import { Notice } from '@/customer-v2/ui/notice'

/**
 * The Marketplace — where a customer COMPARES the supply Home introduced.
 *
 * ============================================================================
 * DESIGN PASS A: LIST + MAP, AND STATE THAT SURVIVES NAVIGATION
 * ============================================================================
 *
 * Desktop stops centring a phone list in a 1440px viewport. When at least one
 * result carries REAL coordinates the page is a Fresha-style split — an
 * independently scrolling list beside a sticky map with real pins (the RPC
 * already returns latitude/longitude per row; nothing is geocoded here).
 * With zero geocoded results the page is a wide list and no map exists at
 * all: an empty decorative map is exactly the fabrication the rules ban.
 * The map module is lazy — maplibre never enters the initial bundle.
 *
 * Query, Open-now and sort live in the URL (`?q&open&sort`), so
 * Marketplace → profile → Back restores the search instead of restarting
 * discovery; the scroll position is restored from sessionStorage the same
 * way. `replace` keeps typing from spamming history.
 *
 * Supply rules are untouched: one unified list, Independent + Barbershop,
 * staff barbers structurally excluded, `marketplace_supply_type` only.
 *
 * ============================================================================
 * THE FILTER ROW TELLS THE TRUTH ABOUT ITSELF
 * ============================================================================
 *
 * One compact chip row: Open now, then the sorts the backend genuinely has
 * (`recommended` / `nearest`-when-precise / `price`). Distance, price-range
 * and "when" filters do not exist in the contract, so no chip pretends they
 * do — a control that silently falls back teaches customers to distrust
 * controls.
 */

const V2ResultsMap = lazy(() => import('@/customer-v2/marketplace/v2-results-map'))

const SCROLL_KEY = 'v2-marketplace-scroll'

export function CustomerV2MarketplacePage() {
  const { t } = useTranslation()

  const location = useCustomerLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  const query = searchParams.get('q') ?? ''
  const openNowOnly = searchParams.get('open') === '1'
  const sortParam = searchParams.get('sort')
  const sort: MarketplaceSort = isMarketplaceSort(sortParam) ? sortParam : 'recommended'

  const setParam = (key: string, value: string | null) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )
  }

  const debouncedQuery = useDebounced(query, 300)

  /*
    If the customer chose "Nearest" and then turned precise location off, the
    stored preference survives in the URL but the QUERY falls back to the
    ordering that still means something — and the UI hides the chip, so state
    and presentation cannot disagree.
  */
  const nearestAvailable = location.precision === 'precise'
  const effectiveSort: MarketplaceSort =
    sort === 'nearest' && !nearestAvailable ? 'recommended' : sort

  const discovery = useMarketplaceDiscovery({
    location,
    query: debouncedQuery,
    openNowOnly,
    sort: effectiveSort,
  })

  useDocumentMeta({
    title: t('customer-app:v2.marketplace.documentTitle'),
    description: t('customer-app:v2.marketplace.documentDescription'),
    noIndex: true,
  })

  /* The same two R3 funnel events the legacy marketplace records. Only the
     query's LENGTH is sent — the string itself never leaves the device. */
  useTrackView('discovery_viewed', { properties: { surface: 'marketplace' } }, true)
  useTrackView(
    'search_performed',
    {
      properties: {
        result_count: discovery.listings.length,
        has_filters: openNowOnly || effectiveSort !== 'recommended',
        query_length: debouncedQuery.length,
      },
    },
    !discovery.isPending && !discovery.isError && debouncedQuery.length > 0,
  )

  /* ── Scroll restoration: leaving saves, returning restores once. ───────── */
  const restoredRef = useRef(false)
  useEffect(() => {
    return () => {
      sessionStorage.setItem(SCROLL_KEY, String(window.scrollY))
    }
  }, [])
  useLayoutEffect(() => {
    if (restoredRef.current || discovery.isPending) return
    restoredRef.current = true
    const saved = Number(sessionStorage.getItem(SCROLL_KEY) ?? 0)
    if (saved > 0) window.scrollTo(0, saved)
  }, [discovery.isPending])

  const showSkeletons = useDelayedFlag(discovery.isPending)

  const sortOptions: Array<{ value: MarketplaceSort; label: string }> = [
    { value: 'recommended', label: t('customer-app:v2.marketplace.sortRecommended') },
    ...(nearestAvailable
      ? [{ value: 'nearest' as MarketplaceSort, label: t('customer-app:v2.marketplace.sortNearest') }]
      : []),
    { value: 'price', label: t('customer-app:v2.marketplace.sortPrice') },
  ]

  const hasCoordinates = discovery.listings.some(
    (listing) => listing.result.latitude !== null && listing.result.longitude !== null,
  )

  const chip = (selected: boolean) =>
    selected
      ? 'inline-flex h-8 items-center rounded-v2-2 bg-v2-green-tint px-3 text-v2-meta font-semibold text-v2-green-ink'
      : 'inline-flex h-8 items-center rounded-v2-2 border border-v2-hairline bg-v2-paper px-3 text-v2-meta font-medium text-v2-ink-soft'

  const list = (
    <Body
      discovery={discovery}
      showSkeletons={showSkeletons}
      onClearFilters={() => {
        setParam('q', null)
        setParam('open', null)
      }}
      onSearchEverywhere={location.countryCode ? () => location.chooseCountry(ANYWHERE) : null}
    />
  )

  return (
    <div className="flex flex-col">
      <div className="flex min-h-11 items-center justify-start gap-2">
        <LocationSelector location={location} />
        <h1 className="sr-only">{t('customer-app:v2.marketplace.title')}</h1>
      </div>

      <div className="mt-2.5 lg:max-w-[30rem]">
        <SearchEntry value={query} onChange={(next) => setParam('q', next || null)} />
      </div>

      {/*
        ONE compact filter row — facet first, then the sorts, horizontally
        scrollable on a phone so it never wraps into a second band of chrome.
      */}
      <div
        role="group"
        aria-label={t('customer-app:v2.marketplace.sortLabel')}
        className="mt-2.5 flex items-center gap-2 overflow-x-auto pb-0.5"
      >
        <button
          type="button"
          aria-pressed={openNowOnly}
          onClick={() => setParam('open', openNowOnly ? null : '1')}
          className="v2-press inline-flex h-11 shrink-0 items-center rounded-v2-2"
        >
          <span className={chip(openNowOnly)}>{t('customer-app:v2.home.openNowFilter')}</span>
        </button>

        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-v2-hairline" />

        {sortOptions.map((option) => {
          const selected = effectiveSort === option.value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => setParam('sort', option.value === 'recommended' ? null : option.value)}
              className="v2-press inline-flex h-11 shrink-0 items-center rounded-v2-2"
            >
              <span className={chip(selected)}>{option.label}</span>
            </button>
          )
        })}
      </div>

      {hasCoordinates ? (
        /*
          LIST + MAP. The list column scrolls with the page; the map is sticky
          under the shell header for the whole scroll. ~52/48 in the map's
          favour per the direction.
        */
        <div className="mt-3 lg:grid lg:grid-cols-[minmax(0,48%)_minmax(0,1fr)] lg:items-start lg:gap-5">
          <div className="min-w-0">{list}</div>
          <div className="hidden lg:block lg:sticky lg:top-[4.5rem] lg:h-[calc(100vh-6rem)]">
            <Suspense fallback={<div className="v2-skeleton h-full min-h-[28rem] rounded-v2-3" />}>
              <V2ResultsMap
                results={discovery.listings.map((listing) => listing.result)}
                onSelect={(result) => {
                  document
                    .getElementById(`v2-result-${result.locationId}`)
                    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                }}
                className="h-full"
              />
            </Suspense>
          </div>
        </div>
      ) : (
        /* No geocoded results → an honest wide list, no decorative map. */
        <div className="mt-3 lg:max-w-[52rem]">{list}</div>
      )}
    </div>
  )
}

function Body({
  discovery,
  showSkeletons,
  onClearFilters,
  onSearchEverywhere,
}: {
  discovery: MarketplaceDiscovery
  showSkeletons: boolean
  onClearFilters: () => void
  onSearchEverywhere: (() => void) | null
}) {
  const { t } = useTranslation()

  if (discovery.isError) {
    return (
      <Notice
        tone="failure"
        title={t('customer-app:v2.discovery.errorTitle')}
        body={t('customer-app:v2.discovery.errorBody')}
        actionLabel={t('customer-app:v2.discovery.retry')}
        onAction={discovery.refetch}
      />
    )
  }

  if (discovery.isPending) {
    if (!showSkeletons) return <div className="min-h-64" />
    return (
      <div>
        <div className="py-2.5">
          <div className="v2-skeleton h-5 w-28 rounded-v2-1" />
        </div>
        <ResultSkeleton count={4} />
      </div>
    )
  }

  if (discovery.listings.length === 0) {
    return discovery.isFiltered ? (
      <Notice
        tone="empty"
        title={t('customer-app:v2.discovery.noMatchTitle')}
        body={t('customer-app:v2.discovery.noMatchBody')}
        actionLabel={
          discovery.hasQuery && discovery.hasFacet
            ? t('customer-app:v2.discovery.clearAll')
            : discovery.hasQuery
              ? t('customer-app:v2.discovery.clearSearch')
              : t('customer-app:v2.discovery.clearFilters')
        }
        onAction={onClearFilters}
      />
    ) : (
      <Notice
        tone="empty"
        title={t('customer-app:v2.discovery.noneHereTitle')}
        body={t('customer-app:v2.discovery.noneHereBody')}
        actionLabel={onSearchEverywhere ? t('customer-app:v2.discovery.searchEverywhere') : null}
        onAction={onSearchEverywhere}
      />
    )
  }

  return (
    /*
      DESIGN PASS A CARD DEMOTION: results sit straight on the canvas as
      hairline-separated rows — the Fresha edge-to-edge list — instead of
      inside a plate-within-the-page. The section header is one quiet line.
    */
    <section aria-labelledby="v2-marketplace-heading">
      <div className="flex items-baseline justify-between gap-3 py-2">
        <h2 id="v2-marketplace-heading" className="text-v2-title font-semibold text-v2-ink">
          {t('customer-app:v2.marketplace.results')}
        </h2>
        {discovery.totalCount !== null && discovery.totalCount > 0 ? (
          <p className="shrink-0 text-v2-caption tabular-nums text-v2-ink-mute">
            {t('customer-app:v2.discovery.count', { count: discovery.totalCount })}
          </p>
        ) : null}
      </div>

      <ul
        className={
          discovery.isFetching
            ? 'v2-refining border-t border-v2-hairline'
            : 'border-t border-v2-hairline'
        }
        aria-busy={discovery.isFetching || undefined}
      >
        {discovery.listings.map((listing, index) => (
          <li
            key={listing.result.locationId}
            id={`v2-result-${listing.result.locationId}`}
            className="border-b border-v2-hairline"
          >
            <ProfessionalResult
              result={listing.result}
              supplyType={listing.supplyType}
              currency={discovery.currencyByOrganization[listing.result.organizationId]}
              index={index}
            />
          </li>
        ))}
      </ul>

      {discovery.hasMore ? (
        <div className="py-3">
          <button
            type="button"
            onClick={discovery.showMore}
            disabled={discovery.isFetching}
            className="v2-press inline-flex h-11 w-full items-center justify-center rounded-v2-2 border border-v2-edge bg-v2-paper px-4 text-v2-meta font-semibold text-v2-ink hover:bg-v2-fill disabled:text-v2-ink-mute"
          >
            {t('customer-app:v2.marketplace.showMore')}
          </button>
        </div>
      ) : null}
    </section>
  )
}
