import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * PLAT-2 — LA couche de données des quatre écrans par rôle et des affiches QR.
 *
 * Elle est séparée de `platform.ts` (le socle PLAT-1 : rôles, zones, audit,
 * vue en tant que) parce que les deux lots vivent et se relisent séparément,
 * pas parce que l'architecture change : mêmes conventions, même client, mêmes
 * clés de cache préfixées `platform`.
 *
 * CE QUI SE JOUE ICI EST DU CONDITIONNEMENT, PAS DE L'AUTORISATION. Chaque
 * RPC appelée ci-dessous repose la question côté serveur ; si l'interface se
 * trompe, le serveur refuse. C'est prouvé par `db/tests/verify_plat2.sql`,
 * 135 assertions qui appellent les RPC directement.
 */

// ============================================================================
// Support — la file de tickets
// ============================================================================

export type SupportTicketOrigin = 'phone' | 'gdpr_withdrawal' | 'report' | 'inbound_email'
export type SupportTicketStatus = 'open' | 'waiting' | 'resolved'
export type SupportTicketMessageKind = 'note' | 'inbound' | 'outbound' | 'status_change' | 'assignment' | 'action'

/** Les deux origines réellement branchées. Les deux autres refusent côté serveur. */
export const WIRED_TICKET_ORIGINS: SupportTicketOrigin[] = ['phone', 'gdpr_withdrawal']

export interface SupportTicketRow {
  id: string
  reference: string
  origin: SupportTicketOrigin
  subject: string
  status: SupportTicketStatus
  assigned_to: string | null
  assigned_to_email: string | null
  due_at: string | null
  hours_remaining: number | null
  is_overdue: boolean
  organization_id: string | null
  organization_name: string | null
  professional_id: string | null
  professional_display_name: string | null
  withdrawal_request_id: string | null
  message_count: number
  created_at: string
  updated_at: string
}

export function useSupportTickets(options: { includeResolved?: boolean; mineOnly?: boolean } = {}) {
  const includeResolved = options.includeResolved ?? false
  const mineOnly = options.mineOnly ?? false
  return useQuery({
    queryKey: ['platform', 'support-tickets', includeResolved, mineOnly],
    queryFn: async (): Promise<SupportTicketRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_support_tickets', {
        p_include_resolved: includeResolved,
        p_assigned_to_me: mineOnly,
      })
      if (error) throw error
      return (data ?? []) as SupportTicketRow[]
    },
  })
}

export interface SupportTicketMessage {
  id: string
  kind: SupportTicketMessageKind
  body: string
  author_email: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface SupportTicketDetail {
  ticket: SupportTicketRow & {
    body: string | null
    opened_by_email: string | null
    organization_slug: string | null
    professional_handle: string | null
    subject_user_id: string | null
    subject_user_email: string | null
    appointment_id: string | null
    queue_entry_id: string | null
    resolution: string | null
    resolved_at: string | null
  }
  messages: SupportTicketMessage[]
}

/**
 * OUVRIR UN TICKET, C'EST CONSULTER UN DOSSIER — la RPC écrit au journal à
 * chaque appel. D'où `staleTime` généreux et aucun refetch au focus : un
 * onglet laissé ouvert ne doit pas écrire une ligne d'audit par minute.
 */
export function useSupportTicket(ticketId: string | undefined) {
  return useQuery({
    queryKey: ['platform', 'support-ticket', ticketId],
    enabled: Boolean(ticketId),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<SupportTicketDetail> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_support_ticket', { p_ticket_id: ticketId })
      if (error) throw error
      return data as unknown as SupportTicketDetail
    },
  })
}

function useInvalidateTickets() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['platform', 'support-tickets'] })
    void queryClient.invalidateQueries({ queryKey: ['platform', 'support-ticket'] })
  }
}

export interface OpenTicketInput {
  origin: SupportTicketOrigin
  subject: string
  body?: string | null
  subjectUserId?: string | null
  organizationId?: string | null
  professionalId?: string | null
  appointmentId?: string | null
  queueEntryId?: string | null
  withdrawalRequestId?: string | null
}

export function useOpenSupportTicket() {
  const invalidate = useInvalidateTickets()
  return useMutation({
    mutationFn: async (input: OpenTicketInput) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('open_support_ticket', {
        p_origin: input.origin,
        p_subject: input.subject,
        p_body: input.body ?? null,
        p_subject_user_id: input.subjectUserId ?? null,
        p_organization_id: input.organizationId ?? null,
        p_professional_id: input.professionalId ?? null,
        p_appointment_id: input.appointmentId ?? null,
        p_queue_entry_id: input.queueEntryId ?? null,
        p_withdrawal_request_id: input.withdrawalRequestId ?? null,
      })
      if (error) throw error
      return data as unknown as SupportTicketRow
    },
    onSuccess: invalidate,
  })
}

export function useAddSupportTicketMessage() {
  const invalidate = useInvalidateTickets()
  return useMutation({
    mutationFn: async (input: { ticketId: string; body: string; kind?: 'note' | 'inbound' | 'outbound' }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('add_support_ticket_message', {
        p_ticket_id: input.ticketId,
        p_body: input.body,
        p_kind: input.kind ?? 'note',
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useAssignSupportTicket() {
  const invalidate = useInvalidateTickets()
  return useMutation({
    mutationFn: async (input: { ticketId: string; assignee: string | null }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('assign_support_ticket', {
        p_ticket_id: input.ticketId,
        p_assignee: input.assignee,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useSetSupportTicketStatus() {
  const invalidate = useInvalidateTickets()
  return useMutation({
    mutationFn: async (input: { ticketId: string; status: SupportTicketStatus; resolution?: string | null }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('set_support_ticket_status', {
        p_ticket_id: input.ticketId,
        p_status: input.status,
        p_resolution: input.resolution ?? null,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

// ============================================================================
// Support — les retraits RGPD et leur échéance de 72 heures
// ============================================================================

export interface WithdrawalRequestRow {
  id: string
  professional_id: string
  professional_display_name: string | null
  professional_handle: string | null
  is_still_public: boolean
  requested_via: string
  requested_at: string
  deadline_at: string
  hours_remaining: number
  is_overdue: boolean
  status: 'pending' | 'completed' | 'rejected'
  decided_at: string | null
}

/**
 * La file des retraits, avec `hours_remaining` et `is_overdue` CALCULÉS PAR LA
 * BASE (B2). Le commentaire de la fonction dit lui-même que « c'est la colonne
 * sur laquelle un écran /platform doit alerter » — PLAT-1 §15.7 constatait que
 * cet écran n'existait pas. Il existe maintenant.
 */
export function useMarketplaceWithdrawals(includeCompleted = false) {
  return useQuery({
    queryKey: ['platform', 'withdrawals', includeCompleted],
    queryFn: async (): Promise<WithdrawalRequestRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_marketplace_withdrawal_requests', {
        p_include_completed: includeCompleted,
      })
      if (error) throw error
      return (data ?? []) as WithdrawalRequestRow[]
    },
    // L'échéance défile : une minute suffit pour que le compte à rebours reste
    // honnête sans marteler la base.
    refetchInterval: 60_000,
  })
}

export function useCompleteWithdrawal() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { requestId: string; note?: string | null }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('complete_marketplace_withdrawal', {
        p_request_id: input.requestId,
        p_decision_note: input.note ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'withdrawals'] })
      void queryClient.invalidateQueries({ queryKey: ['platform', 'support-tickets'] })
    },
  })
}

// ============================================================================
// Support — les dossiers (chaque consultation est tracée côté serveur)
// ============================================================================

export type DossierKind = 'customer' | 'professional' | 'organization'

/**
 * Le NOM de la RPC et de son argument, pas un libellé : rien ici n'est
 * affiché. Écrit en fonction plutôt qu'en table pour que la garde
 * `no-untranslated-status-maps` ne le confonde pas avec une table de
 * traduction oubliée — elle ne peut pas distinguer les deux formes.
 */
function dossierCall(kind: DossierKind): { rpc: string; arg: string } {
  if (kind === 'customer') return { rpc: 'get_platform_customer_dossier', arg: 'p_user_id' }
  if (kind === 'professional') return { rpc: 'get_platform_professional_dossier', arg: 'p_professional_id' }
  return { rpc: 'get_platform_organization_dossier', arg: 'p_organization_id' }
}

/**
 * Un dossier ÉCRIT une ligne d'audit à chaque appel. Il n'est donc jamais
 * rafraîchi tout seul : pas de refetch au focus, pas d'intervalle, cache long.
 * Une consultation dans le journal doit correspondre à un humain qui a
 * regardé, pas à un onglet resté ouvert.
 */
export function usePlatformDossier(kind: DossierKind, id: string | undefined | null) {
  return useQuery({
    queryKey: ['platform', 'dossier', kind, id],
    enabled: Boolean(id),
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: false,
    queryFn: async (): Promise<Record<string, unknown>> => {
      const supabase = getSupabaseClient()
      const call = dossierCall(kind)
      const { data, error } = await supabase.rpc(call.rpc, { [call.arg]: id })
      if (error) throw error
      return (data ?? {}) as Record<string, unknown>
    },
  })
}

// ============================================================================
// Support — les deux actions de premier niveau
// ============================================================================

export function useCancelAppointmentAsPlatform() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { appointmentId: string; reason: string }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('cancel_appointment_as_platform', {
        p_appointment_id: input.appointmentId,
        p_reason: input.reason,
      })
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform', 'dossier'] }),
  })
}

export function useRemoveQueueEntryAsPlatform() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { entryId: string; reason: string }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('remove_queue_entry_as_platform', {
        p_entry_id: input.entryId,
        p_reason: input.reason,
      })
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform', 'dossier'] }),
  })
}

export function useResendPlatformEmail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { emailId: string; reason: string }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('resend_platform_email', {
        p_email_id: input.emailId,
        p_reason: input.reason,
      })
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform', 'dossier'] }),
  })
}

// ============================================================================
// Modération
// ============================================================================

/** Le vocabulaire FERMÉ des motifs. « La note est mauvaise » n'y est pas. */
export const MODERATION_REASONS = [
  'fraud',
  'abusive_content',
  'personal_data',
  'hate_speech',
  'conflict_of_interest',
] as const
export type ModerationReason = (typeof MODERATION_REASONS)[number]

export interface ModerationReviewRow {
  id: string
  rating: number
  comment: string | null
  reviewer_display_name: string
  status: 'published' | 'under_review' | 'removed'
  moderation_reason: string | null
  moderated_at: string | null
  moderated_by_email: string | null
  professional_id: string
  professional_display_name: string
  professional_handle: string | null
  organization_id: string
  organization_name: string
  open_report_count: number
  created_at: string
}

export function useModerationReviews(status?: string) {
  return useQuery({
    queryKey: ['platform', 'moderation', 'reviews', status ?? 'all'],
    queryFn: async (): Promise<ModerationReviewRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_moderation_reviews', {
        p_status: status ?? null,
        p_limit: 100,
      })
      if (error) throw error
      return (data ?? []) as ModerationReviewRow[]
    },
  })
}

export interface ModerationPostRow {
  id: string
  author_kind: 'professional' | 'organization'
  author_label: string | null
  author_handle: string | null
  caption: string | null
  visibility: 'public' | 'followers' | 'hidden'
  hidden_at: string | null
  hidden_by_email: string | null
  hidden_reason: string | null
  media_count: number
  like_count: number
  created_at: string
}

export function useModerationPosts(visibility?: string) {
  return useQuery({
    queryKey: ['platform', 'moderation', 'posts', visibility ?? 'all'],
    queryFn: async (): Promise<ModerationPostRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_moderation_posts', {
        p_visibility: visibility ?? null,
        p_limit: 100,
      })
      if (error) throw error
      return (data ?? []) as ModerationPostRow[]
    },
  })
}

export interface ModerationReportRow {
  id: string
  review_id: string
  reason: string
  detail: string | null
  status: 'open' | 'reviewed' | 'dismissed' | 'actioned'
  created_at: string
  resolved_at: string | null
  resolved_by_email: string | null
  review_rating: number
  review_comment: string | null
  review_status: string
  professional_display_name: string
  organization_name: string
}

export function useModerationReports(includeResolved = false) {
  return useQuery({
    queryKey: ['platform', 'moderation', 'reports', includeResolved],
    queryFn: async (): Promise<ModerationReportRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_moderation_review_reports', {
        p_include_resolved: includeResolved,
        p_limit: 100,
      })
      if (error) throw error
      return (data ?? []) as ModerationReportRow[]
    },
  })
}

function useInvalidateModeration() {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey: ['platform', 'moderation'] })
}

export function useModerateReview() {
  const invalidate = useInvalidateModeration()
  return useMutation({
    mutationFn: async (input: { reviewId: string; status: 'published' | 'under_review' | 'removed'; reason?: ModerationReason | null }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('moderate_review', {
        p_review_id: input.reviewId,
        p_status: input.status,
        p_reason: input.reason ?? null,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useModeratePost() {
  const invalidate = useInvalidateModeration()
  return useMutation({
    mutationFn: async (input: { postId: string; visibility: 'public' | 'followers' | 'hidden'; reason?: ModerationReason | null }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('moderate_post', {
        p_post_id: input.postId,
        p_visibility: input.visibility,
        p_reason: input.reason ?? null,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useResolveReviewReport() {
  const invalidate = useInvalidateModeration()
  return useMutation({
    mutationFn: async (input: { reportId: string; status: 'reviewed' | 'dismissed' | 'actioned' }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('resolve_review_report', {
        p_report_id: input.reportId,
        p_status: input.status,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

// ============================================================================
// Onboardings et revendications — les deux files partagées
// ============================================================================

export interface ApplicationQueueRow {
  id: string
  status: 'pending_review' | 'approved' | 'rejected'
  first_name: string
  last_name: string
  email: string
  phone: string | null
  business_name: string
  professional_type: string
  city: string | null
  postal_code: string | null
  country: string | null
  staff_count: number | null
  website: string | null
  instagram: string | null
  business_identifier: string | null
  submitted_at: string
  reviewed_at: string | null
  reviewed_by_email: string | null
  rejection_reason: string | null
  internal_note: string | null
  organization_id: string | null
}

export function useApplicationQueue(status?: 'pending_review' | 'approved' | 'rejected') {
  return useQuery({
    queryKey: ['platform', 'onboarding', 'applications', status ?? 'all'],
    queryFn: async (): Promise<ApplicationQueueRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_professional_applications_queue', {
        p_status: status ?? null,
        p_limit: 100,
      })
      if (error) throw error
      return (data ?? []) as ApplicationQueueRow[]
    },
  })
}

export function useReviewApplication() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { applicationId: string; decision: 'approve' | 'reject'; rejectionReason?: string | null; internalNote?: string | null }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('review_professional_application', {
        p_application_id: input.applicationId,
        p_decision: input.decision,
        p_rejection_reason: input.rejectionReason ?? null,
        p_internal_note: input.internalNote ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform', 'onboarding'] }),
  })
}

export interface ClaimQueueRow {
  id: string
  professional_id: string
  professional_display_name: string
  professional_handle: string | null
  professional_claim_state: 'unclaimed' | 'claimed'
  claimant_user_id: string
  claimant_email: string | null
  state: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  evidence: string | null
  submitted_at: string
  decided_at: string | null
  decided_by_email: string | null
  decision_note: string | null
  /** Le nombre d'AUTRES demandes vivantes sur le même profil : l'arbitrage. */
  competing_pending: number
}

export function useClaimQueue(includeDecided = false) {
  return useQuery({
    queryKey: ['platform', 'onboarding', 'claims', includeDecided],
    queryFn: async (): Promise<ClaimQueueRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_professional_claims_queue', {
        p_include_decided: includeDecided,
        p_limit: 100,
      })
      if (error) throw error
      return (data ?? []) as ClaimQueueRow[]
    },
  })
}

export function useReviewClaim() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { claimId: string; decision: 'approve' | 'reject'; note?: string | null }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('review_professional_claim', {
        p_claim_id: input.claimId,
        p_decision: input.decision,
        p_note: input.note ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform', 'onboarding'] }),
  })
}

// ============================================================================
// Commercial — pipeline, statistiques réelles, état des relances
// ============================================================================

export interface PipelineRow {
  status: string
  origin: 'worker' | 'field'
  prospect_count: number
  published_count: number
  contacted_count: number
}

export function useSalesPipeline() {
  return useQuery({
    queryKey: ['platform', 'sales', 'pipeline'],
    queryFn: async (): Promise<PipelineRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_sales_pipeline_summary')
      if (error) throw error
      return (data ?? []) as PipelineRow[]
    },
  })
}

export interface ProspectStats {
  prospect_id: string
  window_days: number
  since: string
  /** Le drapeau qui EXPLIQUE les zéros : une fiche non publiée n'a pas de vues. */
  is_published: boolean
  professional_id: string | null
  claim_state: 'unclaimed' | 'claimed' | null
  profile_views: number
  profile_views_all_time: number
  last_profile_view_at: string | null
  booking_started: number
  interest_requests: number
  interest_requests_pending: number
  followers: number
  search_result_views: number
}

export function useProspectStats(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['platform', 'sales', 'prospect-stats', prospectId],
    enabled: Boolean(prospectId),
    queryFn: async (): Promise<ProspectStats> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_prospect_acquisition_stats', {
        p_prospect_id: prospectId,
        p_days: 90,
      })
      if (error) throw error
      return data as unknown as ProspectStats
    },
  })
}

export interface OutreachTouch {
  touch: string
  template: string
  status: string
  created_at: string
  sent_at: string | null
  delivered_at: string | null
  opened_at: string | null
  bounced_at: string | null
}

export interface OutreachState {
  prospect_id: string
  do_not_contact: boolean
  has_email: boolean
  suppressed: boolean
  /** Le motif calculé par B2 lui-même — pas une seconde implémentation. */
  block_reason: string | null
  requests: {
    request_id: string
    status: string
    service_label: string
    preferred_starts_at: string
    expires_at: string
    touches_sent: number
    touches: OutreachTouch[]
  }[]
  logged_contacts: {
    id: string
    channel: string
    direction: string
    summary: string | null
    occurred_at: string
  }[]
}

export function useProspectOutreachState(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['platform', 'sales', 'prospect-outreach', prospectId],
    enabled: Boolean(prospectId),
    queryFn: async (): Promise<OutreachState> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_prospect_outreach_state', { p_prospect_id: prospectId })
      if (error) throw error
      return data as unknown as OutreachState
    },
  })
}

// ============================================================================
// Prospects — la liste que partagent le commercial et le stagiaire
// ============================================================================

export interface ProspectListRow {
  id: string
  canonical_name: string
  type: string
  status: string
  origin: 'worker' | 'field'
  country: string
  phone_e164: string | null
  email: string | null
  do_not_contact: boolean
  field_observation: string | null
  field_captured_at: string | null
  current_score: number | null
  city: string | null
  postal_code: string | null
  address_line: string | null
  latitude: number | null
  longitude: number | null
}

interface ProspectJoinRow {
  id: string
  canonical_name: string
  type: string
  status: string
  origin: 'worker' | 'field'
  country: string
  phone_e164: string | null
  email: string | null
  do_not_contact: boolean
  field_observation: string | null
  field_captured_at: string | null
  current_score: number | null
  prospect_locations: {
    is_primary: boolean
    city: string | null
    postal_code: string | null
    address_line: string | null
    latitude: number | null
    longitude: number | null
  }[]
}

/**
 * LA MÊME REQUÊTE POUR LE COMMERCIAL ET POUR LE STAGIAIRE, et c'est voulu :
 * ce qui les distingue n'est pas le code de l'écran mais
 * `private.platform_prospect_visible()`, posée par les policies de PLAT-1. Le
 * stagiaire reçoit ses zones et ses propres saisies ; le commercial, tout.
 * Un filtre côté client aurait été une garde d'interface, c'est-à-dire rien.
 */
export function useProspects(options: { search?: string; origin?: 'worker' | 'field'; status?: string; limit?: number } = {}) {
  const search = options.search?.trim() ?? ''
  const origin = options.origin ?? null
  const status = options.status ?? null
  const limit = options.limit ?? 200
  return useQuery({
    queryKey: ['platform', 'prospects', search, origin, status, limit],
    queryFn: async (): Promise<ProspectListRow[]> => {
      const supabase = getSupabaseClient()
      let query = supabase
        .from('prospects')
        .select(
          'id, canonical_name, type, status, origin, country, phone_e164, email, do_not_contact, field_observation, field_captured_at, current_score, prospect_locations(is_primary, city, postal_code, address_line, latitude, longitude)',
        )
        .order('canonical_name')
        .limit(limit)
      if (search) query = query.ilike('canonical_name', `%${search.replace(/[%,()]/g, ' ')}%`)
      if (origin) query = query.eq('origin', origin)
      if (status) query = query.eq('status', status)
      const { data, error } = await query
      if (error) throw error
      return ((data ?? []) as ProspectJoinRow[]).map((row) => {
        const place = row.prospect_locations.find((l) => l.is_primary) ?? row.prospect_locations[0] ?? null
        return {
          id: row.id,
          canonical_name: row.canonical_name,
          type: row.type,
          status: row.status,
          origin: row.origin,
          country: row.country,
          phone_e164: row.phone_e164,
          email: row.email,
          do_not_contact: row.do_not_contact,
          field_observation: row.field_observation,
          field_captured_at: row.field_captured_at,
          current_score: row.current_score,
          city: place?.city ?? null,
          postal_code: place?.postal_code ?? null,
          address_line: place?.address_line ?? null,
          latitude: place?.latitude ?? null,
          longitude: place?.longitude ?? null,
        }
      })
    },
  })
}

export interface FieldCaptureInput {
  type: 'barbershop' | 'independent_barber'
  canonicalName: string
  country: string
  city: string
  observation: string
  addressLine?: string | null
  postalCode?: string | null
  phone?: string | null
  email?: string | null
}

/**
 * `capture_field_prospect` est en production depuis PLAT-1 et testée (D6–D9) ;
 * il ne manquait que l'écran. Elle NE FUSIONNE JAMAIS : un doublon est refusé
 * en le nommant (`prospect_already_known`) et l'humain tranche.
 */
export function useCaptureFieldProspect() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: FieldCaptureInput) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('capture_field_prospect', {
        p_type: input.type,
        p_canonical_name: input.canonicalName,
        p_country: input.country,
        p_city: input.city,
        p_observation: input.observation,
        p_address_line: input.addressLine ?? null,
        p_postal_code: input.postalCode ?? null,
        p_phone: input.phone ?? null,
        p_email: input.email ?? null,
      })
      if (error) throw error
      return data as unknown as string
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform', 'prospects'] }),
  })
}

export function usePublishExternalProfessional() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (prospectId: string) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('publish_external_professional', { p_prospect_id: prospectId })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'prospects'] })
      void queryClient.invalidateQueries({ queryKey: ['platform', 'sales'] })
    },
  })
}

// ============================================================================
// Affiches QR
// ============================================================================

export type PosterState = 'free' | 'assigned' | 'revoked'

export interface PosterBatchRow {
  id: string
  label: string
  note: string | null
  code_count: number
  free_count: number
  assigned_count: number
  revoked_count: number
  letters_prepared: number
  created_by_email: string | null
  created_at: string
}

export function usePosterBatches() {
  return useQuery({
    queryKey: ['platform', 'posters', 'batches'],
    queryFn: async (): Promise<PosterBatchRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_poster_batches', { p_limit: 100 })
      if (error) throw error
      return (data ?? []) as PosterBatchRow[]
    },
  })
}

export interface PosterRow {
  id: string
  code: string
  state: PosterState
  batch_id: string
  batch_label: string
  organization_id: string | null
  organization_name: string | null
  organization_slug: string | null
  location_id: string | null
  location_name: string | null
  assigned_at: string | null
  assigned_by_email: string | null
  revoked_at: string | null
  revoke_reason: string | null
  letter_prospect_id: string | null
  letter_prospect_name: string | null
  letter_generated_at: string | null
  created_at: string
}

export function usePosters(options: { batchId?: string | null; state?: PosterState | null } = {}) {
  const batchId = options.batchId ?? null
  const state = options.state ?? null
  return useQuery({
    queryKey: ['platform', 'posters', 'list', batchId, state],
    queryFn: async (): Promise<PosterRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_posters', {
        p_batch_id: batchId,
        p_state: state,
        p_limit: 500,
      })
      if (error) throw error
      return (data ?? []) as PosterRow[]
    },
  })
}

export interface GeneratedBatch {
  batch_id: string
  label: string
  code_count: number
  created_at: string
  codes: string[]
}

export function useGeneratePosterBatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { count: number; label: string; note?: string | null }): Promise<GeneratedBatch> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('generate_poster_batch', {
        p_count: input.count,
        p_label: input.label,
        p_note: input.note ?? null,
      })
      if (error) throw error
      return data as unknown as GeneratedBatch
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform', 'posters'] }),
  })
}

export function useRevokePoster() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { code: string; reason: string }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('revoke_poster', { p_code: input.code, p_reason: input.reason })
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform', 'posters'] }),
  })
}

export interface PosterAssignableLocation {
  location_id: string
  location_name: string
  city: string | null
  country: string | null
  organization_id: string
  organization_name: string
  organization_slug: string
  via: 'membership' | 'platform'
}

export function useMyPosterLocations(enabled = true) {
  return useQuery({
    queryKey: ['platform', 'posters', 'my-locations'],
    enabled,
    queryFn: async (): Promise<PosterAssignableLocation[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_my_poster_locations')
      if (error) throw error
      return (data ?? []) as PosterAssignableLocation[]
    },
  })
}

export function useAssignPoster() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { code: string; locationId: string }) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('assign_poster', {
        p_code: input.code,
        p_location_id: input.locationId,
      })
      if (error) throw error
      return data as unknown as { code: string; state: PosterState; organization_slug: string | null; location_id: string }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'posters'] })
      void queryClient.invalidateQueries({ queryKey: ['poster', 'resolve'] })
    },
  })
}

export interface PosterResolution {
  code: string | null
  state: 'free' | 'assigned' | 'revoked' | 'unknown'
  organization_slug?: string | null
  organization_name?: string | null
  location_id?: string | null
  location_name?: string | null
  can_assign?: boolean
  assignable_locations?: {
    location_id: string
    location_name: string
    city: string | null
    organization_id: string
    organization_name: string
    via: 'membership' | 'platform'
  }[]
  claim?: { professional_handle: string | null; display_name: string | null } | null
}

/**
 * LE SCAN. Exécutable par `anon` — un client qui scanne une affiche dans un
 * salon n'a pas de compte, et lui demander d'en créer un pour lire « cette
 * affiche n'est pas encore active » serait absurde.
 */
export function useResolvePosterCode(code: string | undefined) {
  return useQuery({
    queryKey: ['poster', 'resolve', code],
    enabled: Boolean(code),
    retry: false,
    queryFn: async (): Promise<PosterResolution> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('resolve_poster_code', { p_code: code })
      if (error) throw error
      return data as unknown as PosterResolution
    },
  })
}

export interface PosterLetterData {
  code: string
  prospect_id: string
  business_name: string
  address: { line: string | null; postal_code: string | null; city: string | null; country: string | null }
  /** `null` quand l'analytics ne dit rien. On n'invente pas de preuve. */
  proof: {
    profile_views_all_time: number
    profile_views_window: number
    window_days: number
    interest_requests: number
    last_profile_view_at: string | null
  } | null
  stats: ProspectStats
}

export function usePreparePosterLetter() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { code: string; prospectId: string }): Promise<PosterLetterData> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('prepare_poster_letter', {
        p_code: input.code,
        p_prospect_id: input.prospectId,
      })
      if (error) throw error
      return data as unknown as PosterLetterData
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform', 'posters'] }),
  })
}
