import { useMemo } from 'react'
import {
  useSearchPublicProfessionals,
  usePublicCurrencies,
  type MarketplaceProfessionalResult,
} from '@/lib/queries/marketplace'
import type { CustomerLocation } from '@/customer-v2/hooks/use-customer-location'
import { classifyMarketplaceSupply, type MarketplaceSupplyType } from '@/customer-v2/marketplace-supply'

/**
 * Home's discovery data — one real query, one list.
 *
 * ============================================================================
 * R5R.1A-R2: ONE SECTION, BECAUSE ENTITY TYPE IS NOT A CUSTOMER CONCEPT
 * ============================================================================
 *
 * The previous revision split Home into "Barbers" and "Barbershops", two
 * server-side queries on `p_entity_type`. It was technically clean and it was
 * the wrong product: it published the RPC's internal row shape as a customer
 * taxonomy, and it made every public team member of a shop look like a business
 * a customer could book independently of that shop.
 *
 * So Home is one query and one list again. What replaced the split is not a
 * heading change but an ELIGIBILITY rule — see `marketplace-supply.ts` for why
 * a barber row is staff by construction and never separate supply.
 *
 * The query asks the server for shop-shaped rows only (`p_entity_type: 'shop'`),
 * which is the same real parameter the split used, so the exclusion happens in
 * Postgres and `total_count` is the count of genuinely eligible supply rather
 * than a number the browser had to correct. `classifyMarketplaceSupply` then
 * runs over what comes back — belt and braces, and the place the rule is
 * actually stated and tested.
 *
 * ============================================================================
 * WHAT STILL CANNOT BE A SECTION
 * ============================================================================
 *
 * POPULAR / RECOMMENDED-AS-RANKING has nothing behind it. There is no ranking
 * model, no reviews table and no booking-count projection exposed to discovery;
 * the RPC's own migration says `recommended` "is not a score, there is no model
 * behind it".
 *
 * FRESH WORK has no source at all — the only image columns in the public schema
 * are three `avatar_url`s, and there is no portfolio table.
 *
 * FOLLOWED PROFESSIONALS has a real contract but needs an authenticated
 * customer, and the live table holds zero rows.
 *
 * ============================================================================
 * THE SORT FOLLOWS THE LOCATION, BECAUSE IT HAS TO
 * ============================================================================
 *
 * `nearest` orders by a distance the function computes from coordinates the
 * caller supplies. With no coordinates there is no distance and `nearest`
 * degenerates. So precise location selects `nearest`; anything less uses
 * `recommended`, which is the pre-R5 ordering and makes no claim. No new
 * ranking is introduced here.
 */

/** How many results Home asks for. Home is an entry point, not the marketplace. */
const HOME_PAGE_SIZE = 12

/** One eligible listing, with the customer-facing type it is allowed to claim. */
export interface DiscoveryListing {
  result: MarketplaceProfessionalResult
  /** `null` until `organizations.business_type` reaches a public contract. */
  supplyType: MarketplaceSupplyType | null
}

export interface HomeDiscoveryInput {
  location: CustomerLocation
  /** Already-debounced text from the Home search entry. Empty means browse. */
  query: string
  /** The one facet Home offers: server-side `p_open_now_only`. */
  openNowOnly: boolean
}

export interface HomeDiscovery {
  listings: DiscoveryListing[]
  /** The server's total for this filter — real, not `listings.length`. */
  totalCount: number | null
  /** Currency per organization id, so pricing is never assumed to be euros. */
  currencyByOrganization: Record<string, string>
  isPending: boolean
  isFetching: boolean
  isError: boolean
  refetch: () => void
  /** True when a filter or query is narrowing the list, so empty can say why. */
  isFiltered: boolean
  /**
   * WHICH of the two is narrowing it. An empty state that offers to "clear
   * filters" when the customer typed a name is telling them to undo something
   * they never did.
   */
  hasQuery: boolean
  hasFacet: boolean
  /** True once the results were genuinely ordered by a computed distance. */
  isNearest: boolean
}

export function useHomeDiscovery({ location, query, openNowOnly }: HomeDiscoveryInput): HomeDiscovery {
  const trimmed = query.trim()
  const isNearest = location.precision === 'precise'

  const search = useSearchPublicProfessionals(
    {
      country: location.countryCode,
      query: trimmed.length > 0 ? trimmed : null,
      latitude: location.coordinates?.latitude ?? null,
      longitude: location.coordinates?.longitude ?? null,
      radiusKm: location.radiusKm,
      openNowOnly,
      /*
        Bookable PLACES only. A barber row is a member of staff at one of these
        places, not a business of their own — `marketplace-supply.ts` sets out
        why that is structural rather than a policy choice, and why excluding
        them cannot lose a bookable place.

        Filtering server-side rather than in the browser is what keeps
        `total_count` honest: a client-side filter would leave the server
        counting rows the customer is never shown.
      */
      entityType: 'shop',
      sort: isNearest ? 'nearest' : 'recommended',
      limit: HOME_PAGE_SIZE,
    },
    /*
      Home's search box and its Open now facet both change the query key on
      every interaction. Without this the list unmounts, skeletons take its
      place at a different height, and the page jumps twice per keystroke —
      measured at 444px on an 844px viewport. Holding the previous rows makes a
      refinement narrow the list in place, which is what the customer means.
    */
    { keepPreviousData: true },
  )

  const listings = useMemo<DiscoveryListing[]>(() => {
    const rows = search.data ?? []
    return rows.flatMap((result) => {
      /*
        The label arrives already decided. `marketplace_supply_type` is derived
        in the RPC from `organizations.business_type`, which the public contract
        deliberately does not expose — see `marketplace-supply.ts`. This step
        decides eligibility only.
      */
      const classification = classifyMarketplaceSupply(result)
      return classification.eligible ? [{ result, supplyType: classification.type }] : []
    })
  }, [search.data])

  // Every row carries the same `total_count`, so the first one is the answer.
  // Null rather than 0 while the query is still resolving, so a count of zero
  // is never rendered before it is known.
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
    isNearest,
  }
}
