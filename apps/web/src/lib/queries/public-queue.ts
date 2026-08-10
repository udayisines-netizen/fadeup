import { useMutation, useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * Anon-callable read/write hooks backing the public queue surfaces at
 * `/s/:slug/walk-in` (kiosk self-check-in) and `/s/:slug/display` (TV-mode
 * "who's next" board) — LOT 11 phase 1. Both wrap `SECURITY DEFINER` RPCs
 * (see `db/migrations/20260809170100_public_queue_rpcs.sql`); `queue_entries`
 * itself has zero anon RLS access, so these RPCs are the only client-side
 * surface for public queue data. Every id is re-derived from the
 * organization slug and re-validated server-side, never trusted from the
 * caller.
 */

// --- get_public_queue_status --------------------------------------------------------

export type PublicQueueStatus = 'waiting' | 'called' | 'in_service'

export interface PublicQueueEntry {
  id: string
  displayName: string
  status: PublicQueueStatus
  /** Only meaningful for `waiting` entries — `null` for `called`/`in_service`. */
  queuePosition: number | null
  barberDisplayName: string | null
}

interface PublicQueueEntryRow {
  id: string
  display_name: string
  status: PublicQueueStatus
  queue_position: number | null
  barber_display_name: string | null
}

function mapPublicQueueEntry(row: PublicQueueEntryRow): PublicQueueEntry {
  return {
    id: row.id,
    displayName: row.display_name,
    status: row.status,
    queuePosition: row.queue_position,
    barberDisplayName: row.barber_display_name,
  }
}

/**
 * The live, privacy-reduced queue for one location — powers the TV-mode
 * display. Polls on an interval (there is no realtime path available to
 * `anon`, see migration comment) rather than subscribing to Postgres
 * Changes.
 */
export function usePublicQueueStatus(organizationSlug: string | undefined, locationId: string | undefined) {
  return useQuery({
    queryKey: ['public-queue-status', organizationSlug, locationId],
    queryFn: async (): Promise<PublicQueueEntry[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_public_queue_status', {
        p_organization_slug: organizationSlug,
        p_location_id: locationId,
      })
      if (error) throw error
      return ((data ?? []) as PublicQueueEntryRow[]).map(mapPublicQueueEntry)
    },
    enabled: Boolean(organizationSlug) && Boolean(locationId),
    refetchInterval: 6000,
  })
}

// --- join_public_queue -----------------------------------------------------------

export interface JoinPublicQueueInput {
  organizationSlug: string
  locationId: string
  customerName: string
  customerPhone?: string | null
  barberId?: string | null
  serviceId?: string | null
}

export interface JoinedQueueEntry {
  id: string
  status: PublicQueueStatus
  createdAt: string
}

interface JoinedQueueEntryRow {
  id: string
  status: PublicQueueStatus
  created_at: string
}

function mapJoinedQueueEntry(row: JoinedQueueEntryRow): JoinedQueueEntry {
  return { id: row.id, status: row.status, createdAt: row.created_at }
}

/**
 * A kiosk device's self-check-in: "I'm here, put me in line." No
 * scheduling/time-window logic — the entry joins the current live queue
 * immediately as `waiting`.
 */
export function useJoinPublicQueue() {
  return useMutation({
    mutationFn: async (input: JoinPublicQueueInput): Promise<JoinedQueueEntry> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('join_public_queue', {
        p_organization_slug: input.organizationSlug,
        p_location_id: input.locationId,
        p_customer_name: input.customerName,
        p_customer_phone: input.customerPhone ?? null,
        p_barber_id: input.barberId ?? null,
        p_service_id: input.serviceId ?? null,
      })
      if (error) throw error
      const rows = (data ?? []) as JoinedQueueEntryRow[]
      const row = rows[0]
      if (!row) throw new Error('The shop did not confirm check-in. Please try again.')
      return mapJoinedQueueEntry(row)
    },
  })
}
