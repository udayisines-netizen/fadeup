import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * The org-scoped, teammate-visible staff record — this is what finally
 * makes real display names show up on a roster (unlike `public.profiles`,
 * which only the owning user can read; see lib/queries/profile.ts). One row
 * per (organization, user), auto-created by a DB trigger on membership
 * creation — never insert this table from the client, only update it.
 */
export interface StaffProfile {
  id: string
  organizationId: string
  userId: string
  locationId: string | null
  displayName: string
  title: string | null
  bio: string | null
  avatarUrl: string | null
  isPublic: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface StaffProfileRow {
  id: string
  organization_id: string
  user_id: string
  location_id: string | null
  display_name: string
  title: string | null
  bio: string | null
  avatar_url: string | null
  is_public: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

function mapStaffProfile(row: StaffProfileRow): StaffProfile {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    locationId: row.location_id,
    displayName: row.display_name,
    title: row.title,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    isPublic: row.is_public,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** All staff profiles (one per member) for the given org — readable by any org member. */
export function useOrgStaffProfiles(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['staff-profiles', organizationId],
    queryFn: async (): Promise<StaffProfile[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('staff_profiles')
        .select(
          'id, organization_id, user_id, location_id, display_name, title, bio, avatar_url, is_public, is_active, created_at, updated_at',
        )
        .eq('organization_id', organizationId)
        .order('display_name', { ascending: true })

      if (error) throw error

      return ((data ?? []) as unknown as StaffProfileRow[]).map(mapStaffProfile)
    },
    enabled: Boolean(organizationId),
  })
}

export interface UpdateStaffProfileInput {
  id: string
  organizationId: string
  displayName: string
  title: string | null
  bio: string | null
  locationId: string | null
}

/** Update a teammate's profile fields. RLS restricts this to owner/manager. */
export function useUpdateStaffProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateStaffProfileInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase
        .from('staff_profiles')
        .update({
          display_name: input.displayName,
          title: input.title,
          bio: input.bio,
          location_id: input.locationId,
        })
        .eq('id', input.id)

      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['staff-profiles', variables.organizationId] })
    },
  })
}
