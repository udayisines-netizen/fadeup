import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { proKeys } from '@/shared/data/keys'
import type { ProMembershipRole } from '@/shared/data/organization'

/**
 * OS-2 — l'équipe : lectures et actions, toutes par RPC `security definer`
 * (owner/manager seulement, la base refuse le reste en 42501).
 *
 * Aucun second chemin d'envoi d'e-mail : `invite_team_member` crée la ligne
 * `invitations`, son trigger `notify_new_invitation` dépose le message dans
 * `email_outbox` (gabarit `team_invitation`) et le distributeur B2 l'expédie.
 * Le jeton naît en base et n'est JAMAIS rendu au navigateur.
 *
 * Les erreurs remontent BRUTES : la page les traduit (`teamErrorKey`), avec
 * les motifs nommés `fadeup_team_refusal=…`.
 */

export interface TeamMember {
  membership_id: string
  user_id: string
  role: ProMembershipRole
  can_view_revenue: boolean
  is_me: boolean
  staff_profile_id: string | null
  display_name: string
  title: string | null
  avatar_url: string | null
  location_id: string | null
  location_name: string | null
  is_active: boolean
  /** `null` = pas de fauteuil : ce membre n'est pas rattaché à un `barbers`. */
  barber_id: string | null
  is_bookable: boolean
  queue_enabled: boolean
  professional_id: string | null
  professional_handle: string | null
  /** Compté par la base (rendez-vous futurs pending/confirmed) — jamais estimé. */
  upcoming_appointments: number
  created_at: string
}

export interface TeamInvitation {
  id: string
  email: string
  role: ProMembershipRole
  location_id: string | null
  location_name: string | null
  invited_by: string | null
  invited_by_name: string | null
  expires_at: string
  is_expired: boolean
  created_at: string
}

export function useTeamMembers(organizationId: string | null) {
  return useQuery({
    queryKey: proKeys.teamMembers(organizationId ?? ''),
    queryFn: async (): Promise<TeamMember[]> => {
      const { data, error } = await getSupabase().rpc('list_team_members', {
        p_organization_id: organizationId ?? '',
      })
      if (error) throw error
      return (data ?? []).map((row) => ({
        membership_id: row.membership_id,
        user_id: row.user_id,
        role: row.role as ProMembershipRole,
        can_view_revenue: row.can_view_revenue === true,
        is_me: row.is_me === true,
        staff_profile_id: row.staff_profile_id ?? null,
        display_name: row.display_name,
        title: row.title ?? null,
        avatar_url: row.avatar_url ?? null,
        location_id: row.location_id ?? null,
        location_name: row.location_name ?? null,
        is_active: row.is_active === true,
        barber_id: row.barber_id ?? null,
        is_bookable: row.is_bookable === true,
        queue_enabled: row.queue_enabled === true,
        professional_id: row.professional_id ?? null,
        professional_handle: row.professional_handle ?? null,
        upcoming_appointments: row.upcoming_appointments ?? 0,
        created_at: row.created_at,
      }))
    },
    enabled: Boolean(organizationId),
    /* Une lecture refusée (42501) est une décision de la base, pas une
       panne : la réessayer trois fois ne la rendra pas permise. */
    retry: false,
    staleTime: 30_000,
  })
}

export function useTeamInvitations(organizationId: string | null) {
  return useQuery({
    queryKey: proKeys.teamInvitations(organizationId ?? ''),
    queryFn: async (): Promise<TeamInvitation[]> => {
      const { data, error } = await getSupabase().rpc('list_team_invitations', {
        p_organization_id: organizationId ?? '',
      })
      if (error) throw error
      return (data ?? []).map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role as ProMembershipRole,
        location_id: row.location_id ?? null,
        location_name: row.location_name ?? null,
        invited_by: row.invited_by ?? null,
        invited_by_name: row.invited_by_name ?? null,
        expires_at: row.expires_at,
        is_expired: row.is_expired === true,
        created_at: row.created_at,
      }))
    },
    enabled: Boolean(organizationId),
    retry: false,
    staleTime: 30_000,
  })
}

/**
 * Une action d'équipe touche l'accès ET le fauteuil : `proKeys.teams` (cet
 * écran) et `proKeys.barbers` (agenda, accueil, file) sont invalidées
 * ensemble. Invalidation de clés, jamais d'écriture directe de cache.
 */
function useInvalidateTeam(organizationId: string | null) {
  const queryClient = useQueryClient()
  return () => {
    if (!organizationId) return
    void queryClient.invalidateQueries({ queryKey: proKeys.teams(organizationId) })
    void queryClient.invalidateQueries({ queryKey: proKeys.barbers(organizationId) })
  }
}

export interface InviteInput {
  email: string
  role: ProMembershipRole
  locationId: string | null
}

export interface InviteResult {
  id: string
  email: string
  role: ProMembershipRole
  expires_at: string
  /** Vrai quand un renvoi a révoqué l'invitation précédente. */
  replaced_previous: boolean
}

export function useInviteTeamMember(organizationId: string | null) {
  const invalidate = useInvalidateTeam(organizationId)
  return useMutation({
    mutationFn: async (input: InviteInput): Promise<InviteResult | null> => {
      const { data, error } = await getSupabase().rpc('invite_team_member', {
        p_organization_id: organizationId ?? '',
        p_email: input.email,
        p_role: input.role,
        ...(input.locationId ? { p_location_id: input.locationId } : {}),
      })
      if (error) throw error
      const row = (data ?? [])[0]
      if (!row) return null
      return {
        id: row.id,
        email: row.email,
        role: row.role as ProMembershipRole,
        expires_at: row.expires_at,
        replaced_previous: row.replaced_previous === true,
      }
    },
    onSettled: invalidate,
  })
}

export function useRevokeInvitation(organizationId: string | null) {
  const invalidate = useInvalidateTeam(organizationId)
  return useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await getSupabase().rpc('revoke_invitation', {
        p_invitation_id: invitationId,
      })
      if (error) throw error
    },
    onSettled: invalidate,
  })
}

export function useSetTeamMemberRole(organizationId: string | null) {
  const invalidate = useInvalidateTeam(organizationId)
  return useMutation({
    mutationFn: async (input: { membershipId: string; role: ProMembershipRole }) => {
      const { error } = await getSupabase().rpc('set_team_member_role', {
        p_membership_id: input.membershipId,
        p_role: input.role,
      })
      if (error) throw error
    },
    onSettled: invalidate,
  })
}

export function useSetRevenueVisibility(organizationId: string | null) {
  const invalidate = useInvalidateTeam(organizationId)
  return useMutation({
    mutationFn: async (input: { membershipId: string; visible: boolean }) => {
      const { error } = await getSupabase().rpc('set_membership_revenue_visibility', {
        p_membership_id: input.membershipId,
        p_visible: input.visible,
      })
      if (error) throw error
    },
    onSettled: invalidate,
  })
}

export interface RemoveResult {
  removed_membership_id: string
  professional_id: string | null
  reassigned_appointments: number
  moved_queue_entries: number
  released_queue_entries: number
}

export function useRemoveTeamMember(organizationId: string | null) {
  const invalidate = useInvalidateTeam(organizationId)
  return useMutation({
    mutationFn: async (input: {
      membershipId: string
      reassignToBarberId: string | null
    }): Promise<RemoveResult | null> => {
      const { data, error } = await getSupabase().rpc('remove_team_member', {
        p_membership_id: input.membershipId,
        ...(input.reassignToBarberId ? { p_reassign_to_barber_id: input.reassignToBarberId } : {}),
      })
      if (error) throw error
      const row = (data ?? [])[0]
      if (!row) return null
      return {
        removed_membership_id: row.removed_membership_id,
        professional_id: row.professional_id ?? null,
        reassigned_appointments: row.reassigned_appointments ?? 0,
        moved_queue_entries: row.moved_queue_entries ?? 0,
        released_queue_entries: row.released_queue_entries ?? 0,
      }
    },
    onSettled: invalidate,
  })
}
