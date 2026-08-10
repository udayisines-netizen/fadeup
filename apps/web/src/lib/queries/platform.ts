import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import type { PlatformRole } from '@/lib/types'

interface PlatformMemberRow {
  role: PlatformRole
}

/**
 * The calling user's own platform role, or null if they aren't FadeUp
 * platform staff. RLS (platform_members_select_own) only ever returns the
 * caller's own row — there is no way to enumerate other platform members
 * through this query, matching public.profiles' self-only visibility.
 */
export function useOwnPlatformRole(userId: string | undefined) {
  return useQuery({
    queryKey: ['platform', 'own-role', userId],
    queryFn: async (): Promise<PlatformRole | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('platform_members')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle()

      if (error) throw error
      return (data as PlatformMemberRow | null)?.role ?? null
    },
    enabled: Boolean(userId),
  })
}

/**
 * Redeems a platform-owner bootstrap token for the calling authenticated
 * user (see db/migrations/20260810130000_platform_roles.sql,
 * claim_platform_owner_bootstrap). Fails if the token is invalid, expired,
 * already claimed, revoked, or a platform owner already exists.
 */
export function useClaimPlatformOwnerBootstrap() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (token: string) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('claim_platform_owner_bootstrap', { p_token: token })
      if (error) throw error
      return data as { user_id: string; role: PlatformRole }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'own-role'] })
    },
  })
}

/**
 * Redeems a platform_admin/platform_support invitation for the calling
 * authenticated user (accept_platform_invitation). Used by Phase D's
 * /platform team-invite UI, wired here now alongside the other platform
 * auth RPCs since they share the same security model.
 */
export function useAcceptPlatformInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (token: string) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('accept_platform_invitation', { p_token: token })
      if (error) throw error
      return data as { user_id: string; role: PlatformRole }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'own-role'] })
    },
  })
}
