import { useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

interface ProfileRow {
  full_name: string | null
}

/**
 * The current user's own profile. Note: `public.profiles` RLS only allows a
 * user to read their own row — there is intentionally no cross-member
 * visibility of teammates' display names yet (see
 * db/migrations/20260809100200_profiles.sql). Team rosters can only show a
 * name for "you"; other members are identified by role + a short id until a
 * later lot adds org-scoped staff profile visibility.
 */
export function useOwnProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['profile', 'own', userId],
    queryFn: async (): Promise<string | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', userId)
        .maybeSingle()

      if (error) throw error
      return (data as ProfileRow | null)?.full_name ?? null
    },
    enabled: Boolean(userId),
  })
}
