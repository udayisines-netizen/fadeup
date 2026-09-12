import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { entitlementKeys, organizationKeys } from '@/shared/data/keys'
import { useSession } from '@/shared/hooks/useSession'

/**
 * Contexte organisation des surfaces pro. La sélection mémorisée est une
 * PRÉFÉRENCE, jamais une autorité : elle n'est honorée que si elle apparaît
 * dans les memberships RLS-scopés (même règle que le mécanisme legacy
 * éprouvé). L'autorisation réelle reste en base.
 *
 * Vit dans shared/data (déplacé depuis features/pro en F1) : le ProShell,
 * pro-queue et pro-onboarding en dépendent, et `features/X` n'importe
 * jamais `features/Y` (P1 §17). `features/pro/api/organization.ts` ré-exporte.
 */

const STORAGE_KEY = 'fadeup.currentOrganizationId'

function storedOrganizationId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export type ProMembershipRole = 'owner' | 'manager' | 'receptionist' | 'barber'

export interface ProOrganization {
  organizationId: string
  name: string
  slug: string
  businessType: string
  /** Devise de l'organisation — les prix configurés s'affichent avec elle. */
  currency: string
  /**
   * P1PRO — le rôle CONDITIONNE la présentation (un barber salarié ne voit
   * pas le revenu du salon), il n'autorise rien : RLS et les RPC restent
   * l'autorité (§8 du contrat de design pro).
   */
  role: ProMembershipRole
  /** OS-1 — la ligne de membership du compte (cible de set_membership_revenue_visibility). */
  membershipId: string
  /**
   * OS-1 — `memberships.can_view_revenue` : le patron décide, barber par
   * barber. Défaut « ne voit pas ». N'a d'effet que pour le rôle barber.
   */
  canViewRevenue: boolean
  locations: Array<{ id: string; name: string; kind: 'physical_address' | 'service_area'; timezone: string }>
}

export interface ProEntitlements {
  planKey: string | null
  status: string | null
  /**
   * `live_capabilities` porte l'AUTORISATION réelle (capacités du plan
   * effectif dont le statut global est `live` — vérifié dans
   * `private.org_has_capability`). `packaged_capabilities` n'est que la
   * promesse commerciale et ne conditionne jamais l'interface.
   */
  liveCapabilities: string[]
  packagedCapabilities: string[]
  /**
   * OS-3 — la CAPACITÉ du plan effectif, telle que la RPC la rend déjà (R2).
   * Lue par l'écran d'abonnement : le palier multi-établissements se choisit
   * en fonction du nombre d'établissements ACTIFS, et ce nombre est serveur
   * (`private.org_active_establishments`) — jamais compté à l'écran.
   * `maxOperationalProfessionals` à `null` = illimité, convention R2.
   */
  maxEstablishments: number | null
  usedEstablishments: number
  maxOperationalProfessionals: number | null
  usedOperationalProfessionals: number
}

export function useProOrganization() {
  const { session } = useSession()

  const query = useQuery({
    // Le compte fait partie de la clé : deux sessions successives dans le
    // même onglet ne partagent pas leur contexte.
    queryKey: [...organizationKeys.all, 'pro-context', session?.user.id ?? ''],
    queryFn: async (): Promise<ProOrganization | null> => {
      const supabase = getSupabase()
      // MES memberships seulement : la RLS rend visibles ceux de toute
      // l'équipe (écran Équipe), et la première ligne serait parfois celle
      // d'un AUTRE membre — un barber héritait du rôle de son owner (bogue
      // attrapé par l'e2e P1PRO). L'autorisation reste en base.
      const { data: memberships, error } = await supabase
        .from('memberships')
        .select('id, organization_id, role, can_view_revenue, organizations(id, name, slug, business_type, currency)')
        .eq('user_id', session?.user.id ?? '')
      if (error) throw error
      if (!memberships || memberships.length === 0) return null

      const preferred = storedOrganizationId()
      const membership = memberships.find((m) => m.organization_id === preferred) ?? memberships[0]
      if (!membership?.organizations) return null

      const { data: locations, error: locationsError } = await supabase
        .from('locations')
        .select('id, name, kind, timezone')
        .eq('organization_id', membership.organization_id)
      if (locationsError) throw locationsError

      return {
        organizationId: membership.organization_id,
        name: membership.organizations.name,
        slug: membership.organizations.slug,
        // Jamais null en pratique (colonne contrainte) ; le repli le plus
        // conservateur masque les entrées d'équipe plutôt que de les montrer.
        businessType: membership.organizations.business_type ?? 'solo_professional',
        currency: membership.organizations.currency ?? 'EUR',
        // Repli conservateur : « barber » est le rôle qui voit le MOINS.
        role: (membership.role ?? 'barber') as ProMembershipRole,
        membershipId: membership.id,
        canViewRevenue: membership.can_view_revenue === true,
        locations: (locations ?? []).map((location) => ({
          id: location.id,
          name: location.name,
          kind: location.kind,
          timezone: location.timezone,
        })),
      }
    },
    enabled: Boolean(session),
    staleTime: 60_000,
  })

  return { organization: query.data ?? null, loading: query.isPending && Boolean(session), error: query.error }
}

/**
 * P1PRO — le SEUL endroit du produit qui compare l'enum interne
 * `business_type` (jamais affiché, jamais dans une feature — garde
 * marketplace-supply.test) : une organisation solo ne rend aucune entrée
 * d'équipe.
 */
export function isSoloOrganization(organization: ProOrganization | null): boolean {
  return (organization?.businessType ?? 'solo_professional') === 'solo_professional'
}

export function useProEntitlements(organizationId: string | null) {
  const query = useQuery({
    queryKey: organizationId ? entitlementKeys.organization(organizationId) : entitlementKeys.all,
    queryFn: async (): Promise<ProEntitlements | null> => {
      if (!organizationId) return null
      const { data, error } = await getSupabase().rpc('get_organization_entitlements', {
        p_organization_id: organizationId,
      })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      if (!row) return null
      return {
        planKey: row.effective_plan_key ?? row.plan_key,
        status: row.status,
        liveCapabilities: row.live_capabilities ?? [],
        packagedCapabilities: row.packaged_capabilities ?? [],
        maxEstablishments: row.max_establishments ?? null,
        usedEstablishments: row.used_establishments ?? 0,
        maxOperationalProfessionals: row.max_operational_professionals ?? null,
        usedOperationalProfessionals: row.used_operational_professionals ?? 0,
      }
    },
    enabled: Boolean(organizationId),
    staleTime: 60_000,
  })

  return { entitlements: query.data ?? null, loading: query.isPending && Boolean(organizationId), error: query.error }
}
