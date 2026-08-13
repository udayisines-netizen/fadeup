import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * The signed-in customer's own appointments/queue/favorites, across every
 * organization — see get_my_appointments/cancel_my_appointment/
 * get_my_queue_status/get_my_favorites and customer_favorites
 * (db/migrations/20260813130000_customer_app.sql). Every read goes through
 * a narrowly-scoped RPC (appointments/queue) or owner-scoped RLS
 * (favorites) — never a broad policy on shop-internal tables.
 */

export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'

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
  }
}

const MY_APPOINTMENTS_KEY = ['my-appointments'] as const

/** Every appointment the caller has ever made, any shop, most recent first. `enabled` on having a session. */
export function useMyAppointments(enabled: boolean) {
  return useQuery({
    queryKey: MY_APPOINTMENTS_KEY,
    queryFn: async (): Promise<MyAppointment[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_my_appointments')
      if (error) throw error
      return ((data ?? []) as MyAppointmentRow[]).map(mapAppointment)
    },
    enabled,
  })
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
