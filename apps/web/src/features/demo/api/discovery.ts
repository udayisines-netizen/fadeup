import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { demoKeys } from '@/shared/data/keys'
import { toAppError, type AppError } from '@/shared/data/errors'

/**
 * Étude A — la recherche publique RÉELLE.
 *
 * PARAMÈTRE FORCÉ, documenté (piège P1a / MASTER_SPEC §8) :
 * `p_entity_type: 'shop'`. Le défaut NULL de `search_public_professionals`
 * renvoie AUSSI les barbers salariés comme résultats autonomes, ce qui viole
 * la loi produit §2 (offre = Independent + Barbershop, exactement). Toute
 * surface marketplace force cette restriction tant que le défaut n'est pas
 * inversé en base.
 *
 * Le point de référence (Châtelet, Paris) est un paramètre de VUE de la
 * démo — il active la distance réelle calculée par la RPC, il n'invente
 * aucune donnée.
 */
export const DISCOVERY_REFERENCE_POINT = { latitude: 48.8566, longitude: 2.3522 } as const

export interface DiscoveryFilters {
  query?: string
  openNowOnly?: boolean
}

export interface DiscoveryRow {
  organizationId: string
  organizationName: string
  organizationSlug: string
  supplyType: 'independent' | 'barbershop' | null
  locationId: string
  addressLine1: string | null
  city: string | null
  distanceKm: number | null
  startingPriceCents: number | null
  isOpenNow: boolean
  queueWaitingCount: number
  totalCount: number
}

export function useDiscovery(filters: DiscoveryFilters) {
  const query = useQuery({
    queryKey: demoKeys.discovery({ query: filters.query, openNowOnly: filters.openNowOnly }),
    queryFn: async (): Promise<DiscoveryRow[]> => {
      const { data, error } = await getSupabase().rpc('search_public_professionals', {
        p_entity_type: 'shop',
        p_query: filters.query || undefined,
        p_open_now_only: filters.openNowOnly || undefined,
        p_latitude: DISCOVERY_REFERENCE_POINT.latitude,
        p_longitude: DISCOVERY_REFERENCE_POINT.longitude,
        p_limit: 20,
      })
      if (error) throw error
      return (data ?? []).map((row) => ({
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        organizationSlug: row.organization_slug,
        supplyType:
          row.marketplace_supply_type === 'independent' || row.marketplace_supply_type === 'barbershop'
            ? row.marketplace_supply_type
            : null,
        locationId: row.location_id,
        addressLine1: row.address_line1,
        city: row.city,
        distanceKm: row.distance_km,
        startingPriceCents: row.starting_price_cents,
        isOpenNow: row.is_open_now,
        queueWaitingCount: row.queue_waiting_count,
        totalCount: row.total_count,
      }))
    },
    staleTime: 30_000,
  })

  return {
    rows: query.data ?? [],
    loading: query.isPending,
    error: query.isError ? (toAppError(query.error) satisfies AppError) : null,
  }
}
