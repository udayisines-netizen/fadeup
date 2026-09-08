import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { entitlementKeys, proKeys } from '@/shared/data/keys'
import { useChannel } from '@/shared/realtime/useChannel'
import { parseBookingRefusal, type BookingRefusalCode } from '@/shared/lib/bookingRefusals'

/**
 * P1PRO §10 — les ACTIONS de l'écran des demandes. Les lectures vivent dans
 * `shared/data/proRequests` (l'accueil les consomme aussi).
 *
 * Aucun optimisme : accepter, proposer et refuser attendent la base — un
 * client est derrière chaque geste. Les refus nommés
 * (`fadeup_booking_refusal=…`) remontent typés, jamais en texte brut.
 */

export class RequestActionError extends Error {
  readonly code: BookingRefusalCode | 'unknown'
  constructor(code: BookingRefusalCode | 'unknown') {
    super(`request action refused: ${code}`)
    this.name = 'RequestActionError'
    this.code = code
  }
}

function throwRequestError(error: unknown): never {
  const code = parseBookingRefusal(error)
  throw new RequestActionError(code ?? 'unknown')
}

function useInvalidateRequests(organizationId: string | null) {
  const queryClient = useQueryClient()
  return () => {
    if (!organizationId) return
    void queryClient.invalidateQueries({ queryKey: proKeys.requests(organizationId) })
    void queryClient.invalidateQueries({ queryKey: proKeys.requestHistory(organizationId) })
    void queryClient.invalidateQueries({ queryKey: proKeys.all })
  }
}

export function useConfirmRequest(organizationId: string | null) {
  const invalidate = useInvalidateRequests(organizationId)
  return useMutation({
    mutationFn: async (appointmentId: string) => {
      const { data, error } = await getSupabase().rpc('confirm_booking_request', {
        p_appointment_id: appointmentId,
      })
      if (error) throwRequestError(error)
      return data
    },
    onSettled: invalidate,
  })
}

export function useDeclineRequest(organizationId: string | null) {
  const invalidate = useInvalidateRequests(organizationId)
  return useMutation({
    mutationFn: async (input: { appointmentId: string; note?: string }) => {
      const { data, error } = await getSupabase().rpc('decline_booking_request', {
        p_appointment_id: input.appointmentId,
        ...(input.note ? { p_note: input.note } : {}),
      })
      if (error) throwRequestError(error)
      return data
    },
    onSettled: invalidate,
  })
}

export function useCounterPropose(organizationId: string | null) {
  const invalidate = useInvalidateRequests(organizationId)
  return useMutation({
    mutationFn: async (input: { appointmentId: string; startsAt: string; barberId?: string | null; note?: string }) => {
      const { data, error } = await getSupabase().rpc('counter_propose_booking_request', {
        p_appointment_id: input.appointmentId,
        p_starts_at: input.startsAt,
        ...(input.barberId ? { p_barber_id: input.barberId } : {}),
        ...(input.note ? { p_note: input.note } : {}),
      })
      if (error) throwRequestError(error)
      return data
    },
    onSettled: invalidate,
  })
}

export interface StaffSlot {
  slot_start: string
  slot_end: string
}

/**
 * Les créneaux RÉELS côté staff pour la feuille de contre-proposition —
 * `get_available_slots` dit la vérité du jour choisi ; rien n'est proposé
 * qui ne soit pas proposable.
 */
export function useStaffSlots(input: {
  organizationId: string | null
  locationId: string | null
  barberId: string | null
  serviceId: string | null
  date: string | null
}) {
  return useQuery({
    queryKey: [
      ...proKeys.all,
      'staff-slots',
      input.organizationId ?? '',
      input.locationId ?? '',
      input.barberId ?? '',
      input.serviceId ?? '',
      input.date ?? '',
    ] as const,
    queryFn: async (): Promise<StaffSlot[]> => {
      const { data, error } = await getSupabase().rpc('get_available_slots', {
        p_organization_id: input.organizationId ?? '',
        p_location_id: input.locationId ?? '',
        p_barber_id: input.barberId ?? '',
        p_service_id: input.serviceId ?? '',
        p_date: input.date ?? '',
      })
      if (error) throw error
      return (data ?? []) as StaffSlot[]
    },
    enabled: Boolean(
      input.organizationId && input.locationId && input.barberId && input.serviceId && input.date,
    ),
    staleTime: 15_000,
  })
}

/**
 * P1PRO — l'incitation d'APRÈS acceptation (jamais avant, jamais bloquante) :
 * l'essai 14 jours sans carte (B3). L'erreur reste douce — un essai déjà
 * consommé n'est pas une panne.
 */
export function useStartTrial(organizationId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await getSupabase().rpc('start_organization_trial', {
        p_organization_id: organizationId ?? '',
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      if (organizationId) {
        void queryClient.invalidateQueries({ queryKey: entitlementKeys.organization(organizationId) })
      }
    },
  })
}

/**
 * Canal du CONTEXTE demandes : une nouvelle demande apparaît sans
 * rafraîchir, une demande réglée ou expirée sort. Invalidation de clés,
 * jamais confiance au payload.
 */
export function useProRequestsChannel(organizationId: string | null): void {
  const queryClient = useQueryClient()
  const invalidate = () => {
    if (!organizationId) return
    void queryClient.invalidateQueries({ queryKey: proKeys.requests(organizationId) })
    void queryClient.invalidateQueries({ queryKey: proKeys.requestHistory(organizationId) })
  }
  useChannel({
    name: organizationId ? `pro-requests:${organizationId}` : null,
    table: 'appointments',
    filter: organizationId ? `organization_id=eq.${organizationId}` : undefined,
    onInsert: invalidate,
    onUpdate: invalidate,
    onReconnect: invalidate,
  })
}
