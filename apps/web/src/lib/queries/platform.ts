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

// --- Tenant explorer -----------------------------------------------------------

export interface PlatformOrganization {
  id: string
  name: string
  slug: string
  createdAt: string
}

interface OrganizationRow {
  id: string
  name: string
  slug: string
  created_at: string
}

function mapOrganization(row: OrganizationRow): PlatformOrganization {
  return { id: row.id, name: row.name, slug: row.slug, createdAt: row.created_at }
}

const ORGANIZATION_COLUMNS = 'id, name, slug, created_at'

/** Every organization on the platform — readable by platform_owner/platform_admin (private.is_platform_admin()), same RLS every org member already relies on for their own org. */
export function useAllOrganizations() {
  return useQuery({
    queryKey: ['platform', 'organizations'],
    queryFn: async (): Promise<PlatformOrganization[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('organizations')
        .select(ORGANIZATION_COLUMNS)
        .order('created_at', { ascending: false })

      if (error) throw error
      return ((data ?? []) as OrganizationRow[]).map(mapOrganization)
    },
  })
}

export function useOrganization(organizationId: string | undefined) {
  return useQuery({
    queryKey: ['platform', 'organization', organizationId],
    queryFn: async (): Promise<PlatformOrganization | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('organizations')
        .select(ORGANIZATION_COLUMNS)
        .eq('id', organizationId)
        .maybeSingle()

      if (error) throw error
      return data ? mapOrganization(data as OrganizationRow) : null
    },
    enabled: Boolean(organizationId),
  })
}

// --- Platform team ---------------------------------------------------------------

export interface PlatformMember {
  userId: string
  role: PlatformRole
  note: string | null
  createdAt: string
}

interface PlatformMemberFullRow {
  user_id: string
  role: PlatformRole
  note: string | null
  created_at: string
}

/** Full platform staff roster — platform_owner/platform_admin only (platform_members_select_admin policy). */
export function useAllPlatformMembers() {
  return useQuery({
    queryKey: ['platform', 'members'],
    queryFn: async (): Promise<PlatformMember[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('platform_members')
        .select('user_id, role, note, created_at')
        .order('created_at', { ascending: true })

      if (error) throw error
      return ((data ?? []) as PlatformMemberFullRow[]).map((row) => ({
        userId: row.user_id,
        role: row.role,
        note: row.note,
        createdAt: row.created_at,
      }))
    },
  })
}

export interface PlatformInvitation {
  id: string
  role: PlatformRole
  invitedEmail: string | null
  invitedBy: string
  expiresAt: string
  acceptedAt: string | null
  revokedAt: string | null
  createdAt: string
}

interface PlatformInvitationRow {
  id: string
  role: PlatformRole
  invited_email: string | null
  invited_by: string
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
  created_at: string
}

const PLATFORM_INVITATION_COLUMNS = 'id, role, invited_email, invited_by, expires_at, accepted_at, revoked_at, created_at'

/** Pending/accepted/revoked platform invitations — platform_owner/platform_admin only. Never selects token_hash. */
export function usePlatformInvitations() {
  return useQuery({
    queryKey: ['platform', 'invitations'],
    queryFn: async (): Promise<PlatformInvitation[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('platform_invitations')
        .select(PLATFORM_INVITATION_COLUMNS)
        .order('created_at', { ascending: false })

      if (error) throw error
      return ((data ?? []) as PlatformInvitationRow[]).map((row) => ({
        id: row.id,
        role: row.role,
        invitedEmail: row.invited_email,
        invitedBy: row.invited_by,
        expiresAt: row.expires_at,
        acceptedAt: row.accepted_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
      }))
    },
  })
}

/** Creates a platform_admin/platform_support invitation. Returns the raw token ONCE — see create_platform_invitation. */
export function useCreatePlatformInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { role: 'platform_admin' | 'platform_support'; invitedEmail: string | null }) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('create_platform_invitation', {
        p_role: input.role,
        p_invited_email: input.invitedEmail,
      })
      if (error) throw error
      const row = (Array.isArray(data) ? data[0] : data) as { id: string; raw_token: string; expires_at: string }
      return { id: row.id, rawToken: row.raw_token, expiresAt: row.expires_at }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'invitations'] })
    },
  })
}

export function useRevokePlatformInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (invitationId: string) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('revoke_platform_invitation', { p_id: invitationId })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'invitations'] })
    },
  })
}

// --- Audit log ---------------------------------------------------------------------

export interface PlatformAuditEntry {
  id: string
  actorUserId: string | null
  action: string
  targetType: string | null
  targetId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

interface PlatformAuditRow {
  id: string
  actor_user_id: string | null
  action: string
  target_type: string | null
  target_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

/** Platform-level audit trail — platform_owner/platform_admin only (platform_audit_log_select policy). Most recent first. */
export function usePlatformAuditLog() {
  return useQuery({
    queryKey: ['platform', 'audit-log'],
    queryFn: async (): Promise<PlatformAuditEntry[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('platform_audit_log')
        .select('id, actor_user_id, action, target_type, target_id, metadata, created_at')
        .order('created_at', { ascending: false })
        .limit(200)

      if (error) throw error
      return ((data ?? []) as PlatformAuditRow[]).map((row) => ({
        id: row.id,
        actorUserId: row.actor_user_id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        metadata: row.metadata,
        createdAt: row.created_at,
      }))
    },
  })
}

// --- Support-view sessions -----------------------------------------------------

export type SupportSessionTargetType = 'organization' | 'barber'

export interface PlatformSupportSession {
  id: string
  organizationId: string
  targetType: SupportSessionTargetType
  targetUserId: string | null
  reason: string | null
  startedAt: string
  endedAt: string | null
}

interface PlatformSupportSessionRow {
  id: string
  organization_id: string
  target_type: SupportSessionTargetType
  target_user_id: string | null
  reason: string | null
  started_at: string
  ended_at: string | null
}

function mapSupportSession(row: PlatformSupportSessionRow): PlatformSupportSession {
  return {
    id: row.id,
    organizationId: row.organization_id,
    targetType: row.target_type,
    targetUserId: row.target_user_id,
    reason: row.reason,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  }
}

const SUPPORT_SESSION_COLUMNS = 'id, organization_id, target_type, target_user_id, reason, started_at, ended_at'

/** The calling platform staffer's own currently-open support-view session, if any (platform_support_sessions_one_open_per_actor guarantees at most one). */
export function useMyActiveSupportSession(userId: string | undefined) {
  return useQuery({
    queryKey: ['platform', 'support-session', 'mine', userId],
    queryFn: async (): Promise<PlatformSupportSession | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('platform_support_sessions')
        .select(SUPPORT_SESSION_COLUMNS)
        .eq('platform_actor_id', userId)
        .is('ended_at', null)
        .maybeSingle()

      if (error) throw error
      return data ? mapSupportSession(data as PlatformSupportSessionRow) : null
    },
    enabled: Boolean(userId),
  })
}

export function useStartSupportSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { organizationId: string; targetType: SupportSessionTargetType; targetUserId?: string | null; reason?: string | null }) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('start_platform_support_session', {
        p_organization_id: input.organizationId,
        p_target_type: input.targetType,
        p_target_user_id: input.targetUserId ?? null,
        p_reason: input.reason ?? null,
      })
      if (error) throw error
      return mapSupportSession(data as PlatformSupportSessionRow)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'support-session'] })
    },
  })
}

export function useEndSupportSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('end_platform_support_session', { p_id: sessionId })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'support-session'] })
    },
  })
}
