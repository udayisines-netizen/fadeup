import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import type { SupportedLocale } from '@/lib/locale'
import type { Theme } from '@/lib/theme'

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

export interface ProfilePreferences {
  locale: string | null
  theme: string | null
}

interface ProfilePreferencesRow {
  locale: string | null
  theme: string | null
}

/**
 * The current user's stored locale/theme preference — see
 * db/migrations/20260810120000_profile_locale_theme.sql. Both are nullable:
 * null means "never set", not "English" / "system" — callers distinguish
 * that from src/lib/locale.ts's/theme.tsx's own resolution chains.
 */
export function useOwnProfilePreferences(userId: string | undefined) {
  return useQuery({
    queryKey: ['profile', 'preferences', userId],
    queryFn: async (): Promise<ProfilePreferences> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('profiles')
        .select('locale, theme')
        .eq('id', userId)
        .maybeSingle()

      if (error) throw error
      const row = data as ProfilePreferencesRow | null
      return { locale: row?.locale ?? null, theme: row?.theme ?? null }
    },
    enabled: Boolean(userId),
  })
}

/** Persists a locale/theme choice to the user's profile so it follows them across devices. Best-effort — a failed write just means it stays local-only. */
export function useUpdateProfilePreferences(userId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { locale?: SupportedLocale; theme?: Theme }) => {
      if (!userId) return
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('profiles').update(input).eq('id', userId)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile', 'preferences', userId] })
    },
  })
}
