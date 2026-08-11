import { useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * One marketplace search result — always a real organization+location pair
 * that opted in via `organizations.marketplace_visible` (see
 * db/migrations/20260811160000_marketplace_discovery.sql). `distanceKm` is
 * only ever a real computed value (or null) — never estimated/fabricated.
 * There is no rating/review field: no reviews table exists in this schema
 * yet, so nothing is shown for it rather than inventing a number.
 */
export interface MarketplaceSearchResult {
  organizationId: string
  organizationName: string
  organizationSlug: string
  locationId: string
  locationName: string
  addressLine1: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
  distanceKm: number | null
  startingPriceCents: number | null
  isOpenNow: boolean | null
  queueWaitingCount: number
  totalCount: number
}

interface MarketplaceSearchRow {
  organization_id: string
  organization_name: string
  organization_slug: string
  location_id: string
  location_name: string
  address_line1: string | null
  city: string | null
  region: string | null
  postal_code: string | null
  country: string | null
  distance_km: number | null
  starting_price_cents: number | null
  is_open_now: boolean | null
  queue_waiting_count: number
  total_count: number
}

function mapResult(row: MarketplaceSearchRow): MarketplaceSearchResult {
  return {
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    organizationSlug: row.organization_slug,
    locationId: row.location_id,
    locationName: row.location_name,
    addressLine1: row.address_line1,
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    country: row.country,
    distanceKm: row.distance_km,
    startingPriceCents: row.starting_price_cents,
    isOpenNow: row.is_open_now,
    queueWaitingCount: row.queue_waiting_count,
    totalCount: row.total_count,
  }
}

export interface MarketplaceSearchParams {
  country?: string | null
  city?: string | null
  query?: string | null
  latitude?: number | null
  longitude?: number | null
  radiusKm?: number | null
  limit?: number
  offset?: number
}

/** Public, unauthenticated marketplace search — see search_public_organizations. */
export function useSearchPublicOrganizations(params: MarketplaceSearchParams) {
  return useQuery({
    queryKey: ['marketplace', 'search', params],
    queryFn: async (): Promise<MarketplaceSearchResult[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('search_public_organizations', {
        p_country: params.country ?? null,
        p_city: params.city ?? null,
        p_query: params.query ?? null,
        p_latitude: params.latitude ?? null,
        p_longitude: params.longitude ?? null,
        p_radius_km: params.radiusKm ?? null,
        p_limit: params.limit ?? 20,
        p_offset: params.offset ?? 0,
      })
      if (error) throw error
      return ((data ?? []) as MarketplaceSearchRow[]).map(mapResult)
    },
  })
}
