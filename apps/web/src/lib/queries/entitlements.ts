import { useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import type { CapabilityId, CommercialFamily, PlanId } from '@/lib/commerce/plans'

/**
 * What this organization is actually entitled to — resolved by the database,
 * not by the browser.
 *
 * Wraps `public.get_organization_entitlements()`, which re-derives the caller's
 * membership from `auth.uid()` before it answers. The organization id below is
 * a QUESTION, never a credential: passing somebody else's produces the same
 * 42501 whether that organization exists or not.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT
 *
 *   It is for showing, hiding, disabling and — most importantly — EXPLAINING.
 *   A professional who cannot open a second salon should be told that their
 *   plan covers one, not shown a button that fails.
 *
 *   It is NOT authorization. Hiding a navigation item secures nothing. The
 *   enforcement lives in the database: the establishment cap and the
 *   operational-professional cap are triggers that fire for every writer
 *   including service_role and postgres, and plan assignment is a
 *   platform-admin-only RPC. If this module were deleted the product would
 *   become confusing, not insecure — which is the correct relationship between
 *   a UI gate and a real one.
 *
 *   The `capabilities` list is the LIVE set: packaged by the plan AND actually
 *   built. A packaged-but-unbuilt capability resolves false for everyone at
 *   every price, because there is nothing behind the gate to open onto.
 *   `packagedCapabilities` carries the full set for the surfaces that
 *   legitimately need to say "on the roadmap".
 */

export type CommercialStatus = 'active' | 'past_due' | 'canceled'
export type EntitlementSource = 'early_access' | 'platform_grant' | 'billing'

export interface OrganizationEntitlements {
  organizationId: string
  /** The plan the organization is ON. */
  planKey: PlanId
  family: CommercialFamily
  displayName: string
  priceMinor: number
  priceCurrency: string
  status: CommercialStatus
  /**
   * Why the plan is in force. `billing` is never written today — no billing
   * provider is integrated — so seeing it would mean something fabricated it.
   */
  entitlementSource: EntitlementSource
  /**
   * The plan actually IN FORCE, which differs from `planKey` when a
   * subscription is canceled: capacity drops to free while the assigned plan
   * stays visible, so the history remains legible and nothing is rewritten.
   */
  effectivePlanKey: PlanId
  maxEstablishments: number
  usedEstablishments: number
  /** null means unlimited — which is how "team is included" is spelled. */
  maxOperationalProfessionals: number | null
  usedOperationalProfessionals: number
  /** Packaged AND built. This is what a gate should consult. */
  capabilities: CapabilityId[]
  /** Everything the plan includes, built or not. For "on the roadmap" copy only. */
  packagedCapabilities: CapabilityId[]
}

interface EntitlementsRow {
  organization_id: string
  plan_key: PlanId
  commercial_family: CommercialFamily
  display_name: string
  price_minor: number
  price_currency: string
  status: CommercialStatus
  entitlement_source: EntitlementSource
  effective_plan_key: PlanId
  max_establishments: number
  used_establishments: number
  max_operational_professionals: number | null
  used_operational_professionals: number
  live_capabilities: CapabilityId[] | null
  packaged_capabilities: CapabilityId[] | null
}

function mapEntitlements(row: EntitlementsRow): OrganizationEntitlements {
  return {
    organizationId: row.organization_id,
    planKey: row.plan_key,
    family: row.commercial_family,
    displayName: row.display_name,
    priceMinor: row.price_minor,
    priceCurrency: row.price_currency,
    status: row.status,
    entitlementSource: row.entitlement_source,
    effectivePlanKey: row.effective_plan_key,
    maxEstablishments: row.max_establishments,
    usedEstablishments: row.used_establishments,
    maxOperationalProfessionals: row.max_operational_professionals,
    usedOperationalProfessionals: row.used_operational_professionals,
    capabilities: row.live_capabilities ?? [],
    packagedCapabilities: row.packaged_capabilities ?? [],
  }
}

export const organizationEntitlementsKey = (organizationId: string | undefined) =>
  ['organization-entitlements', organizationId] as const

export function useOrganizationEntitlements(organizationId: string | undefined) {
  return useQuery({
    queryKey: organizationEntitlementsKey(organizationId),
    queryFn: async (): Promise<OrganizationEntitlements | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_organization_entitlements', {
        p_organization_id: organizationId,
      })
      if (error) throw error
      const rows = (data ?? []) as EntitlementsRow[]
      return rows.length > 0 ? mapEntitlements(rows[0]!) : null
    },
    enabled: Boolean(organizationId),
    // A plan changes through a platform action, never through anything this
    // tab did, so a short cache is right — but not so long that an upgrade
    // leaves someone staring at the old limits.
    staleTime: 60_000,
  })
}

/**
 * Whether an organization may use a capability today.
 *
 * Defaults to FALSE while the query is loading or has failed. That is
 * deliberate and is the only safe default for a gate: a UI that renders the
 * paid affordance optimistically and withdraws it a moment later is worse than
 * one that appears a moment late, and an entitlement question that fails OPEN
 * on a network error is not a gate at all.
 */
export function hasCapability(
  entitlements: OrganizationEntitlements | null | undefined,
  capability: CapabilityId,
): boolean {
  return entitlements?.capabilities.includes(capability) ?? false
}

/**
 * Whether this organization can still add an establishment.
 *
 * The same arithmetic the database trigger performs, so the button and the
 * refusal agree. The database remains the authority — this only decides what
 * to render.
 */
export function canAddEstablishment(entitlements: OrganizationEntitlements | null | undefined): boolean {
  if (!entitlements) return false
  return entitlements.usedEstablishments < entitlements.maxEstablishments
}

/**
 * Whether this organization can still roster an operational professional.
 *
 * `null` max is unlimited — team is included — so this is true regardless of
 * how many people work there. There is no seat to buy and no count to bill.
 */
export function canAddProfessional(entitlements: OrganizationEntitlements | null | undefined): boolean {
  if (!entitlements) return false
  if (entitlements.maxOperationalProfessionals === null) return true
  return entitlements.usedOperationalProfessionals < entitlements.maxOperationalProfessionals
}
