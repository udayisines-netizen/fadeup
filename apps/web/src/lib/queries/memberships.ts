import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import { getStoredOrganizationId, resolveActiveOrganizationId } from '@/lib/current-organization'
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

/**
 * The caller's memberships, plus which organization they are working in —
 * WITHOUT needing CurrentOrgProvider.
 *
 * That distinction is the whole point. CurrentOrgProvider is mounted by
 * AppLayout, so it only exists inside the finished professional workspace.
 * Routes that run BEFORE that workspace is reachable — the onboarding wizard,
 * and the guard that decides whether to send someone there — still need to
 * know which shop is being configured, and must not throw for asking.
 *
 * `preferredId` lets a caller pass an explicit choice (a validated `?org=`
 * parameter, say); it falls back to the stored preference. Neither is
 * authority: resolveActiveOrganizationId only honours an id that appears in
 * the membership list, which is the RLS-scoped answer from the database.
 */
export function useResolvedOrganization(userId: string | undefined, preferredId?: string | null) {
  const membershipsQuery = useMyMemberships(userId)
  const memberships = useMemo(() => membershipsQuery.data ?? [], [membershipsQuery.data])

  const organizationId = useMemo(
    () => resolveActiveOrganizationId(memberships, preferredId ?? getStoredOrganizationId()),
    [memberships, preferredId],
  )

  const membership = useMemo(
    () => memberships.find((candidate) => candidate.organizationId === organizationId) ?? null,
    [memberships, organizationId],
  )

  return { membershipsQuery, memberships, organizationId, membership }
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
