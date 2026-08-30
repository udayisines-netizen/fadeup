import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MarketplaceSort } from '@/lib/queries/marketplace'
import { ANYWHERE } from '@/lib/intl/country-preference'
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
 * ONE LIST, HOME'S GRAMMAR, TWO MORE CONTROLS
 * ============================================================================
 *
 * The page is deliberately Home's discovery composition — the same location
 * chip, the same search entry, the same listing row — because a customer who
 * learned to read one surface has learned to read both. What the Marketplace
 * adds is exactly what the backend genuinely supports beyond Home: a sort
 * (`p_sort`) and a growing page. Supply rules are identical: one unified list,
 * Independent + Barbershop, staff barbers structurally excluded, no
 * entity-type sections.
 *
 * ============================================================================
 * LIST-FIRST, AND WHY THERE IS NO MAP
 * ============================================================================
 *
 * The blueprint's desktop marketplace is list + map — WHERE coordinates exist.
 * Measured against the live database: zero of the nine active locations are
 * geocoded (`latitude`/`longitude` all null), so a map would render an empty
 * viewport with no pins, or worse, invented ones. Until locations carry real
 * coordinates this page is honestly list-first; the RPC already returns
 * lat/long per row, so a map composition needs no contract work when the data
 * arrives — it is a rendering addition, not an architecture change.
 *
 * ============================================================================
 * THE SORT CONTROL TELLS THE TRUTH ABOUT ITSELF
 * ============================================================================
 *
 * "Nearest" is offered only while precise location is genuinely on: with no
 * coordinates the RPC has no distance to sort by and the option would be a
 * placebo. Rating and soonest-availability sorts do not exist because nothing
 * in this schema can back them (no reviews table; availability needs a
 * service), and offering a control that silently falls back is how customers
 * learn to distrust controls.
 */
export function CustomerV2MarketplacePage() {
  const { t } = useTranslation()

  const location = useCustomerLocation()
  const [query, setQuery] = useState('')
  const [openNowOnly, setOpenNowOnly] = useState(false)
  const [sort, setSort] = useState<MarketplaceSort>('recommended')

  const debouncedQuery = useDebounced(query, 300)

  /*
    If the customer chose "Nearest" and then turned precise location off, the
    stored preference survives but the QUERY falls back to the ordering that
    still means something — and the UI below hides the chip, so the state and
    the presentation cannot disagree.
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

  const showSkeletons = useDelayedFlag(discovery.isPending)

  const sortOptions: Array<{ value: MarketplaceSort; label: string }> = [
    { value: 'recommended', label: t('customer-app:v2.marketplace.sortRecommended') },
    ...(nearestAvailable
      ? [{ value: 'nearest' as MarketplaceSort, label: t('customer-app:v2.marketplace.sortNearest') }]
      : []),
    { value: 'price', label: t('customer-app:v2.marketplace.sortPrice') },
  ]

  return (
    <div className="flex flex-col">
      <div className="flex min-h-11 items-center justify-start gap-2">
        <LocationSelector location={location} />

        <button
          type="button"
          aria-pressed={openNowOnly}
          onClick={() => setOpenNowOnly((current) => !current)}
          className="v2-press inline-flex h-11 shrink-0 items-center rounded-v2-2"
        >
          <span
            className={
              openNowOnly
                ? 'inline-flex h-8 items-center rounded-v2-2 bg-v2-green-tint px-3 text-v2-meta font-semibold text-v2-green-ink'
                : 'inline-flex h-8 items-center rounded-v2-2 border border-v2-hairline bg-v2-paper px-3 text-v2-meta font-medium text-v2-ink-soft'
            }
          >
            {t('customer-app:v2.home.openNowFilter')}
          </span>
        </button>
      </div>

      <h1 className="mt-1.5 text-v2-lead font-semibold tracking-[-0.02em] text-v2-ink lg:mt-2 lg:text-[1.5rem]/[1.75rem]">
        {t('customer-app:v2.marketplace.title')}
      </h1>

      <div className="mt-3.5 lg:max-w-[26rem]">
        <SearchEntry value={query} onChange={setQuery} />
      </div>

      {/*
        The sort is a radio group in behaviour and a chip row in look —
        `aria-pressed` per chip, exactly one true. It sits UNDER the search
        because it refines the answer, not the question.
      */}
      <div
        role="group"
        aria-label={t('customer-app:v2.marketplace.sortLabel')}
        className="mt-3 flex flex-wrap items-center gap-2"
      >
        {sortOptions.map((option) => {
          const selected = effectiveSort === option.value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => setSort(option.value)}
              className="v2-press inline-flex h-11 items-center rounded-v2-2"
            >
              <span
                className={
                  selected
                    ? 'inline-flex h-8 items-center rounded-v2-2 bg-v2-green-tint px-3 text-v2-meta font-semibold text-v2-green-ink'
                    : 'inline-flex h-8 items-center rounded-v2-2 border border-v2-hairline bg-v2-paper px-3 text-v2-meta font-medium text-v2-ink-soft'
                }
              >
                {option.label}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-4 md:mt-5 lg:max-w-[46rem]">
        <Body
          discovery={discovery}
          showSkeletons={showSkeletons}
          onClearFilters={() => {
            setQuery('')
            setOpenNowOnly(false)
          }}
          onSearchEverywhere={location.countryCode ? () => location.chooseCountry(ANYWHERE) : null}
        />
      </div>
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
      <div className="v2-plate overflow-hidden">
        <div className="px-4 py-3 md:px-5">
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
    <section aria-labelledby="v2-marketplace-heading" className="v2-plate overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-4 py-3 md:px-5">
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
        className={discovery.isFetching ? 'v2-refining' : undefined}
        aria-busy={discovery.isFetching || undefined}
      >
        {discovery.listings.map((listing, index) => (
          <li key={listing.result.locationId} className="border-t border-v2-hairline">
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
        <div className="border-t border-v2-hairline px-4 py-3 md:px-5">
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
