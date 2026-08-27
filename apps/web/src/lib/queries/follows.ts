import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

export interface FollowedProfessional {
  id: string
  displayName: string
  handle: string | null
  headline: string | null
  avatarUrl: string | null
  followedAt: string
}

interface FollowedProfessionalRow {
  id: string
  display_name: string
  handle: string | null
  headline: string | null
  avatar_url: string | null
  followed_at: string
}

export const MY_FOLLOWED_PROFESSIONALS_KEY = ['my-followed-professionals'] as const

function mapFollowedProfessional(row: FollowedProfessionalRow): FollowedProfessional {
  return {
    id: row.id,
    displayName: row.display_name,
    handle: row.handle,
    headline: row.headline,
    avatarUrl: row.avatar_url,
    followedAt: row.followed_at,
  }
}

export function useMyFollowedProfessionals(enabled: boolean) {
  return useQuery({
    queryKey: MY_FOLLOWED_PROFESSIONALS_KEY,
    queryFn: async (): Promise<FollowedProfessional[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_my_followed_professionals')
      if (error) throw error
      return ((data ?? []) as FollowedProfessionalRow[]).map(mapFollowedProfessional)
    },
    enabled,
  })
}

export function useFollowProfessional() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (professionalId: string) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('follow_professional', {
        p_professional_id: professionalId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_FOLLOWED_PROFESSIONALS_KEY })
    },
  })
}

export function useUnfollowProfessional() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (professionalId: string) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('unfollow_professional', {
        p_professional_id: professionalId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_FOLLOWED_PROFESSIONALS_KEY })
    },
  })
}
