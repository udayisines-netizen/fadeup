import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import { generateInvitationToken } from '@/lib/invitation-token'
import type { MembershipRole } from '@/lib/types'

export interface InvitationPreview {
  organizationName: string
  role: MembershipRole
  email: string
  locationName: string | null
  expiresAt: string
  isExpired: boolean
  isAccepted: boolean
  isRevoked: boolean
}

interface InvitationPreviewRow {
  organization_name: string
  role: MembershipRole
  email: string
  location_name: string | null
  expires_at: string
  is_expired: boolean
  is_accepted: boolean
  is_revoked: boolean
}

/** Public lookup (works for signed-out visitors) of an invitation by its token. */
export function useInvitationByToken(token: string | undefined) {
  return useQuery({
    queryKey: ['invitation', token],
    queryFn: async (): Promise<InvitationPreview | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_invitation_by_token', { p_token: token })

      if (error) throw error

      const rows = (data ?? []) as InvitationPreviewRow[]
      const row = rows[0]
      if (!row) return null

      return {
        organizationName: row.organization_name,
        role: row.role,
        email: row.email,
        locationName: row.location_name,
        expiresAt: row.expires_at,
        isExpired: row.is_expired,
        isAccepted: row.is_accepted,
        isRevoked: row.is_revoked,
      }
    },
    enabled: Boolean(token),
    retry: false,
  })
}

interface AcceptInvitationResult {
  organizationId: string
}

interface MembershipRow {
  organization_id: string
}

export function useAcceptInvitation(token: string | undefined): UseMutationResult<AcceptInvitationResult> {
  return useMutation({
    mutationFn: async (): Promise<AcceptInvitationResult> => {
      if (!token) throw new Error('Missing invitation token')
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('accept_invitation', { p_token: token })

      if (error) throw error

      const membership = data as MembershipRow
      return { organizationId: membership.organization_id }
    },
  })
}

export interface OrgInvitation {
  id: string
  email: string
  role: MembershipRole
  locationId: string | null
  expiresAt: string
  createdAt: string
}

interface OrgInvitationRow {
  id: string
  email: string
  role: MembershipRole
  location_id: string | null
  expires_at: string
  created_at: string
}

export function useOrgInvitations(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['invitations', organizationId],
    queryFn: async (): Promise<OrgInvitation[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('invitations')
        .select('id, email, role, location_id, expires_at, created_at')
        .eq('organization_id', organizationId)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .order('created_at', { ascending: false })

      if (error) throw error

      return ((data ?? []) as OrgInvitationRow[]).map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        locationId: row.location_id,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      }))
    },
    enabled: Boolean(organizationId),
  })
}

interface CreateInvitationInput {
  organizationId: string
  email: string
  role: MembershipRole
  invitedBy: string
  locationId: string | null
}

export function useCreateInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ organizationId, email, role, invitedBy, locationId }: CreateInvitationInput) => {
      const supabase = getSupabaseClient()
      const token = generateInvitationToken()

      const { error } = await supabase.from('invitations').insert({
        organization_id: organizationId,
        email,
        role,
        token,
        invited_by: invitedBy,
        location_id: locationId,
      })

      if (error) throw error

      return { token }
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['invitations', variables.organizationId] })
    },
  })
}

export function useRevokeInvitation(organizationId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (invitationId: string) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('revoke_invitation', { p_invitation_id: invitationId })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invitations', organizationId] })
    },
  })
}
