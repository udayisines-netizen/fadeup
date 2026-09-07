import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { bookingKeys, organizationKeys, profileKeys, queueKeys } from '@/shared/data/keys'
import {
  parseBookingRefusal,
  parseInterestRefusal,
  type BookingRefusalCode,
  type InterestRefusalCode,
} from '@/features/booking/lib/refusals'

/**
 * Le tunnel de réservation et « Mes réservations » — RPC uniquement, aucune
 * table. AUCUN optimisme nulle part : rien ne s'affiche comme réservé tant
 * que la base n'a pas répondu (F4 §4, P1 §17), et le serveur arbitre seul les
 * conflits de créneau (contrainte d'exclusion GiST).
 */

/** Refus nommé du tunnel — l'écran branche sur `.code`, jamais sur le texte. */
export class BookingRefusedError extends Error {
  readonly code: BookingRefusalCode
  constructor(code: BookingRefusalCode) {
    super(`booking refused: ${code}`)
    this.name = 'BookingRefusedError'
    this.code = code
  }
}

export class InterestRefusedError extends Error {
  readonly code: InterestRefusalCode
  constructor(code: InterestRefusalCode) {
    super(`interest request refused: ${code}`)
    this.name = 'InterestRefusedError'
    this.code = code
  }
}

function throwBookingError(error: unknown): never {
  const refusal = parseBookingRefusal(error)
  if (refusal) throw new BookingRefusedError(refusal)
  throw error as Error
}

/* ------------------------------------------------------------------ */
/* Lectures du tunnel                                                  */
/* ------------------------------------------------------------------ */

export function usePublicOrganization(slug: string | null) {
  return useQuery({
    queryKey: organizationKeys.publicBySlug(slug ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_public_organization', { p_slug: slug ?? '' })
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: Boolean(slug),
    staleTime: 300_000,
  })
}

export function usePublicLocations(slug: string | null) {
  return useQuery({
    queryKey: organizationKeys.locations(slug ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_public_locations', { p_organization_slug: slug ?? '' })
      if (error) throw error
      return data ?? []
    },
    enabled: Boolean(slug),
    staleTime: 300_000,
  })
}

/** Les services du lieu (entrée par le salon). */
export function usePublicServices(slug: string | null, locationId: string | null) {
  return useQuery({
    queryKey: organizationKeys.services(slug ?? '', locationId ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_public_services', {
        p_organization_slug: slug ?? '',
        p_location_id: locationId ?? '',
      })
      if (error) throw error
      return data ?? []
    },
    enabled: Boolean(slug && locationId),
    staleTime: 60_000,
  })
}

/** Les services d'UN barber (entrée par un profil barber — F4 §4). */
export function usePublicBarberServices(slug: string | null, barberId: string | null) {
  return useQuery({
    queryKey: profileKeys.barberServices(slug ?? '', barberId ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_public_barber_services', {
        p_organization_slug: slug ?? '',
        p_barber_id: barberId ?? '',
      })
      if (error) throw error
      return data ?? []
    },
    enabled: Boolean(slug && barberId),
    staleTime: 60_000,
  })
}

/** Les barbers aptes AU service choisi — la seule liste honnête à proposer. */
export function useEligibleBarbers(slug: string | null, locationId: string | null, serviceId: string | null) {
  return useQuery({
    queryKey: bookingKeys.barbers(slug ?? '', locationId ?? '', serviceId ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_public_barbers', {
        p_organization_slug: slug ?? '',
        p_location_id: locationId ?? '',
        p_service_id: serviceId ?? '',
      })
      if (error) throw error
      return data ?? []
    },
    enabled: Boolean(slug && locationId && serviceId),
    staleTime: 60_000,
  })
}

export interface PublicSlot {
  slot_start: string
  slot_end: string
}

/**
 * Les créneaux RÉELS d'un jour pour UN barber. `get_public_available_slots`
 * dit la vérité — rien n'est filtré ni ajouté côté client (F4 §3).
 */
export function useAvailableSlots(
  slug: string | null,
  locationId: string | null,
  barberId: string | null,
  serviceId: string | null,
  date: string | null,
) {
  return useQuery({
    queryKey: bookingKeys.slots(slug ?? '', locationId ?? '', barberId ?? '', serviceId ?? '', date ?? ''),
    queryFn: async (): Promise<PublicSlot[]> => {
      const { data, error } = await getSupabase().rpc('get_public_available_slots', {
        p_organization_slug: slug ?? '',
        p_location_id: locationId ?? '',
        p_barber_id: barberId ?? '',
        p_service_id: serviceId ?? '',
        p_date: date ?? '',
      })
      if (error) throw error
      return (data ?? []) as PublicSlot[]
    },
    enabled: Boolean(slug && locationId && barberId && serviceId && date),
    // Une disponibilité vieillit vite : re-lue à chaque retour sur l'étape.
    staleTime: 15_000,
  })
}

/**
 * « Premier professionnel disponible » (F4 §4) : les créneaux du jour de
 * CHAQUE barber apte, en parallèle. La fusion (créneau → premier barber qui
 * l'offre) appartient à l'appelant — ici on ne fabrique rien, on lit N fois
 * la même vérité serveur.
 */
export function useAvailableSlotsPerBarber(
  slug: string | null,
  locationId: string | null,
  barberIds: readonly string[],
  serviceId: string | null,
  date: string | null,
) {
  const enabled = Boolean(slug && locationId && serviceId && date)
  return useQueries({
    queries: barberIds.map((barberId) => ({
      queryKey: bookingKeys.slots(slug ?? '', locationId ?? '', barberId, serviceId ?? '', date ?? ''),
      queryFn: async (): Promise<PublicSlot[]> => {
        const { data, error } = await getSupabase().rpc('get_public_available_slots', {
          p_organization_slug: slug ?? '',
          p_location_id: locationId ?? '',
          p_barber_id: barberId,
          p_service_id: serviceId ?? '',
          p_date: date ?? '',
        })
        if (error) throw error
        return (data ?? []) as PublicSlot[]
      },
      enabled,
      staleTime: 15_000,
    })),
  })
}

export function useBookingServiceState(slug: string | null, locationId: string | null, barberId: string | null) {
  return useQuery({
    queryKey: organizationKeys.serviceState(slug ?? '', locationId ?? '', barberId),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_public_service_state', {
        p_organization_slug: slug ?? '',
        p_location_id: locationId ?? '',
        ...(barberId ? { p_barber_id: barberId } : {}),
      })
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: Boolean(slug && locationId),
    staleTime: 30_000,
  })
}

/**
 * L'organisation confirme-t-elle immédiatement, ou reçoit-elle une demande ?
 * (RPC F4, même sémantique que `accepts_immediate_booking` des alternatives
 * B2.) Le récapitulatif ANNONCE la bonne issue avant le geste — le client
 * doit savoir qu'il envoie une demande, pas l'apprendre après (F4 §3). La
 * vérité finale reste `is_request`, LUE de la réponse.
 */
export function usePublicBookingCapability(slug: string | null) {
  return useQuery({
    queryKey: [...bookingKeys.all, 'capability', slug ?? ''] as const,
    queryFn: async (): Promise<boolean | null> => {
      const { data, error } = await getSupabase().rpc('get_public_booking_capability', {
        p_organization_slug: slug ?? '',
      })
      if (error) throw error
      return data?.[0]?.accepts_immediate_booking ?? null
    },
    enabled: Boolean(slug),
    staleTime: 60_000,
  })
}

/* ------------------------------------------------------------------ */
/* La réservation elle-même                                            */
/* ------------------------------------------------------------------ */

export interface BookAppointmentInput {
  slug: string
  locationId: string
  barberId: string
  serviceId: string
  startsAt: string
  customerName: string
  customerEmail?: string
  customerPhone?: string
  notes?: string
}

export interface BookAppointmentResult {
  id: string
  starts_at: string
  ends_at: string
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
  /**
   * VRAI = une DEMANDE est partie, pas un rendez-vous. L'écran lit CE champ,
   * jamais une déduction d'enum — la déduction est exactement l'endroit où un
   * écran finit par mentir (F4 §2).
   */
  is_request: boolean
  expires_at: string | null
  claim_token: string | null
}

export function useBookAppointment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: BookAppointmentInput): Promise<BookAppointmentResult> => {
      const { data, error } = await getSupabase().rpc('book_public_appointment', {
        p_organization_slug: input.slug,
        p_location_id: input.locationId,
        p_barber_id: input.barberId,
        p_service_id: input.serviceId,
        p_starts_at: input.startsAt,
        p_customer_name: input.customerName,
        ...(input.customerEmail ? { p_customer_email: input.customerEmail } : {}),
        ...(input.customerPhone ? { p_customer_phone: input.customerPhone } : {}),
        ...(input.notes ? { p_notes: input.notes } : {}),
      })
      if (error) throwBookingError(error)
      const row = data?.[0]
      if (!row) throw new Error('book_public_appointment returned no row')
      return row as BookAppointmentResult
    },
    onSuccess: (_result, input) => {
      // Le créneau vient d'être retenu : les disponibilités du jour et mes
      // réservations sont périmées. Jamais d'écriture de cache — invalidation.
      void queryClient.invalidateQueries({ queryKey: bookingKeys.all })
      void queryClient.invalidateQueries({
        queryKey: organizationKeys.serviceState(input.slug, input.locationId, null),
      })
    },
  })
}

/* ------------------------------------------------------------------ */
/* Mes réservations                                                    */
/* ------------------------------------------------------------------ */

export interface MyAppointment {
  id: string
  organization_id: string
  organization_name: string
  organization_slug: string
  location_id: string
  location_name: string
  barber_id: string
  barber_display_name: string
  service_id: string
  service_name: string
  starts_at: string
  ends_at: string
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
  price_cents: number | null
  currency: string
  location_timezone: string
  resolution: 'declined' | 'expired' | 'cancelled_by_customer' | 'cancelled_by_business' | 'rescheduled' | null
  resolution_note: string | null
  expires_at: string | null
  created_at: string
}

export function useMyAppointments(enabled = true) {
  return useQuery({
    queryKey: bookingKeys.list({}),
    queryFn: async (): Promise<MyAppointment[]> => {
      const { data, error } = await getSupabase().rpc('get_my_appointments')
      if (error) throw error
      return (data ?? []) as MyAppointment[]
    },
    enabled,
    staleTime: 30_000,
  })
}

export function useCancelAppointment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (appointmentId: string) => {
      const { data, error } = await getSupabase().rpc('cancel_my_appointment', { p_appointment_id: appointmentId })
      if (error) throwBookingError(error)
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bookingKeys.all })
    },
  })
}

export function useRescheduleAppointment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { appointmentId: string; startsAt: string }) => {
      const { data, error } = await getSupabase().rpc('reschedule_appointment', {
        p_appointment_id: input.appointmentId,
        p_starts_at: input.startsAt,
      })
      if (error) throwBookingError(error)
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bookingKeys.all })
    },
  })
}

/** File active du client connecté — la même clé que le badge de nav. */
export function useMyQueueStatus(enabled: boolean) {
  return useQuery({
    queryKey: queueKeys.mine(),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_my_queue_status')
      if (error) throw error
      return data ?? []
    },
    enabled,
    refetchInterval: 30_000,
    staleTime: 0,
  })
}

/* ------------------------------------------------------------------ */
/* Alternatives et demande d'intérêt                                   */
/* ------------------------------------------------------------------ */

/**
 * L'identité publique visée par une demande d'intérêt. Même clé et même
 * forme que le profil public (cache partagé entre les deux surfaces).
 */
export function useBookingProfessionalByHandle(handle: string | null) {
  return useQuery({
    queryKey: profileKeys.publicByHandle(handle ?? ''),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_public_professional_by_handle', { p_handle: handle ?? '' })
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: Boolean(handle),
    staleTime: 60_000,
  })
}

export interface BookingAlternative {
  organization_id: string
  organization_name: string
  organization_slug: string
  marketplace_supply_type: string | null
  location_id: string
  location_name: string
  location_kind: 'physical_address' | 'service_area'
  city: string | null
  distance_km: number | null
  covers_search_point: boolean | null
  starting_price_cents: number | null
  is_open_now: boolean | null
  /**
   * VRAI seulement si l'organisation peut CONFIRMER immédiatement. FAUX
   * presque partout aujourd'hui — c'est une information vraie, pas un défaut :
   * l'écran ne dit jamais « réservez ici » quand c'est faux (F4 §5).
   */
  accepts_immediate_booking: boolean
}

export function useBookingAlternatives(input: {
  excludeOrganizationId: string | null
  serviceQuery: string | null
  latitude: number | null
  longitude: number | null
  enabled: boolean
}) {
  const coords = input.latitude !== null && input.longitude !== null ? `${input.latitude},${input.longitude}` : null
  return useQuery({
    queryKey: bookingKeys.alternatives(input.excludeOrganizationId ?? '', input.serviceQuery, coords),
    queryFn: async (): Promise<BookingAlternative[]> => {
      const { data, error } = await getSupabase().rpc('get_public_booking_alternatives', {
        ...(input.excludeOrganizationId ? { p_exclude_organization_id: input.excludeOrganizationId } : {}),
        ...(input.serviceQuery ? { p_service_query: input.serviceQuery } : {}),
        ...(input.latitude !== null ? { p_latitude: input.latitude } : {}),
        ...(input.longitude !== null ? { p_longitude: input.longitude } : {}),
      })
      if (error) throw error
      return (data ?? []) as BookingAlternative[]
    },
    enabled: input.enabled,
    staleTime: 60_000,
  })
}

/** Devise par organisation — pour afficher un « à partir de » honnête sur les alternatives. */
export function usePublicCurrencies(organizationIds: readonly string[]) {
  const sorted = [...organizationIds].sort()
  return useQuery({
    queryKey: [...bookingKeys.all, 'currencies', sorted] as const,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await getSupabase().rpc('get_public_currencies', { p_organization_ids: sorted })
      if (error) throw error
      return Object.fromEntries((data ?? []).map((row) => [row.organization_id, row.currency]))
    },
    enabled: sorted.length > 0,
    staleTime: 300_000,
  })
}

export interface InterestRequestInput {
  professionalId: string
  customerName: string
  serviceLabel: string
  preferredStartsAt: string
  customerEmail?: string
  customerPhone?: string
  notes?: string
  locale: string
}

export interface InterestRequestResult {
  id: string
  status: 'pending' | 'expired' | 'withdrawn'
  preferred_starts_at: string
  expires_at: string
  professional_display_name: string
}

/**
 * Demande d'intérêt vers un profil NON revendiqué (B2) : elle ne retient
 * aucun créneau et n'affirme aucune disponibilité — `preferred_starts_at`
 * est la préférence du client, jamais une offre du professionnel (F4 §6).
 */
export function useCreateInterestRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: InterestRequestInput): Promise<InterestRequestResult> => {
      const { data, error } = await getSupabase().rpc('create_professional_interest_request', {
        p_professional_id: input.professionalId,
        p_customer_name: input.customerName,
        p_service_label: input.serviceLabel,
        p_preferred_starts_at: input.preferredStartsAt,
        ...(input.customerEmail ? { p_customer_email: input.customerEmail } : {}),
        ...(input.customerPhone ? { p_customer_phone: input.customerPhone } : {}),
        ...(input.notes ? { p_notes: input.notes } : {}),
        p_locale: input.locale,
      })
      if (error) {
        const refusal = parseInterestRefusal(error)
        if (refusal) throw new InterestRefusedError(refusal)
        throw error
      }
      const row = data?.[0]
      if (!row) throw new Error('create_professional_interest_request returned no row')
      return row as InterestRequestResult
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bookingKeys.interestRequests() })
    },
  })
}

export interface MyInterestRequest {
  id: string
  professional_id: string
  professional_display_name: string
  professional_handle: string | null
  service_label: string
  preferred_starts_at: string
  status: 'pending' | 'expired' | 'withdrawn'
  expires_at: string
  created_at: string
}

export function useMyInterestRequests(enabled: boolean) {
  return useQuery({
    queryKey: bookingKeys.interestRequests(),
    queryFn: async (): Promise<MyInterestRequest[]> => {
      const { data, error } = await getSupabase().rpc('get_my_interest_requests')
      if (error) throw error
      return (data ?? []) as MyInterestRequest[]
    },
    enabled,
    staleTime: 30_000,
  })
}
