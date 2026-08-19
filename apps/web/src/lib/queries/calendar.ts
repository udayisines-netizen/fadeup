import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import { pollingInterval, useRealtimeInvalidation } from '@/lib/realtime'

/**
 * The professional calendar's data layer.
 *
 * ONE RANGE READ. The schedule page fetched a day of appointments and then
 * resolved service, professional and location names client-side from three
 * separately-fetched lists. That is fine for one day and becomes an
 * N+1-shaped problem across a week or a month, so `get_calendar_appointments`
 * joins once, server-side, and is bounded by a range it cannot be called
 * without. See db/migrations/20260819200000_professional_workspace.sql.
 *
 * TIME BLOCKS COME FROM THE TABLE, not an RPC: unlike appointments they need
 * no enrichment, and public.time_blocks has real RLS (org members read;
 * front-of-house or the professional themselves write). There is nothing an
 * RPC would add except another layer to keep in sync.
 *
 * BOTH ARRIVE ON ONE CHANNEL. A calendar showing appointments live and blocks
 * only on refresh would be lying about half of what it draws.
 */

export type CalendarAppointmentStatus =
  | 'pending'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show'

export type AppointmentResolution =
  | 'declined'
  | 'expired'
  | 'cancelled_by_customer'
  | 'cancelled_by_business'
  | 'rescheduled'

export interface CalendarAppointment {
  id: string
  startsAt: string
  endsAt: string
  status: CalendarAppointmentStatus
  /** Why a cancelled appointment ended that way. Null for every live status. */
  resolution: AppointmentResolution | null
  expiresAt: string | null
  locationId: string
  locationName: string
  locationTimezone: string
  barberId: string | null
  barberDisplayName: string | null
  serviceId: string | null
  serviceName: string | null
  priceCents: number | null
  /** The organization's currency. Never the viewer's — see lib/intl/money.ts. */
  currency: string
  customerName: string
  customerPhone: string | null
  notes: string | null
  createdAt: string
}

interface CalendarAppointmentRow {
  id: string
  starts_at: string
  ends_at: string
  status: CalendarAppointmentStatus
  resolution: AppointmentResolution | null
  expires_at: string | null
  location_id: string
  location_name: string
  location_timezone: string
  barber_id: string | null
  barber_display_name: string | null
  service_id: string | null
  service_name: string | null
  price_cents: number | null
  currency: string | null
  customer_name: string
  customer_phone: string | null
  notes: string | null
  created_at: string
}

function mapAppointment(row: CalendarAppointmentRow): CalendarAppointment {
  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    resolution: row.resolution,
    expiresAt: row.expires_at,
    locationId: row.location_id,
    locationName: row.location_name,
    locationTimezone: row.location_timezone,
    barberId: row.barber_id,
    barberDisplayName: row.barber_display_name,
    serviceId: row.service_id,
    serviceName: row.service_name,
    priceCents: row.price_cents,
    currency: row.currency ?? 'EUR',
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    notes: row.notes,
    createdAt: row.created_at,
  }
}

export interface TimeBlock {
  id: string
  organizationId: string
  locationId: string | null
  barberId: string
  startsAt: string
  endsAt: string
  reason: string | null
}

interface TimeBlockRow {
  id: string
  organization_id: string
  location_id: string | null
  barber_id: string
  starts_at: string
  ends_at: string
  reason: string | null
}

function mapTimeBlock(row: TimeBlockRow): TimeBlock {
  return {
    id: row.id,
    organizationId: row.organization_id,
    locationId: row.location_id,
    barberId: row.barber_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: row.reason,
  }
}

export interface CalendarRange {
  /** Inclusive ISO instant. */
  from: string
  /** Exclusive ISO instant. */
  to: string
}

export interface CalendarFilters {
  locationId?: string | null
  barberId?: string | null
}

export const calendarAppointmentsKey = (
  organizationId: string | undefined,
  range: CalendarRange,
  filters: CalendarFilters,
) =>
  [
    'calendar-appointments',
    organizationId,
    range.from,
    range.to,
    filters.locationId ?? null,
    filters.barberId ?? null,
  ] as const

export const timeBlocksKey = (organizationId: string | undefined, range: CalendarRange) =>
  ['time-blocks', organizationId, range.from, range.to] as const

/**
 * Everything the calendar draws for one range, live.
 *
 * Appointments and blocks are separate queries — they invalidate for different
 * reasons and a block edit should not refetch the whole day's bookings — but
 * they share ONE realtime channel, because opening two websocket channels per
 * calendar view would be two reconnects, two failure modes and twice the
 * traffic for one screen.
 */
export function useCalendarRange(
  organizationId: string | undefined,
  range: CalendarRange,
  filters: CalendarFilters = {},
) {
  const realtimeStatus = useRealtimeInvalidation(
    organizationId ? `calendar-${organizationId}` : null,
    [
      { table: 'appointments', filter: organizationId ? `organization_id=eq.${organizationId}` : undefined },
      { table: 'time_blocks', filter: organizationId ? `organization_id=eq.${organizationId}` : undefined },
    ],
    // Invalidated by PREFIX, so any range currently mounted refetches — a
    // colleague moving an appointment out of today and into tomorrow has to
    // update both views, and only the server knows which ranges those are.
    [['calendar-appointments', organizationId], ['time-blocks', organizationId], ['booking-requests', organizationId]],
  )

  const appointmentsQuery = useQuery({
    queryKey: calendarAppointmentsKey(organizationId, range, filters),
    queryFn: async (): Promise<CalendarAppointment[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_calendar_appointments', {
        p_organization_id: organizationId,
        p_from: range.from,
        p_to: range.to,
        p_location_id: filters.locationId ?? null,
        p_barber_id: filters.barberId ?? null,
      })
      if (error) throw error
      return ((data ?? []) as CalendarAppointmentRow[]).map(mapAppointment)
    },
    enabled: Boolean(organizationId),
    // A pending request expires on a server clock with no event of its own
    // until the sweep runs, so the day goes stale even when nothing happened.
    refetchInterval: pollingInterval(realtimeStatus, { live: 120_000, offline: 20_000 }),
  })

  const blocksQuery = useQuery({
    queryKey: timeBlocksKey(organizationId, range),
    queryFn: async (): Promise<TimeBlock[]> => {
      const supabase = getSupabaseClient()
      // Overlap, not containment: a block starting yesterday and ending today
      // belongs on today's calendar.
      const { data, error } = await supabase
        .from('time_blocks')
        .select('id, organization_id, location_id, barber_id, starts_at, ends_at, reason')
        .eq('organization_id', organizationId!)
        .lt('starts_at', range.to)
        .gt('ends_at', range.from)
        .order('starts_at')
      if (error) throw error
      return ((data ?? []) as TimeBlockRow[]).map(mapTimeBlock)
    },
    enabled: Boolean(organizationId),
  })

  const timeBlocks = useMemo(() => {
    const all = blocksQuery.data ?? []
    // The RPC filters appointments server-side; blocks are filtered here
    // because narrowing a small, already-fetched list beats a second round
    // trip every time the professional filter changes.
    if (!filters.barberId) return all
    return all.filter((block) => block.barberId === filters.barberId)
  }, [blocksQuery.data, filters.barberId])

  return {
    appointments: appointmentsQuery.data ?? [],
    timeBlocks,
    isPending: appointmentsQuery.isPending || blocksQuery.isPending,
    isError: appointmentsQuery.isError || blocksQuery.isError,
    error: appointmentsQuery.error ?? blocksQuery.error,
    refetch: () => {
      void appointmentsQuery.refetch()
      void blocksQuery.refetch()
    },
    realtimeStatus,
  }
}

/** Everything a calendar write can have changed. Prefix keys, so every mounted range refetches. */
function useCalendarInvalidation(organizationId: string | undefined) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['calendar-appointments', organizationId] })
    void queryClient.invalidateQueries({ queryKey: ['time-blocks', organizationId] })
    void queryClient.invalidateQueries({ queryKey: ['appointments'] })
    void queryClient.invalidateQueries({ queryKey: ['booking-requests', organizationId] })
    void queryClient.invalidateQueries({ queryKey: ['available-slots'] })
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }
}

/**
 * Mark an appointment completed.
 *
 * Through the RPC, never a status PATCH: the RPC locks the row, refuses a
 * transition that is not from `confirmed`, records who decided, and returns
 * successfully if it was already completed — so the double-tap that happens
 * constantly on a phone in a busy shop is not an error.
 */
export function useCompleteAppointment(organizationId: string | undefined) {
  const invalidate = useCalendarInvalidation(organizationId)
  return useMutation({
    mutationFn: async (appointmentId: string) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('complete_appointment', { p_appointment_id: appointmentId })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/** Mark a no-show. Releases the slot through the existing exclusion predicate. */
export function useMarkAppointmentNoShow(organizationId: string | undefined) {
  const invalidate = useCalendarInvalidation(organizationId)
  return useMutation({
    mutationFn: async (appointmentId: string) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('mark_appointment_no_show', { p_appointment_id: appointmentId })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export interface CreateTimeBlockInput {
  organizationId: string
  barberId: string
  locationId?: string | null
  startsAt: string
  endsAt: string
  reason?: string | null
}

/**
 * Block time.
 *
 * organization_id is sent because the table requires it, and the consistency
 * trigger re-checks that the professional genuinely belongs to it — the value
 * comes from the caller's own resolved membership, never from a URL.
 */
export function useCreateTimeBlock(organizationId: string | undefined) {
  const invalidate = useCalendarInvalidation(organizationId)
  return useMutation({
    mutationFn: async (input: CreateTimeBlockInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('time_blocks').insert({
        organization_id: input.organizationId,
        barber_id: input.barberId,
        location_id: input.locationId ?? null,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        reason: input.reason?.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useDeleteTimeBlock(organizationId: string | undefined) {
  const invalidate = useCalendarInvalidation(organizationId)
  return useMutation({
    mutationFn: async (timeBlockId: string) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('time_blocks').delete().eq('id', timeBlockId)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/**
 * Turns a calendar write failure into something a person can act on.
 *
 * Extends the booking-lifecycle mapping with the two failures unique to this
 * surface: a transition the row is not in the right state for, and a time
 * block standing in the way.
 */
export function calendarErrorMessage(error: unknown): string {
  const message = (error && typeof error === 'object' && 'message' in error
    ? String((error as { message: unknown }).message)
    : ''
  ).toLowerCase()

  if (message.includes('only a confirmed appointment')) {
    return 'That only works on a confirmed appointment. Refresh to see where this one got to.'
  }
  if (message.includes('unavailable at the requested time')) {
    return 'That time is blocked for this professional. Remove the block first, or pick another time.'
  }
  if (message.includes('outside available hours')) {
    return 'That falls outside the opening hours for this day.'
  }
  if (message.includes('conflicting key value') || message.includes('exclusion constraint')) {
    return 'Someone just took that slot. Pick another time.'
  }
  if (message.includes('not authorized') || message.includes('row-level security')) {
    return "You don't have permission to change this."
  }
  if (message.includes('time_blocks_time_order') || message.includes('ends_at > starts_at')) {
    return 'The end time has to be after the start time.'
  }
  if (message.includes('not found')) {
    return 'That appointment no longer exists. Refresh to see the current day.'
  }
  return 'Something went wrong. Try again.'
}
