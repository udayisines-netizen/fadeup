import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import { pollingInterval, useRealtimeInvalidation } from '@/lib/realtime'

/**
 * The signed-in customer's own appointments/queue/favorites, across every
 * organization — see get_my_appointments/cancel_my_appointment/
 * get_my_queue_status/get_my_favorites and customer_favorites
 * (db/migrations/20260813130000_customer_app.sql). Every read goes through
 * a narrowly-scoped RPC (appointments/queue) or owner-scoped RLS
 * (favorites) — never a broad policy on shop-internal tables.
 */

export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'

/**
 * WHY an appointment ended. LOT C deliberately added no new status values —
 * every terminal state rides on status='cancelled' so the existing GiST
 * exclusion predicate frees the slot without being rebuilt — so `resolution` is
 * what lets this UI say "not accepted" or "expired" instead of the blunt
 * "cancelled" all three would otherwise share.
 */
export type AppointmentResolution =
  | 'declined'
  | 'expired'
  | 'cancelled_by_customer'
  | 'cancelled_by_business'
  | 'rescheduled'

/**
 * What the customer is actually looking at. Derived from (status, resolution)
 * once, here, so every surface tells the same story.
 */
export type BookingStage = 'waiting' | 'confirmed' | 'declined' | 'expired' | 'cancelled' | 'completed' | 'missed'

export function bookingStage(appointment: {
  status: AppointmentStatus
  resolution: AppointmentResolution | null
}): BookingStage {
  if (appointment.status === 'pending') return 'waiting'
  if (appointment.status === 'confirmed') return 'confirmed'
  if (appointment.status === 'completed') return 'completed'
  if (appointment.status === 'no_show') return 'missed'
  switch (appointment.resolution) {
    case 'declined': return 'declined'
    case 'expired': return 'expired'
    default: return 'cancelled'
  }
}

/** Stages that are still going somewhere, as opposed to finished. */
export function isLiveStage(stage: BookingStage): boolean {
  return stage === 'waiting' || stage === 'confirmed'
}

export interface MyAppointment {
  id: string
  organizationId: string
  organizationName: string
  organizationSlug: string
  locationId: string
  locationName: string
  barberId: string | null
  barberDisplayName: string | null
  serviceId: string | null
  serviceName: string | null
  startsAt: string
  endsAt: string
  status: AppointmentStatus
  priceCents: number | null
  /** The SHOP's currency and timezone — a customer's list genuinely spans countries. */
  currency: string
  locationTimezone: string
  resolution: AppointmentResolution | null
  resolutionNote: string | null
  /** Server-derived decision deadline while waiting. Displayed, never computed. */
  expiresAt: string | null
  createdAt: string
}

interface MyAppointmentRow {
  id: string
  organization_id: string
  organization_name: string
  organization_slug: string
  location_id: string
  location_name: string
  barber_id: string | null
  barber_display_name: string | null
  service_id: string | null
  service_name: string | null
  starts_at: string
  ends_at: string
  status: AppointmentStatus
  price_cents: number | null
  currency: string | null
  location_timezone: string | null
  resolution: AppointmentResolution | null
  resolution_note: string | null
  expires_at: string | null
  created_at: string
}

function mapAppointment(row: MyAppointmentRow): MyAppointment {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    organizationSlug: row.organization_slug,
    locationId: row.location_id,
    locationName: row.location_name,
    barberId: row.barber_id,
    barberDisplayName: row.barber_display_name,
    serviceId: row.service_id,
    serviceName: row.service_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    priceCents: row.price_cents,
    currency: row.currency ?? 'EUR',
    locationTimezone: row.location_timezone ?? 'UTC',
    resolution: row.resolution,
    resolutionNote: row.resolution_note,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }
}

const MY_APPOINTMENTS_KEY = ['my-appointments'] as const

/**
 * Every appointment the caller has ever made, any shop, most recent first —
 * and live.
 *
 * The subscription is on `notifications`, not `appointments`, and that is not a
 * shortcut. Customers deliberately hold NO select policy on appointments (their
 * reads go through curated RPCs so internal shop columns stay unreachable), so
 * Postgres Changes on that table would deliver them nothing at all. Every
 * booking transition writes them a notification row, which they DO own — so
 * the notification is the signal, and this refetches the authoritative RPC on
 * receiving one.
 *
 * That is what makes "shop accepts → customer sees Confirmed" work without a
 * refresh.
 */
export function useMyAppointments(enabled: boolean, userId?: string) {
  const realtimeStatus = useRealtimeInvalidation(
    enabled && userId ? `my-bookings-${userId}` : null,
    [{ table: 'notifications', filter: userId ? `user_id=eq.${userId}` : undefined, event: 'INSERT' }],
    [MY_APPOINTMENTS_KEY as unknown as string[]],
  )

  const query = useQuery({
    queryKey: MY_APPOINTMENTS_KEY,
    queryFn: async (): Promise<MyAppointment[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_my_appointments')
      if (error) throw error
      return ((data ?? []) as MyAppointmentRow[]).map(mapAppointment)
    },
    enabled,
    // A request can expire on the server clock with no event reaching this tab
    // at all, so the poll is a correctness backstop and not just a fallback.
    refetchInterval: enabled ? pollingInterval(realtimeStatus, { live: 60_000, offline: 20_000 }) : false,
  })

  return { ...query, realtimeStatus }
}

/** Cancels the caller's own pending/confirmed appointment — reuses the existing status machine, never a new cancellation rule. */
export function useCancelMyAppointment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (appointmentId: string): Promise<void> => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('cancel_my_appointment', { p_appointment_id: appointmentId })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_APPOINTMENTS_KEY })
    },
  })
}

export type QueueEntryStatus = 'waiting' | 'called' | 'in_service'

export interface MyQueueEntry {
  id: string
  organizationId: string
  organizationName: string
  organizationSlug: string
  locationId: string
  locationName: string
  status: QueueEntryStatus
  queuePosition: number | null
  barberDisplayName: string | null
  createdAt: string
}

interface MyQueueEntryRow {
  id: string
  organization_id: string
  organization_name: string
  organization_slug: string
  location_id: string
  location_name: string
  status: QueueEntryStatus
  queue_position: number | null
  barber_display_name: string | null
  created_at: string
}

function mapQueueEntry(row: MyQueueEntryRow): MyQueueEntry {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    organizationSlug: row.organization_slug,
    locationId: row.location_id,
    locationName: row.location_name,
    status: row.status,
    queuePosition: row.queue_position,
    barberDisplayName: row.barber_display_name,
    createdAt: row.created_at,
  }
}

/** The caller's own active (waiting/called/in_service) queue entries, any shop. */
export function useMyQueueStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['my-queue-status'],
    queryFn: async (): Promise<MyQueueEntry[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_my_queue_status')
      if (error) throw error
      return ((data ?? []) as MyQueueEntryRow[]).map(mapQueueEntry)
    },
    enabled,
    // Queue state is live/time-sensitive — refetch on a short interval
    // while the tab is open rather than relying only on Realtime wiring
    // (out of scope for this Wave — see docs/wave-1/PLAN.md's Live Queue
    // boundary section).
    refetchInterval: enabled ? 20_000 : false,
  })
}

export interface MyFavorite {
  favoriteId: string
  organizationId: string
  organizationName: string
  organizationSlug: string
  barberId: string | null
  barberDisplayName: string | null
  barberAvatarUrl: string | null
  createdAt: string
}

interface MyFavoriteRow {
  favorite_id: string
  organization_id: string
  organization_name: string
  organization_slug: string
  barber_id: string | null
  barber_display_name: string | null
  barber_avatar_url: string | null
  created_at: string
}

function mapFavorite(row: MyFavoriteRow): MyFavorite {
  return {
    favoriteId: row.favorite_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    organizationSlug: row.organization_slug,
    barberId: row.barber_id,
    barberDisplayName: row.barber_display_name,
    barberAvatarUrl: row.barber_avatar_url,
    createdAt: row.created_at,
  }
}

const MY_FAVORITES_KEY = ['my-favorites'] as const

export function useMyFavorites(enabled: boolean) {
  return useQuery({
    queryKey: MY_FAVORITES_KEY,
    queryFn: async (): Promise<MyFavorite[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_my_favorites')
      if (error) throw error
      return ((data ?? []) as MyFavoriteRow[]).map(mapFavorite)
    },
    enabled,
  })
}

export function useAddFavorite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, organizationId, barberId }: { userId: string; organizationId: string; barberId?: string | null }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase
        .from('customer_favorites')
        .insert({ user_id: userId, organization_id: organizationId, barber_id: barberId ?? null })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_FAVORITES_KEY })
    },
  })
}

export function useRemoveFavorite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (favoriteId: string) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('customer_favorites').delete().eq('id', favoriteId)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_FAVORITES_KEY })
    },
  })
}
