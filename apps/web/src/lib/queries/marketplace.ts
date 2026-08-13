import { useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * One marketplace search result that may be a shop OR an individual barber
 * (`entityType`) — see search_public_professionals
 * (db/migrations/20260813100000_marketplace_professionals.sql). Individual
 * barbers are first-class results here, not just shop cards: a `'barber'`
 * row carries `barberId`/`barberDisplayName`/`barberAvatarUrl` alongside the
 * shop it belongs to, a `'shop'` row leaves those null. Every field is real
 * or null — never fabricated (no rating/review field exists in this schema).
 */
export interface MarketplaceProfessionalResult {
  entityType: 'shop' | 'barber'
  organizationId: string
  organizationName: string
  organizationSlug: string
  barberId: string | null
  barberDisplayName: string | null
  barberAvatarUrl: string | null
  barberTitle: string | null
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

interface MarketplaceProfessionalRow {
  entity_type: 'shop' | 'barber'
  organization_id: string
  organization_name: string
  organization_slug: string
  barber_id: string | null
  barber_display_name: string | null
  barber_avatar_url: string | null
  barber_title: string | null
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

function mapProfessionalResult(row: MarketplaceProfessionalRow): MarketplaceProfessionalResult {
  return {
    entityType: row.entity_type,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    organizationSlug: row.organization_slug,
    barberId: row.barber_id,
    barberDisplayName: row.barber_display_name,
    barberAvatarUrl: row.barber_avatar_url,
    barberTitle: row.barber_title,
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

export interface MarketplaceProfessionalSearchParams {
  country?: string | null
  city?: string | null
  query?: string | null
  serviceQuery?: string | null
  latitude?: number | null
  longitude?: number | null
  radiusKm?: number | null
  minPriceCents?: number | null
  maxPriceCents?: number | null
  openNowOnly?: boolean
  entityType?: 'shop' | 'barber' | null
  limit?: number
  offset?: number
}

/**
 * Public, unauthenticated marketplace search returning shops AND individual
 * barbers together — see search_public_professionals. This is what
 * MarketplaceSearchPage uses; search_public_organizations above stays for
 * any shop-only lookup that still needs it.
 */
export function useSearchPublicProfessionals(params: MarketplaceProfessionalSearchParams) {
  return useQuery({
    queryKey: ['marketplace', 'search-professionals', params],
    queryFn: async (): Promise<MarketplaceProfessionalResult[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('search_public_professionals', {
        p_country: params.country ?? null,
        p_city: params.city ?? null,
        p_query: params.query ?? null,
        p_service_query: params.serviceQuery ?? null,
        p_latitude: params.latitude ?? null,
        p_longitude: params.longitude ?? null,
        p_radius_km: params.radiusKm ?? null,
        p_min_price_cents: params.minPriceCents ?? null,
        p_max_price_cents: params.maxPriceCents ?? null,
        p_open_now_only: params.openNowOnly ?? false,
        p_entity_type: params.entityType ?? null,
        p_limit: params.limit ?? 20,
        p_offset: params.offset ?? 0,
      })
      if (error) throw error
      return ((data ?? []) as MarketplaceProfessionalRow[]).map(mapProfessionalResult)
    },
  })
}
