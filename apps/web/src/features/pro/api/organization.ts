import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { entitlementKeys, organizationKeys } from '@/shared/data/keys'
import { useSession } from '@/shared/hooks/useSession'

/**
 * Contexte organisation du ProShell. La sélection mémorisée est une
 * PRÉFÉRENCE, jamais une autorité : elle n'est honorée que si elle apparaît
 * dans les memberships RLS-scopés (même règle que le mécanisme legacy
 * éprouvé). L'autorisation réelle reste en base.
 */

const STORAGE_KEY = 'fadeup.currentOrganizationId'

function storedOrganizationId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export interface ProOrganization {
  organizationId: string
  name: string
  businessType: string
  locations: Array<{ id: string; name: string }>
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
}

export function useProOrganization() {
  const { session } = useSession()

  const query = useQuery({
    queryKey: [...organizationKeys.all, 'pro-context'],
    queryFn: async (): Promise<ProOrganization | null> => {
      const supabase = getSupabase()
      const { data: memberships, error } = await supabase
        .from('memberships')
        .select('organization_id, organizations(id, name, business_type)')
      if (error) throw error
      if (!memberships || memberships.length === 0) return null

      const preferred = storedOrganizationId()
      const membership = memberships.find((m) => m.organization_id === preferred) ?? memberships[0]
      if (!membership?.organizations) return null

      const { data: locations, error: locationsError } = await supabase
        .from('locations')
        .select('id, name')
        .eq('organization_id', membership.organization_id)
      if (locationsError) throw locationsError

      return {
        organizationId: membership.organization_id,
        name: membership.organizations.name,
        // Jamais null en pratique (colonne contrainte) ; le repli le plus
        // conservateur masque les entrées d'équipe plutôt que de les montrer.
        businessType: membership.organizations.business_type ?? 'solo_professional',
        locations: (locations ?? []).map((location) => ({ id: location.id, name: location.name })),
      }
    },
    enabled: Boolean(session),
    staleTime: 60_000,
  })

  return { organization: query.data ?? null, loading: query.isPending && Boolean(session), error: query.error }
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
      }
    },
    enabled: Boolean(organizationId),
    staleTime: 60_000,
  })

  return { entitlements: query.data ?? null, loading: query.isPending && Boolean(organizationId) }
}
