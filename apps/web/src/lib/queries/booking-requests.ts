import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import { pollingInterval, useRealtimeInvalidation } from '@/lib/realtime'

/**
 * The professional side of the booking loop.
 *
 * A public booking arrives as `pending` and holds the slot. Until LOT C there
 * was nowhere for a shop to see it, so it held that slot forever. These are
 * the reads and the two decisions that close it.
 *
 * Every decision goes through a SECURITY DEFINER RPC — never a status PATCH.
 * The RPC re-checks the role, locks the row, guards the state and writes the
 * customer's notification in the same transaction. See
 * db/migrations/20260819100000_booking_loop.sql.
 */

export interface BookingRequest {
  id: string
  locationId: string
  locationName: string
  barberId: string | null
  barberDisplayName: string | null
  serviceId: string | null
  serviceName: string | null
  durationMinutes: number | null
  priceCents: number | null
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  notes: string | null
  startsAt: string
  endsAt: string
  /** Server-derived deadline. The client displays it and never computes it. */
  expiresAt: string | null
  createdAt: string
}

interface BookingRequestRow {
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
}

function mapRequest(row: BookingRequestRow): BookingRequest {
  return {
    id: row.id,
    locationId: row.location_id,
    locationName: row.location_name,
    barberId: row.barber_id,
    barberDisplayName: row.barber_display_name,
    serviceId: row.service_id,
    serviceName: row.service_name,
    durationMinutes: row.duration_minutes,
    priceCents: row.price_cents,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    notes: row.notes,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }
}

export const bookingRequestsKey = (organizationId: string | undefined) =>
  ['booking-requests', organizationId] as const

/**
 * Pending requests awaiting a decision, live.
 *
 * Staff hold appointments_select through org membership, so they can subscribe
 * to `appointments` directly — a new request, an acceptance by a colleague on
 * another device, or the expiry sweep all arrive as events. The query then
 * refetches through the RPC, which is what filters by role and hides requests
 * already past their deadline.
 */
export function useBookingRequests(organizationId: string | undefined) {
  const realtimeStatus = useRealtimeInvalidation(
    organizationId ? `booking-requests-${organizationId}` : null,
    [{ table: 'appointments', filter: organizationId ? `organization_id=eq.${organizationId}` : undefined }],
    [bookingRequestsKey(organizationId), ['appointments', organizationId]],
  )

  const query = useQuery({
    queryKey: bookingRequestsKey(organizationId),
    queryFn: async (): Promise<BookingRequest[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_booking_requests', {
        p_organization_id: organizationId,
      })
      if (error) throw error
      return ((data ?? []) as BookingRequestRow[]).map(mapRequest)
    },
    enabled: Boolean(organizationId),
    // Requests expire on a server clock, so the list goes stale on its own even
    // with no event at all. The poll also covers a dropped socket.
    refetchInterval: pollingInterval(realtimeStatus, { live: 60_000, offline: 15_000 }),
  })

  return { ...query, realtimeStatus }
}

/** Everything a decision can have changed, in one place so the two mutations agree. */
function useDecisionInvalidation(organizationId: string | undefined) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: bookingRequestsKey(organizationId) })
    void queryClient.invalidateQueries({ queryKey: ['appointments', organizationId] })
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }
}

/**
 * Accept a request.
 *
 * No optimistic update: this can legitimately fail — a colleague answered
 * first, or the deadline passed — and showing "confirmed" before the server
 * agrees would be showing something untrue about a customer's appointment.
 * The button shows pending state instead, which is honest and fast enough.
 */
export function useConfirmBookingRequest(organizationId: string | undefined) {
  const invalidate = useDecisionInvalidation(organizationId)
  return useMutation({
    mutationFn: async (appointmentId: string) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('confirm_booking_request', { p_appointment_id: appointmentId })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useDeclineBookingRequest(organizationId: string | undefined) {
  const invalidate = useDecisionInvalidation(organizationId)
  return useMutation({
    mutationFn: async ({ appointmentId, note }: { appointmentId: string; note?: string | null }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('decline_booking_request', {
        p_appointment_id: appointmentId,
        p_note: note?.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/** Shop-side cancellation of an already-confirmed appointment. */
export function useCancelAppointmentAsBusiness(organizationId: string | undefined) {
  const invalidate = useDecisionInvalidation(organizationId)
  return useMutation({
    mutationFn: async ({ appointmentId, note }: { appointmentId: string; note?: string | null }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('cancel_appointment_as_business', {
        p_appointment_id: appointmentId,
        p_note: note?.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export interface RescheduleInput {
  appointmentId: string
  startsAt: string
  barberId?: string | null
}

/**
 * Move an appointment.
 *
 * The server updates the same row in one statement, so the GiST exclusion
 * constraint validates the destination and a conflict leaves the original
 * exactly as it was — there is never a moment with two appointments.
 */
export function useRescheduleAppointment(organizationId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: RescheduleInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('reschedule_appointment', {
        p_appointment_id: input.appointmentId,
        p_starts_at: input.startsAt,
        p_barber_id: input.barberId ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bookingRequestsKey(organizationId) })
      void queryClient.invalidateQueries({ queryKey: ['appointments'] })
      void queryClient.invalidateQueries({ queryKey: ['my-appointments'] })
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

/**
 * Turns a booking-lifecycle failure into something a person can act on.
 *
 * These errors are NORMAL: two staff answering at once, or a deadline passing
 * mid-tap, are the system working. The raw Postgres message ("this request has
 * already been answered") is close to readable but arrives with an SQLSTATE
 * and no next step, so it is mapped here.
 */
export function bookingErrorKey(error: unknown): string {
  const message = (error && typeof error === 'object' && 'message' in error
    ? String((error as { message: unknown }).message)
    : ''
  ).toLowerCase()

  if (message.includes('already been answered')) return 'requests.errors.alreadyAnswered'
  if (message.includes('has expired')) return 'requests.errors.expired'
  if (message.includes('not authorized')) return 'requests.errors.notAuthorized'
  if (message.includes('no longer be cancelled')) return 'requests.errors.notCancellable'
  if (message.includes('no longer be rescheduled')) return 'requests.errors.notReschedulable'
  if (message.includes('conflicting key value') || message.includes('exclusion constraint')) {
    return 'requests.errors.slotTaken'
  }
  if (message.includes('must be in the future')) return 'requests.errors.pastTime'
  return 'requests.errors.generic'
}
