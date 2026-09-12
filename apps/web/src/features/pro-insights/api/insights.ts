import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { proKeys } from '@/shared/data/keys'

/**
 * OS-3 — la couche de données des insights.
 *
 * Deux RPC, toutes deux `SECURITY DEFINER` et bornées à UNE organisation :
 * `get_organization_insights` (les chiffres de la période) et
 * `get_organization_duration_gaps` (durée annoncée contre observée). Aucune
 * agrégation n'est faite ici — le revenu notamment est sommé EN BASE, sous la
 * garde `private.can_view_revenue` du réglage OS-1, et arrive déjà à `null`
 * pour qui n'a pas le droit de le voir.
 *
 * Les types générés déclarent les colonnes calculées non-nullables ; la base
 * rend `null` pour tout montant masqué, pour une première activité inexistante
 * et pour une durée observée sans mesure. Les interfaces ci-dessous disent la
 * vérité.
 */

export interface OrganizationInsights {
  window_from: string
  window_to: string
  /** `null` = l'organisation n'a AUCUNE activité connue (≠ zéro). */
  first_activity_at: string | null
  /** Depuis quand les vues de profil sont instrumentées. */
  analytics_since: string | null
  /** Le serveur seul décide si une tendance a le droit d'exister. */
  comparison_available: boolean
  revenue_visible: boolean
  currency: string | null
  fadeup_bookings: number
  fadeup_customers: number
  counter_bookings: number
  requests_received: number
  requests_converted: number
  profile_views: number
  new_followers: number
  services_delivered: number
  no_show_count: number
  /** `null` — jamais `0` — quand le revenu est masqué. */
  revenue_cents: number | null
  average_ticket_cents: number | null
  no_show_cost_cents: number | null
  new_customers: number
  returning_customers: number
  lapsed_customers: number
  previous_fadeup_bookings: number
  previous_requests_received: number
  previous_services_delivered: number
  previous_profile_views: number
  previous_new_followers: number
  previous_revenue_cents: number | null
}

export interface DurationGap {
  location_id: string
  location_name: string
  service_id: string
  service_name: string
  declared_minutes: number | null
  observed_minutes: number | null
  sample_count: number
  estimate_capped: boolean
}

async function fetchInsights(organizationId: string, from: string, to: string): Promise<OrganizationInsights | null> {
  const { data, error } = await getSupabase().rpc('get_organization_insights', {
    p_organization_id: organizationId,
    p_from: from,
    p_to: to,
  })
  if (error) throw error
  const rows = (data ?? []) as unknown as OrganizationInsights[]
  return rows[0] ?? null
}

export function useOrganizationInsights(organizationId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: proKeys.insightsWindow(organizationId ?? '', from, to),
    queryFn: () => fetchInsights(organizationId ?? '', from, to),
    enabled: Boolean(organizationId),
    staleTime: 60_000,
    // Changer de période garde les chiffres précédents à l'écran, atténués :
    // la page ne saute pas et le squelette ne clignote pas.
    placeholderData: keepPreviousData,
  })
}

async function fetchDurationGaps(organizationId: string, locationId: string | null): Promise<DurationGap[]> {
  const { data, error } = await getSupabase().rpc('get_organization_duration_gaps', {
    p_organization_id: organizationId,
    ...(locationId ? { p_location_id: locationId } : {}),
  })
  if (error) throw error
  return (data ?? []) as unknown as DurationGap[]
}

export function useDurationGaps(organizationId: string | null, locationId: string | null) {
  return useQuery({
    queryKey: proKeys.durationGaps(organizationId ?? '', locationId ?? ''),
    queryFn: () => fetchDurationGaps(organizationId ?? '', locationId),
    enabled: Boolean(organizationId),
    staleTime: 5 * 60_000,
  })
}
