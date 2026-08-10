import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/** Mirrors public.customer_membership_status — see db/migrations/20260810110000_customer_memberships.sql. */
export type CustomerMembershipStatus = 'active' | 'paused' | 'cancelled' | 'expired'

/** One customer's enrollment in one `MembershipPlan`. Only one `active`/`paused` row per customer at a time (a DB-level unique index, not just a UI convention). */
export interface CustomerMembership {
  id: string
  organizationId: string
  customerId: string
  planId: string
  status: CustomerMembershipStatus
  startedAt: string
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelledAt: string | null
  notes: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

interface CustomerMembershipRow {
  id: string
  organization_id: string
  customer_id: string
  plan_id: string
  status: CustomerMembershipStatus
  started_at: string
  current_period_start: string
  current_period_end: string
  cancelled_at: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

const CUSTOMER_MEMBERSHIP_COLUMNS =
  'id, organization_id, customer_id, plan_id, status, started_at, current_period_start, current_period_end, cancelled_at, notes, created_by, created_at, updated_at'

function mapCustomerMembership(row: CustomerMembershipRow): CustomerMembership {
  return {
    id: row.id,
    organizationId: row.organization_id,
    customerId: row.customer_id,
    planId: row.plan_id,
    status: row.status,
    startedAt: row.started_at,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelledAt: row.cancelled_at,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** All customer memberships for the org, most recently updated first — readable by any org member. */
export function useOrgCustomerMemberships(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['customer-memberships', organizationId],
    queryFn: async (): Promise<CustomerMembership[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('customer_memberships')
        .select(CUSTOMER_MEMBERSHIP_COLUMNS)
        .eq('organization_id', organizationId)
        .order('updated_at', { ascending: false })

      if (error) throw error

      return ((data ?? []) as unknown as CustomerMembershipRow[]).map(mapCustomerMembership)
    },
    enabled: Boolean(organizationId),
  })
}

export interface EnrollCustomerMembershipInput {
  organizationId: string
  customerId: string
  planId: string
  currentPeriodEnd: string
  notes: string | null
  createdBy: string | null
}

/**
 * Enroll a customer in a plan. RLS restricts this to owner/manager/
 * receptionist (front-of-house work, same role set as appointments/queue).
 * A second concurrent `active`/`paused` enrollment for the same customer is
 * rejected by `customer_memberships_one_open_per_customer` — shown as
 * friendly copy by the caller (see `friendlyMembershipError`).
 */
export function useEnrollCustomerMembership() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: EnrollCustomerMembershipInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('customer_memberships').insert({
        organization_id: input.organizationId,
        customer_id: input.customerId,
        plan_id: input.planId,
        current_period_end: input.currentPeriodEnd,
        notes: input.notes,
        created_by: input.createdBy,
      })
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['customer-memberships', variables.organizationId] })
    },
  })
}

export interface UpdateCustomerMembershipStatusInput {
  id: string
  organizationId: string
  status: CustomerMembershipStatus
}

/** Change a customer membership's status. RLS restricts this to owner/manager/receptionist. */
export function useUpdateCustomerMembershipStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateCustomerMembershipStatusInput) => {
      const supabase = getSupabaseClient()
      const payload: Record<string, unknown> = { status: input.status }
      if (input.status === 'cancelled') payload.cancelled_at = new Date().toISOString()

      const { error } = await supabase.from('customer_memberships').update(payload).eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['customer-memberships', variables.organizationId] })
    },
  })
}
