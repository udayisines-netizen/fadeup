import { useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import type { MembershipRole } from '@/lib/types'

export interface MembershipWithOrganization {
  id: string
  role: MembershipRole
  organizationId: string
  organizationName: string
  organizationSlug: string
}

interface OrganizationRef {
  id: string
  name: string
  slug: string
}

interface MembershipRow {
  id: string
  role: MembershipRole
  organization_id: string
  organizations: OrganizationRef | OrganizationRef[] | null
}

function firstOrganization(value: MembershipRow['organizations']): OrganizationRef | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

/** All of the current user's memberships, across every organization they belong to. */
export function useMyMemberships(userId: string | undefined) {
  return useQuery({
    queryKey: ['memberships', 'mine', userId],
    queryFn: async (): Promise<MembershipWithOrganization[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('memberships')
        .select('id, role, organization_id, organizations ( id, name, slug )')
        .order('created_at', { ascending: true })

      if (error) throw error

      return ((data ?? []) as unknown as MembershipRow[]).map((row) => {
        const org = firstOrganization(row.organizations)
        return {
          id: row.id,
          role: row.role,
          organizationId: row.organization_id,
          organizationName: org?.name ?? 'Unnamed organization',
          organizationSlug: org?.slug ?? '',
        }
      })
    },
    enabled: Boolean(userId),
  })
}

export interface OrgMember {
  membershipId: string
  userId: string
  role: MembershipRole
  createdAt: string
}

interface OrgMemberRow {
  id: string
  user_id: string
  role: MembershipRole
  created_at: string
}

/** All member rows (user_id + role) for a single organization. */
export function useOrgMembers(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['memberships', 'org', organizationId],
    queryFn: async (): Promise<OrgMember[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('memberships')
        .select('id, user_id, role, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: true })

      if (error) throw error

      return ((data ?? []) as OrgMemberRow[]).map((row) => ({
        membershipId: row.id,
        userId: row.user_id,
        role: row.role,
        createdAt: row.created_at,
      }))
    },
    enabled: Boolean(organizationId),
  })
}
