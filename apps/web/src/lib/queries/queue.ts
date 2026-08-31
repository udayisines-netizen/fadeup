import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import { useRealtimeInvalidation } from '@/lib/realtime'

/** Mirrors public.queue_status — see db/migrations/20260809160000_queue_entries.sql. */
export type QueueStatus = 'waiting' | 'called' | 'in_service' | 'completed' | 'cancelled' | 'no_show'

/** Active statuses shown on the live queue board — a completed/cancelled/no_show entry has left the line. */
const ACTIVE_STATUSES: QueueStatus[] = ['waiting', 'called', 'in_service']

/**
 * Walk-in queue entry — a deliberately separate concept from `Appointment`,
 * see the migration header comment. `barberId`/`serviceId` are nullable:
 * null `barberId` means "any available barber," null `serviceId` means the
 * walk-in didn't specify one. Position in line is never stored here — it's
 * derived client-side from `createdAt` order among `status: 'waiting'`
 * entries (see `app-queue-page.tsx`), the same way the DB's own
 * `get_public_queue_status` RPC derives it via `row_number()`.
 */
export interface QueueEntry {
  id: string
  organizationId: string
  locationId: string
  barberId: string | null
  serviceId: string | null
  customerName: string
  customerPhone: string | null
  status: QueueStatus
  notes: string | null
  calledAt: string | null
  serviceStartedAt: string | null
  completedAt: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

interface QueueEntryRow {
  id: string
  organization_id: string
  location_id: string
  barber_id: string | null
  service_id: string | null
  customer_name: string
  customer_phone: string | null
  status: QueueStatus
  notes: string | null
  called_at: string | null
  service_started_at: string | null
  completed_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

const QUEUE_COLUMNS =
  'id, organization_id, location_id, barber_id, service_id, customer_name, customer_phone, status, notes, called_at, service_started_at, completed_at, created_by, created_at, updated_at'

function mapQueueEntry(row: QueueEntryRow): QueueEntry {
  return {
    id: row.id,
    organizationId: row.organization_id,
    locationId: row.location_id,
    barberId: row.barber_id,
    serviceId: row.service_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    status: row.status,
    notes: row.notes,
    calledAt: row.called_at,
    serviceStartedAt: row.service_started_at,
    completedAt: row.completed_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * All active (`waiting`/`called`/`in_service`) queue entries across the org,
 * ordered by `created_at` — filter further by `locationId` client-side (same
 * pattern as `useOrgAppointmentsForDate`/`useOrgChairs`), and derive each
 * waiting entry's line position client-side rather than trusting a stored
 * column (there isn't one).
 *
 * Also subscribes to Supabase Realtime Postgres Changes on `queue_entries`
 * for this org, invalidating the query on any insert/update/delete so the
 * board updates live without polling or a manual refresh. RLS (not this
 * filter) is what makes the subscription itself tenant-safe — see the
 * migration's Realtime section — this `organization_id=eq.` filter just
 * avoids receiving/re-fetching on every other org's events too.
 */
export function useOrgQueue(organizationId: string | undefined) {
  // Through the shared helper rather than a hand-rolled channel, so this board
  // inherits its lifecycle guarantees: a physical topic unique to each mount
  // (a hand-rolled `channel('queue-entries-<org>')` re-created while the
  // previous removeChannel is still in flight gets handed the old, already
  // subscribed channel and throws), and a hard stop on invalidations from a
  // channel whose org has already been switched away from.
  useRealtimeInvalidation(
    organizationId ? `queue-entries-${organizationId}` : null,
    [{ table: 'queue_entries', filter: `organization_id=eq.${organizationId}` }],
    [['queue', organizationId]],
  )

  return useQuery({
    queryKey: ['queue', organizationId],
    queryFn: async (): Promise<QueueEntry[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('queue_entries')
        .select(QUEUE_COLUMNS)
        .eq('organization_id', organizationId)
        .in('status', ACTIVE_STATUSES)
        .order('created_at', { ascending: true })

      if (error) throw error

      return ((data ?? []) as unknown as QueueEntryRow[]).map(mapQueueEntry)
    },
    enabled: Boolean(organizationId),
  })
}

export interface AddToQueueInput {
  organizationId: string
  locationId: string
  barberId: string | null
  serviceId: string | null
  customerName: string
  customerPhone: string | null
  notes: string | null
  createdBy: string | null
}

/** Add a walk-in to the queue. RLS restricts this to owner/manager/receptionist regardless of what the client sends. */
export function useAddToQueue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: AddToQueueInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('queue_entries').insert({
        organization_id: input.organizationId,
        location_id: input.locationId,
        barber_id: input.barberId,
        service_id: input.serviceId,
        customer_name: input.customerName,
        customer_phone: input.customerPhone,
        notes: input.notes,
        created_by: input.createdBy,
      })
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['queue', variables.organizationId] })
    },
  })
}

export interface UpdateQueueEntryStatusInput {
  id: string
  organizationId: string
  status: QueueStatus
}

/** The status-transition timestamp column to stamp alongside a status change — there is no DB trigger that does this automatically. */
const STATUS_TIMESTAMP_COLUMN: Partial<Record<QueueStatus, 'called_at' | 'service_started_at' | 'completed_at'>> = {
  called: 'called_at',
  in_service: 'service_started_at',
  completed: 'completed_at',
}

/**
 * Change a queue entry's status (and stamp the matching timestamp column
 * client-side). RLS allows this for owner/manager/receptionist on any entry,
 * and — since LOT 11 phase 1 — for a barber on a queue entry where they are
 * the assigned `barber_id` (restricted server-side by trigger to just
 * status/timestamp/notes columns; this mutation only ever touches those).
 */
export function useUpdateQueueEntryStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateQueueEntryStatusInput) => {
      const supabase = getSupabaseClient()
      const timestampColumn = STATUS_TIMESTAMP_COLUMN[input.status]
      const payload: Record<string, string> = { status: input.status }
      if (timestampColumn) payload[timestampColumn] = new Date().toISOString()

      const { error } = await supabase.from('queue_entries').update(payload).eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['queue', variables.organizationId] })
    },
  })
}
