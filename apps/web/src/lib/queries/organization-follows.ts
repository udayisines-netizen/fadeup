import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

export const MY_FOLLOWED_ORGANIZATIONS_KEY =
  ['customer', 'followed-organizations'] as const

interface FollowedOrganizationRow {
  organization_id: string
  followed_at: string | null
}

export interface FollowedOrganization {
  organizationId: string
  followedAt: string | null
  [key: string]: unknown
}

export function useMyFollowedOrganizations(enabled = true) {
  return useQuery({
    queryKey: MY_FOLLOWED_ORGANIZATIONS_KEY,
    enabled,
    queryFn: async (): Promise<FollowedOrganization[]> => {
      const supabase = getSupabaseClient()

      const { data, error } = await supabase.rpc(
        'list_my_followed_organizations',
      )

      if (error) throw error

      return ((data ?? []) as FollowedOrganizationRow[]).map((row) => ({
        organizationId: row.organization_id,
        followedAt: row.followed_at,
      }))
    },
  })
}

type OrganizationMutationInput =
  | string
  | { organizationId: string }

function resolveOrganizationId(
  value: OrganizationMutationInput,
): string {
  return typeof value === 'string'
    ? value
    : value.organizationId
}

export function useFollowOrganization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: OrganizationMutationInput) => {
      const organizationId = resolveOrganizationId(input)
      const supabase = getSupabaseClient()

      const { error } = await supabase.rpc('follow_organization', {
        p_organization_id: organizationId,
      })

      if (error) throw error
    },

    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: MY_FOLLOWED_ORGANIZATIONS_KEY,
      })
    },
  })
}

export function useUnfollowOrganization() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: OrganizationMutationInput) => {
      const organizationId = resolveOrganizationId(input)
      const supabase = getSupabaseClient()

      const { error } = await supabase.rpc('unfollow_organization', {
        p_organization_id: organizationId,
      })

      if (error) throw error
    },

    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: MY_FOLLOWED_ORGANIZATIONS_KEY,
      })
    },
  })
}
