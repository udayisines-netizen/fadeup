import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * Whether a shop has opted into appearing in public marketplace search.
 *
 * `organizations.marketplace_visible` defaults to false — being on FadeUp and
 * being listed publicly are deliberately separate decisions. Until this
 * existed there was no way to make that decision at all: the column could
 * only be flipped by hand in SQL, so a genuine shop could never show up in
 * search and the only visible results were seeded development rows.
 *
 * The RLS policy on `organizations` already restricts UPDATE to owners and
 * managers of that organization, so this is a plain PATCH — no RPC needed,
 * and no client-supplied organization_id is trusted beyond what RLS allows.
 */

export const organizationMarketplaceKey = (organizationId: string | undefined) =>
  ['organization-marketplace', organizationId] as const

export function useOrganizationMarketplaceVisibility(organizationId: string | undefined) {
  return useQuery({
    queryKey: organizationMarketplaceKey(organizationId),
    queryFn: async (): Promise<{ marketplaceVisible: boolean; slug: string; name: string } | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('organizations')
        .select('marketplace_visible, slug, name')
        .eq('id', organizationId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const row = data as { marketplace_visible: boolean; slug: string; name: string }
      return { marketplaceVisible: row.marketplace_visible, slug: row.slug, name: row.name }
    },
    enabled: Boolean(organizationId),
  })
}

export function useSetMarketplaceVisibility(organizationId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (marketplaceVisible: boolean) => {
      if (!organizationId) throw new Error('No organization selected')
      const supabase = getSupabaseClient()
      const { error } = await supabase
        .from('organizations')
        .update({ marketplace_visible: marketplaceVisible })
        .eq('id', organizationId)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: organizationMarketplaceKey(organizationId) })
    },
  })
}
