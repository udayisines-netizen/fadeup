import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { proKeys } from '@/shared/data/keys'

/**
 * P1PRO — LECTURES des demandes de réservation côté pro. Dans shared/data
 * (même précédent que organization.ts) : l'accueil pro ET l'écran des
 * demandes les consomment, et `features/X` n'importe jamais `features/Y`.
 * Les mutations (accepter, contre-proposer, refuser) restent dans
 * `features/pro-requests/api` — seul l'écran des demandes agit.
 *
 * Coordonnées : l'écran affiche EXACTEMENT ce que `get_booking_requests`
 * expose — la RPC ne répond qu'aux rôles gestionnaires d'une organisation
 * revendiquée (private.can_manage_appointments) ; un profil non revendiqué
 * ne reçoit jamais de coordonnées (garde B2, réduite à l'écriture).
 */

export interface BookingRequestRow {
  id: string
  location_id: string
  location_name: string
  barber_id: string | null
  barber_display_name: string | null
  service_id: string | null
  service_name: string | null
  duration_minutes: number | null
  price_cents: number | null
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  notes: string | null
  starts_at: string
  ends_at: string
  expires_at: string | null
  created_at: string
  /** Non nul = le salon a proposé un autre horaire ; le CLIENT répond. */
  counter_proposed_at: string | null
  /** L'horaire que le client avait demandé (starts_at porte le proposé). */
  counter_original_starts_at: string | null
  counter_note: string | null
}

export interface BookingRequestHistoryRow {
  id: string
  location_id: string
  location_name: string
  barber_display_name: string | null
  service_name: string | null
  price_cents: number | null
  currency: string
  customer_name: string
  starts_at: string
  ends_at: string
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
  resolution: 'declined' | 'expired' | 'cancelled_by_customer' | 'cancelled_by_business' | 'rescheduled' | null
  counter_proposed_at: string | null
  counter_original_starts_at: string | null
  decided_at: string | null
  created_at: string
}

/** Les demandes en attente, la plus urgente en tête (tri serveur). */
export function useBookingRequests(organizationId: string | null) {
  return useQuery({
    queryKey: proKeys.requests(organizationId ?? ''),
    queryFn: async (): Promise<BookingRequestRow[]> => {
      const { data, error } = await getSupabase().rpc('get_booking_requests', {
        p_organization_id: organizationId ?? '',
      })
      if (error) throw error
      return (data ?? []) as BookingRequestRow[]
    },
    enabled: Boolean(organizationId),
    staleTime: 15_000,
  })
}

/** Les demandes traitées, avec leur issue — la preuve de ce que FadeUp apporte. */
export function useBookingRequestHistory(organizationId: string | null, enabled = true) {
  return useQuery({
    queryKey: proKeys.requestHistory(organizationId ?? ''),
    queryFn: async (): Promise<BookingRequestHistoryRow[]> => {
      const { data, error } = await getSupabase().rpc('get_booking_request_history', {
        p_organization_id: organizationId ?? '',
      })
      if (error) throw error
      return (data ?? []) as BookingRequestHistoryRow[]
    },
    enabled: Boolean(organizationId) && enabled,
    staleTime: 60_000,
  })
}
