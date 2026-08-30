import { useMemo, useState } from 'react'
import {
  useSearchPublicProfessionals,
  usePublicCurrencies,
  type MarketplaceSort,
} from '@/lib/queries/marketplace'
import type { CustomerLocation } from '@/customer-v2/hooks/use-customer-location'
import { classifyMarketplaceSupply } from '@/customer-v2/marketplace-supply'
import type { DiscoveryListing } from '@/customer-v2/hooks/use-home-discovery'

/**
 * The Marketplace's data — Home's discovery grammar, plus the three things a
 * dedicated marketplace adds: a sort, a growing page, and nothing else.
 *
 * ============================================================================
 * WHAT SEPARATES THIS FROM HOME
 * ============================================================================
 *
 * Home is an entry point: twelve results, no sort control, no paging. The
 * Marketplace is where a customer COMPARES, so it exposes the two controls the
 * backend genuinely supports — `p_sort` (recommended / nearest / price, all
 * resolved server-side because the query is paged and a client-side sort would
 * order the wrong page) and `p_open_now_only` — and it pages.
 *
 * The sorts NOT offered are absent because nothing can back them:
 * `available_soonest` needs a service (availability is a function of location,
 * professional, service and date) and `rating` needs a reviews table this
 * schema does not have. `MARKETPLACE_SORTS` in the query layer records the
 * same decision.
 *
 * ============================================================================
 * PAGING BY GROWING THE LIMIT, DELIBERATELY
 * ============================================================================
 *
 * "Show more" grows `p_limit` by a page rather than stitching offset pages in
 * the client. One request owning the whole visible list means the server's
 * ordering is never interleaved with a stale earlier page after data changes
 * underneath it, `keepPreviousData` keeps the already-visible rows on screen
 * while the longer page loads, and there is no client-side cache of page
 * fragments to invalidate. The cost is re-transferring earlier rows on each
 * growth — at marketplace sizes measured in dozens that is noise, and if
 * FadeUp reaches the size where it is not, cursor pagination is a backend
 * feature to design, not a frontend loop to improvise.
 *
 * ============================================================================
 * SUPPLY RULES ARE HOME'S, UNCHANGED
 * ============================================================================
 *
 * `p_entity_type: 'shop'` — staff barbers are structurally not supply (see
 * `marketplace-supply.ts`), and the label is the contract's own
 * `marketplace_supply_type`. The Marketplace adds no second eligibility rule.
 */

const PAGE_SIZE = 24

export interface MarketplaceDiscoveryInput {
  location: CustomerLocation
  /** Already debounced. Empty means browse. */
  query: string
  openNowOnly: boolean
  sort: MarketplaceSort
}

export interface MarketplaceDiscovery {
  listings: DiscoveryListing[]
  totalCount: number | null
  currencyByOrganization: Record<string, string>
  isPending: boolean
  isFetching: boolean
  isError: boolean
  refetch: () => void
  isFiltered: boolean
  hasQuery: boolean
  hasFacet: boolean
  /** True when more real rows exist beyond the ones on screen. */
  hasMore: boolean
  /** Grows the page. Safe to call while a longer page is already loading. */
  showMore: () => void
}

export function useMarketplaceDiscovery({
  location,
  query,
  openNowOnly,
  sort,
}: MarketplaceDiscoveryInput): MarketplaceDiscovery {
  const trimmed = query.trim()

  const [limit, setLimit] = useState(PAGE_SIZE)

  /*
    A changed search is a NEW QUESTION, so the page resets with it — otherwise
    clearing a query after two growths would fetch 72 rows to answer "show me
    everyone". The reset happens synchronously during render (the sanctioned
    setState-during-render pattern for derived state) rather than in an effect,
    so there is no frame where the old limit pairs with the new question.
  */
  const questionKey = `${location.countryCode ?? ''}|${trimmed}|${openNowOnly}|${sort}|${location.radiusKm ?? ''}`
  const [lastQuestion, setLastQuestion] = useState(questionKey)
  if (questionKey !== lastQuestion) {
    setLastQuestion(questionKey)
    setLimit(PAGE_SIZE)
  }

  const search = useSearchPublicProfessionals(
    {
      country: location.countryCode,
      query: trimmed.length > 0 ? trimmed : null,
      latitude: location.coordinates?.latitude ?? null,
      longitude: location.coordinates?.longitude ?? null,
      radiusKm: location.radiusKm,
      openNowOnly,
      entityType: 'shop',
      sort,
      limit,
    },
    { keepPreviousData: true },
  )

  const listings = useMemo<DiscoveryListing[]>(() => {
    const rows = search.data ?? []
    return rows.flatMap((result) => {
      const classification = classifyMarketplaceSupply(result)
      return classification.eligible ? [{ result, supplyType: classification.type }] : []
    })
  }, [search.data])

  const totalCount = search.data ? (search.data[0]?.totalCount ?? 0) : null

  const organizationIds = useMemo(
    () => listings.map((listing) => listing.result.organizationId),
    [listings],
  )
  const currencyByOrganization = usePublicCurrencies(organizationIds)

  return {
    listings,
    totalCount,
    currencyByOrganization,
    isPending: search.isPending,
    isFetching: search.isFetching,
    isError: search.isError,
    refetch: () => void search.refetch(),
    isFiltered: openNowOnly || trimmed.length > 0,
    hasQuery: trimmed.length > 0,
    hasFacet: openNowOnly,
    hasMore: totalCount !== null && totalCount > (search.data?.length ?? 0),
    showMore: () => setLimit((current) => current + PAGE_SIZE),
  }
}
