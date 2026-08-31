import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  isMarketplaceSort,
  type MarketplaceProfessionalResult,
  type MarketplaceSort,
} from '@/lib/queries/marketplace'
import { ANYWHERE } from '@/lib/intl/country-preference'
import { useMoney } from '@/lib/intl/use-intl'
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
 * LIST + MAP, ON BOTH FORM FACTORS (Design Pass A.1 §1)
 * ============================================================================
 *
 * Desktop: the Fresha split — independently scrolling list beside a sticky
 * map. Mobile: LIST is the default; when at least one result carries REAL
 * coordinates, a compact Map/List control on the count row opens a dedicated
 * map view (`?view=map`, a real history entry so Back returns to the list).
 * Tapping a pin docks that result's card under the map. With zero geocoded
 * results no map affordance exists anywhere — an empty decorative map is
 * exactly the fabrication the rules ban. maplibre stays lazy.
 *
 * PIN ↔ CARD AGREEMENT (§2/§5). One `activeId`: hovering/focusing a row
 * highlights its pin; choosing a pin highlights (and on desktop scrolls to)
 * its row. Pins are FadeUp markers — a price pill when the contract has a
 * real starting price, a minimal dot otherwise.
 *
 * SEARCH IA (§4). WHAT (query) and WHERE (the real location system's
 * selector) — on desktop as one compound row with an explicit Search action,
 * on mobile as the compact stack. No unsupported search behavior; the
 * location is never hardcoded.
 *
 * STATE SURVIVES NAVIGATION. `?q&open&sort&view` plus sessionStorage scroll
 * restore — Marketplace → profile → Back never restarts discovery.
 *
 * Supply rules are untouched: one unified list, Independent + Barbershop,
 * staff barbers structurally excluded, `marketplace_supply_type` only.
 */

const V2ResultsMap = lazy(() => import('@/customer-v2/marketplace/v2-results-map'))

const SCROLL_KEY = 'v2-marketplace-scroll'

export function CustomerV2MarketplacePage() {
  const { t } = useTranslation()
  const money = useMoney()

  const location = useCustomerLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  const query = searchParams.get('q') ?? ''
  const openNowOnly = searchParams.get('open') === '1'
  const sortParam = searchParams.get('sort')
  const sort: MarketplaceSort = isMarketplaceSort(sortParam) ? sortParam : 'recommended'

  const setParam = (key: string, value: string | null, options?: { push?: boolean }) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: !options?.push },
    )
  }

  const debouncedQuery = useDebounced(query, 300)

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

  /* ── Pin ↔ card agreement: one active result across list and map. ──────── */
  const [activeId, setActiveId] = useState<string | null>(null)

  /* Mobile Map view — only reachable while real coordinates exist. */
  const mapView = hasCoordinates && searchParams.get('view') === 'map'

  const priceLabelFor = (result: MarketplaceProfessionalResult) => {
    const currency = discovery.currencyByOrganization[result.organizationId]
    return result.startingPriceCents !== null && currency
      ? money(result.startingPriceCents, currency, { trimWholeAmounts: true })
      : null
  }

  const activeListing =
    discovery.listings.find((listing) => listing.result.locationId === activeId) ?? null

  const chip = (selected: boolean) =>
    selected
      ? 'inline-flex h-8 items-center rounded-v2-2 bg-v2-green-tint px-3 text-v2-meta font-semibold text-v2-green-ink'
      : 'inline-flex h-8 items-center rounded-v2-2 border border-v2-hairline bg-v2-paper px-3 text-v2-meta font-medium text-v2-ink-soft'

  const list = (
    <Body
      discovery={discovery}
      showSkeletons={showSkeletons}
      activeId={activeId}
      onActivate={setActiveId}
      viewControl={
        hasCoordinates ? (
          <MapListControl
            mapView={mapView}
            onList={() => setParam('view', null, { push: true })}
            onMap={() => setParam('view', 'map', { push: true })}
          />
        ) : null
      }
      onClearFilters={() => {
        setParam('q', null)
        setParam('open', null)
      }}
      onSearchEverywhere={location.countryCode ? () => location.chooseCountry(ANYWHERE) : null}
    />
  )

  const map = (
    <Suspense fallback={<div className="v2-skeleton h-full min-h-[20rem] rounded-v2-3" />}>
      <V2ResultsMap
        results={discovery.listings.map((listing) => listing.result)}
        activeId={activeId}
        priceLabelFor={priceLabelFor}
        onSelect={(result) => {
          setActiveId(result.locationId)
          /* Desktop keeps the list beside the map — bring the row into view.
             The mobile map view docks the card instead (below). */
          if (!mapView) {
            document
              .getElementById(`v2-result-${result.locationId}`)
              ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
          }
        }}
        className="h-full"
      />
    </Suspense>
  )

  return (
    <div className="flex flex-col">
      <h1 className="sr-only">{t('customer-app:v2.marketplace.title')}</h1>

      {/* ── WHAT + WHERE (§4): compact stack on mobile… ─────────────────── */}
      <div className="lg:hidden">
        <div className="flex min-h-11 items-center justify-start gap-2">
          <LocationSelector location={location} />
        </div>
        <div className="mt-2.5">
          <SearchEntry value={query} onChange={(next) => setParam('q', next || null)} />
        </div>
      </div>

      {/* …one compound search composition on desktop. */}
      <div className="hidden lg:flex lg:items-center lg:gap-2.5">
        <div className="w-full max-w-[26rem]">
          <SearchEntry value={query} onChange={(next) => setParam('q', next || null)} />
        </div>
        <LocationSelector location={location} />
        <button
          type="button"
          onClick={() =>
            document
              .getElementById('v2-marketplace-heading')
              ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
          }
          className="v2-press inline-flex h-12 shrink-0 items-center justify-center rounded-v2-3 bg-v2-green px-5 text-v2-body font-semibold text-v2-paper hover:bg-v2-green-deep"
        >
          {t('customer-app:v2.marketplace.searchAction')}
        </button>
      </div>

      {/* ── Filters: only what the backend genuinely has. ────────────────── */}
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

      {mapView ? (
        /* ── Mobile MAP view: map first, the chosen result docked under it. ── */
        <div className="mt-3 lg:hidden">
          <div className="h-[52vh] min-h-[20rem]">{map}</div>
          {activeListing ? (
            <div className="v2-plate mt-3 overflow-hidden">
              <ProfessionalResult
                result={activeListing.result}
                supplyType={activeListing.supplyType}
                currency={discovery.currencyByOrganization[activeListing.result.organizationId]}
                index={0}
              />
            </div>
          ) : (
            <p className="py-3 text-center text-v2-meta text-v2-ink-soft">
              {t('customer-app:v2.marketplace.tapAPin')}
            </p>
          )}
          <div className="mt-1 flex justify-center">
            <MapListControl
              mapView
              onList={() => setParam('view', null, { push: true })}
              onMap={() => {}}
            />
          </div>
        </div>
      ) : null}

      {/* The list: hidden on mobile while the map view is open, always the
          left column on desktop. */}
      <div className={mapView ? 'hidden lg:block' : undefined}>
        {hasCoordinates ? (
          <div className="mt-3 lg:grid lg:grid-cols-[minmax(0,48%)_minmax(0,1fr)] lg:items-start lg:gap-5">
            <div className="min-w-0">{list}</div>
            <div className="hidden lg:block lg:sticky lg:top-[4.5rem] lg:h-[calc(100vh-6rem)]">
              {map}
            </div>
          </div>
        ) : (
          /* No geocoded results → an honest wide list, no map affordance. */
          <div className="mt-3 lg:max-w-[52rem]">{list}</div>
        )}
      </div>
    </div>
  )
}

/** The restrained Map/List switch — two chips, shown only when pins exist. */
function MapListControl({
  mapView,
  onList,
  onMap,
}: {
  mapView: boolean
  onList: () => void
  onMap: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-1 lg:hidden">
      <button
        type="button"
        aria-pressed={!mapView}
        onClick={onList}
        className="v2-press inline-flex h-11 items-center rounded-v2-2"
      >
        <span
          className={
            !mapView
              ? 'inline-flex h-8 items-center rounded-v2-2 bg-v2-green-tint px-3 text-v2-meta font-semibold text-v2-green-ink'
              : 'inline-flex h-8 items-center rounded-v2-2 px-3 text-v2-meta font-medium text-v2-ink-soft'
          }
        >
          {t('customer-app:v2.marketplace.listView')}
        </span>
      </button>
      <button
        type="button"
        aria-pressed={mapView}
        onClick={onMap}
        className="v2-press inline-flex h-11 items-center rounded-v2-2"
      >
        <span
          className={
            mapView
              ? 'inline-flex h-8 items-center rounded-v2-2 bg-v2-green-tint px-3 text-v2-meta font-semibold text-v2-green-ink'
              : 'inline-flex h-8 items-center rounded-v2-2 px-3 text-v2-meta font-medium text-v2-ink-soft'
          }
        >
          {t('customer-app:v2.marketplace.mapView')}
        </span>
      </button>
    </div>
  )
}

function Body({
  discovery,
  showSkeletons,
  activeId,
  onActivate,
  viewControl,
  onClearFilters,
  onSearchEverywhere,
}: {
  discovery: MarketplaceDiscovery
  showSkeletons: boolean
  activeId: string | null
  onActivate: (locationId: string) => void
  /** The mobile Map/List switch, rendered on the count row when pins exist. */
  viewControl: React.ReactNode
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
    <section aria-labelledby="v2-marketplace-heading">
      <div className="flex items-center justify-between gap-3 py-1">
        <h2 id="v2-marketplace-heading" className="text-v2-title font-semibold text-v2-ink">
          {t('customer-app:v2.marketplace.results')}
          {discovery.totalCount !== null && discovery.totalCount > 0 ? (
            <span className="ms-2 text-v2-caption font-normal tabular-nums text-v2-ink-mute">
              {t('customer-app:v2.discovery.count', { count: discovery.totalCount })}
            </span>
          ) : null}
        </h2>
        {viewControl}
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
            onMouseEnter={() => onActivate(listing.result.locationId)}
            onFocus={() => onActivate(listing.result.locationId)}
            className={
              activeId === listing.result.locationId
                ? 'v2-row-active border-b border-v2-hairline'
                : 'border-b border-v2-hairline'
            }
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
