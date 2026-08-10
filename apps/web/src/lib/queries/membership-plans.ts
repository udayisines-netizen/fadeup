import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/** Mirrors public.billing_interval — see db/migrations/20260810110000_customer_memberships.sql. */
export type BillingInterval = 'weekly' | 'monthly' | 'yearly'

/**
 * A recurring plan a shop offers customers (e.g. "Unlimited Fades
 * Monthly") — NOT a staff role (see `useOrgMembers` in
 * `lib/queries/memberships.ts` for that unrelated concept). No real
 * billing yet (LOT 16) — `priceCents`/`billingInterval` describe the plan,
 * nothing here charges a card.
 */
export interface MembershipPlan {
  id: string
  organizationId: string
  name: string
  description: string | null
  priceCents: number
  billingInterval: BillingInterval
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface MembershipPlanRow {
  id: string
  organization_id: string
  name: string
  description: string | null
  price_cents: number
  billing_interval: BillingInterval
  is_active: boolean
  created_at: string
  updated_at: string
}

const PLAN_COLUMNS = 'id, organization_id, name, description, price_cents, billing_interval, is_active, created_at, updated_at'

function mapPlan(row: MembershipPlanRow): MembershipPlan {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    billingInterval: row.billing_interval,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** All membership plans for the org, active first — readable by any org member. */
export function useOrgMembershipPlans(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['membership-plans', organizationId],
    queryFn: async (): Promise<MembershipPlan[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('membership_plans')
        .select(PLAN_COLUMNS)
        .eq('organization_id', organizationId)
        .order('is_active', { ascending: false })
        .order('name', { ascending: true })

      if (error) throw error

      return ((data ?? []) as unknown as MembershipPlanRow[]).map(mapPlan)
    },
    enabled: Boolean(organizationId),
  })
}

export interface MembershipPlanInput {
  organizationId: string
  name: string
  description: string | null
  priceCents: number
  billingInterval: BillingInterval
  isActive: boolean
}

/** Create a plan. RLS restricts this to owner/manager — narrower than most booking tables, since pricing is a business decision. */
export function useCreateMembershipPlan() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: MembershipPlanInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('membership_plans').insert({
        organization_id: input.organizationId,
        name: input.name,
        description: input.description,
        price_cents: input.priceCents,
        billing_interval: input.billingInterval,
        is_active: input.isActive,
      })
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['membership-plans', variables.organizationId] })
    },
  })
}

export interface UpdateMembershipPlanInput extends MembershipPlanInput {
  id: string
}

/** Update a plan. RLS restricts this to owner/manager. */
export function useUpdateMembershipPlan() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateMembershipPlanInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase
        .from('membership_plans')
        .update({
          name: input.name,
          description: input.description,
          price_cents: input.priceCents,
          billing_interval: input.billingInterval,
          is_active: input.isActive,
        })
        .eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['membership-plans', variables.organizationId] })
    },
  })
}
