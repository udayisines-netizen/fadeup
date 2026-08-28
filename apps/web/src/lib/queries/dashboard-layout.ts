import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import type { MembershipRole } from '@/lib/types'

/**
 * ============================================================================
 * THE PRO DASHBOARD LAYOUT — THE SHOP'S, NOT YOURS
 * ============================================================================
 *
 * §24: the arrangement is common to the shop. One authorized person changes
 * it and every authorized person sees the change. `organization_dashboard_layouts`
 * is keyed on organization_id alone, so a per-member layout cannot exist by
 * accident, and RLS restricts writes to owner and manager.
 *
 * This module holds NO authorization logic. `canEditDashboardLayout` below is
 * a UI predicate — it decides whether to render a drag handle, not whether a
 * write succeeds. The database decides that, the same way, in one place, and
 * a `barber` who reaches the mutation anyway simply updates zero rows.
 */

/** The modules R5 ships. Order here is the PRODUCT DEFAULT, not a preference. */
export const DASHBOARD_MODULES = [
  'focus',
  'metrics',
  'today',
  'queue',
  'customers',
  'social',
] as const

export type DashboardModule = (typeof DASHBOARD_MODULES)[number]

function isDashboardModule(value: string): value is DashboardModule {
  return (DASHBOARD_MODULES as readonly string[]).includes(value)
}

/**
 * Reconciles a stored order with the modules this build actually has.
 *
 * Two things go wrong over time and both are silent:
 *
 *   A STORED KEY DISAPPEARS   a module is renamed or removed in a later lot,
 *                             and every shop that had arranged it is holding a
 *                             key nothing renders. Dropped here.
 *   A NEW MODULE APPEARS      a shop that saved a layout before it existed
 *                             would never see it, because their stored array
 *                             does not mention it. Appended here.
 *
 * The schema deliberately validates key SHAPE rather than a vocabulary, for
 * exactly this reason — adding a dashboard card must not require a migration.
 * This function is the other half of that decision.
 */
export function reconcileLayout(stored: string[] | null | undefined): DashboardModule[] {
  // Deduped as it is read, not merely filtered.
  //
  // The database already forbids duplicates, so this is belt-and-braces — but
  // "the constraint covers it" is exactly the reasoning that leaves a client
  // rendering the same module twice under the same React key the one time a
  // row predates the constraint or arrives from somewhere else. A dashboard
  // showing Queue twice is a bug nobody can explain from the UI.
  const seen = new Set<DashboardModule>()
  const known: DashboardModule[] = []
  for (const key of stored ?? []) {
    if (!isDashboardModule(key) || seen.has(key)) continue
    seen.add(key)
    known.push(key)
  }
  return [...known, ...DASHBOARD_MODULES.filter((module) => !seen.has(module))]
}

/** Owner and manager own shop configuration everywhere else in FadeUp too. */
export function canEditDashboardLayout(role: MembershipRole | undefined): boolean {
  return role === 'owner' || role === 'manager'
}

export const dashboardLayoutKey = (organizationId: string | undefined) =>
  ['organization-dashboard-layout', organizationId] as const

export function useDashboardLayout(organizationId: string | undefined) {
  return useQuery({
    queryKey: dashboardLayoutKey(organizationId),
    queryFn: async (): Promise<DashboardModule[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('organization_dashboard_layouts')
        .select('module_order')
        .eq('organization_id', organizationId)
        .maybeSingle()
      if (error) throw error
      // No row is the normal state for a shop that has never rearranged
      // anything, and it resolves to the product default rather than to an
      // error or an empty dashboard.
      return reconcileLayout((data as { module_order: string[] } | null)?.module_order ?? null)
    },
    enabled: Boolean(organizationId),
  })
}

export function useSaveDashboardLayout(organizationId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (moduleOrder: DashboardModule[]) => {
      if (!organizationId) throw new Error('No organization selected')
      const supabase = getSupabaseClient()
      const { data: userData } = await supabase.auth.getUser()

      // UPSERT on the primary key: the first arrangement a shop ever makes is
      // an INSERT and every one after it is an UPDATE, and the caller should
      // not have to know which. Both are gated by the same two RLS policies.
      const { error } = await supabase.from('organization_dashboard_layouts').upsert(
        {
          organization_id: organizationId,
          module_order: moduleOrder,
          // Recorded so an owner who finds the dashboard rearranged can find
          // out who did it. Never used to scope a read.
          updated_by: userData.user?.id ?? null,
        },
        { onConflict: 'organization_id' },
      )
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardLayoutKey(organizationId) })
    },
  })
}
