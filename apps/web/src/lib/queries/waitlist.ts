import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/** Mirrors public.waitlist_status — see db/migrations/20260810100000_waitlist_and_no_show_rules.sql. */
export type WaitlistStatus = 'waiting' | 'notified' | 'booked' | 'cancelled' | 'expired'

/**
 * A customer waiting for a future opening — distinct from `QueueEntry`
 * (someone physically present right now, LOT 10) and `Appointment` (an
 * already-confirmed slot, LOT 8). Staff-managed only in this pass; there is
 * no public "join the waitlist" flow yet.
 */
export interface WaitlistEntry {
  id: string
  organizationId: string
  locationId: string
  customerId: string | null
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  desiredServiceId: string | null
  desiredBarberId: string | null
  notes: string | null
  status: WaitlistStatus
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

interface WaitlistEntryRow {
  id: string
  organization_id: string
  location_id: string
  customer_id: string | null
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  desired_service_id: string | null
  desired_barber_id: string | null
  notes: string | null
  status: WaitlistStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

const WAITLIST_COLUMNS =
  'id, organization_id, location_id, customer_id, customer_name, customer_phone, customer_email, desired_service_id, desired_barber_id, notes, status, created_by, created_at, updated_at'

function mapWaitlistEntry(row: WaitlistEntryRow): WaitlistEntry {
  return {
    id: row.id,
    organizationId: row.organization_id,
    locationId: row.location_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    desiredServiceId: row.desired_service_id,
    desiredBarberId: row.desired_barber_id,
    notes: row.notes,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Active (`waiting`/`notified`) waitlist entries across the org, oldest first — filter further by `locationId` client-side. */
export function useOrgWaitlist(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['waitlist', organizationId],
    queryFn: async (): Promise<WaitlistEntry[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('waitlist_entries')
        .select(WAITLIST_COLUMNS)
        .eq('organization_id', organizationId)
        .in('status', ['waiting', 'notified'])
        .order('created_at', { ascending: true })

      if (error) throw error

      return ((data ?? []) as unknown as WaitlistEntryRow[]).map(mapWaitlistEntry)
    },
    enabled: Boolean(organizationId),
  })
}

export interface AddToWaitlistInput {
  organizationId: string
  locationId: string
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  desiredServiceId: string | null
  desiredBarberId: string | null
  notes: string | null
  createdBy: string | null
}

/** Add a customer to the waitlist. RLS restricts this to owner/manager/receptionist. */
export function useAddToWaitlist() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: AddToWaitlistInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('waitlist_entries').insert({
        organization_id: input.organizationId,
        location_id: input.locationId,
        customer_name: input.customerName,
        customer_phone: input.customerPhone,
        customer_email: input.customerEmail,
        desired_service_id: input.desiredServiceId,
        desired_barber_id: input.desiredBarberId,
        notes: input.notes,
        created_by: input.createdBy,
      })
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['waitlist', variables.organizationId] })
    },
  })
}

export interface UpdateWaitlistEntryStatusInput {
  id: string
  organizationId: string
  status: WaitlistStatus
}

/** Change a waitlist entry's status. RLS restricts this to owner/manager/receptionist. */
export function useUpdateWaitlistEntryStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateWaitlistEntryStatusInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('waitlist_entries').update({ status: input.status }).eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['waitlist', variables.organizationId] })
    },
  })
}
