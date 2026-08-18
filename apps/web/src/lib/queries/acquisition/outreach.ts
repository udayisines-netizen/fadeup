import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import { asRows, bool, enumValue, num, numOrNull, str, strOrNull } from './row'

/**
 * Outreach: approved templates, campaigns, recipients and their outcomes.
 *
 * Source of truth: db/migrations/20260818100100_prospect_outreach_whatsapp_ml.sql.
 *
 * Note what is absent from this module: there is no "generate message"
 * mutation, and no field anywhere carries model-written copy. Message text
 * comes only from an administrator-approved outreach_templates row
 * (spec §23).
 */

export type OutreachChannel = 'whatsapp' | 'email' | 'sms'

export type OutreachTemplateStatus = 'draft' | 'pending_approval' | 'approved' | 'paused' | 'retired'

export const OUTREACH_TEMPLATE_STATUSES: readonly OutreachTemplateStatus[] = [
  'draft',
  'pending_approval',
  'approved',
  'paused',
  'retired',
]

export type OutreachCampaignStatus =
  | 'draft'
  | 'preparing'
  | 'ready'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type OutreachRecipientState =
  | 'blocked'
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'replied'
  | 'positive_reply'
  | 'negative_reply'
  | 'failed'
  | 'opted_out'
  | 'claimed'
  | 'activated'
  | 'paid'

export type SalesAngle =
  | 'ONLINE_BOOKING'
  | 'MARKETPLACE_ACQUISITION'
  | 'LIVE_QUEUE'
  | 'BARBER_MANAGEMENT'
  | 'SHOP_OS'
  | 'CUSTOMER_RETENTION'
  | 'COMPETITOR_MIGRATION'
  | 'MULTI_LOCATION'
  | 'DIGITAL_MODERNIZATION'

/** The locales FadeUp maintains approved copy for. An unsupported locale blocks outreach rather than falling back. */
export const SUPPORTED_LOCALES = ['fr-FR', 'en-GB', 'en-US'] as const

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface OutreachTemplate {
  id: string
  key: string
  name: string
  channel: OutreachChannel
  locale: string
  segmentKey: string | null
  bookingProviderId: string | null
  salesAngle: SalesAngle | null
  version: number
  status: OutreachTemplateStatus
  body: string
  allowedVariables: string[]
  approvedBy: string | null
  approvedAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

interface TemplateRow {
  id: string
  key: string
  name: string
  channel: string
  locale: string
  segment_key: string | null
  booking_provider_id: string | null
  sales_angle: string | null
  version: number
  status: string
  body: string
  allowed_variables: string[] | null
  approved_by: string | null
  approved_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

function mapTemplate(row: TemplateRow): OutreachTemplate {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    channel: row.channel as OutreachChannel,
    locale: row.locale,
    segmentKey: row.segment_key,
    bookingProviderId: row.booking_provider_id,
    salesAngle: row.sales_angle as SalesAngle | null,
    version: row.version,
    status: row.status as OutreachTemplateStatus,
    body: row.body,
    allowedVariables: row.allowed_variables ?? [],
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const TEMPLATE_COLUMNS =
  'id, key, name, channel, locale, segment_key, booking_provider_id, sales_angle, version, status, body, allowed_variables, approved_by, approved_at, notes, created_at, updated_at'

export function useOutreachTemplates() {
  return useQuery({
    queryKey: ['acquisition', 'templates'],
    queryFn: async (): Promise<OutreachTemplate[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('outreach_templates')
        .select(TEMPLATE_COLUMNS)
        .order('locale')
        .order('key')
      if (error) throw error
      return ((data ?? []) as TemplateRow[]).map(mapTemplate)
    },
  })
}

export interface UpsertTemplateInput {
  id?: string
  key: string
  name: string
  locale: string
  channel?: OutreachChannel
  segmentKey?: string | null
  bookingProviderId?: string | null
  salesAngle?: SalesAngle | null
  body: string
  allowedVariables: string[]
  notes?: string | null
}

export function useUpsertOutreachTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpsertTemplateInput) => {
      const supabase = getSupabaseClient()
      const payload = {
        key: input.key,
        name: input.name,
        channel: input.channel ?? 'whatsapp',
        locale: input.locale,
        segment_key: input.segmentKey ?? null,
        booking_provider_id: input.bookingProviderId ?? null,
        sales_angle: input.salesAngle ?? null,
        body: input.body,
        allowed_variables: input.allowedVariables,
        notes: input.notes ?? null,
      }

      const query = input.id
        ? supabase.from('outreach_templates').update(payload).eq('id', input.id).select(TEMPLATE_COLUMNS).single()
        : supabase.from('outreach_templates').insert(payload).select(TEMPLATE_COLUMNS).single()

      const { data, error } = await query
      if (error) throw error
      return mapTemplate(data as TemplateRow)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'templates'] })
    },
  })
}

/** Approval is one explicit, audited action — never a field edit (spec §24). */
export function useApproveOutreachTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (templateId: string) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('approve_outreach_template', { p_template_id: templateId })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'templates'] })
    },
  })
}

/** The operator kill switch: pausing a template stops the send queue immediately (spec §72). */
export function useSetOutreachTemplatePaused() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { templateId: string; paused: boolean }) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('set_outreach_template_paused', {
        p_template_id: input.templateId,
        p_paused: input.paused,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'templates'] })
    },
  })
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export interface OutreachCampaign {
  id: string
  name: string
  channel: OutreachChannel
  status: OutreachCampaignStatus
  selectionFilters: Record<string, unknown>
  whatsappAccountId: string | null
  experimentId: string | null
  maxSendsPerHour: number
  approvedBy: string | null
  approvedAt: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

interface CampaignRow {
  id: string
  name: string
  channel: string
  status: string
  selection_filters: Record<string, unknown> | null
  whatsapp_account_id: string | null
  experiment_id: string | null
  max_sends_per_hour: number
  approved_by: string | null
  approved_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

function mapCampaign(row: CampaignRow): OutreachCampaign {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel as OutreachChannel,
    status: row.status as OutreachCampaignStatus,
    selectionFilters: row.selection_filters ?? {},
    whatsappAccountId: row.whatsapp_account_id,
    experimentId: row.experiment_id,
    maxSendsPerHour: row.max_sends_per_hour,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  }
}

const CAMPAIGN_COLUMNS =
  'id, name, channel, status, selection_filters, whatsapp_account_id, experiment_id, max_sends_per_hour, approved_by, approved_at, started_at, completed_at, created_at'

export function useOutreachCampaigns() {
  return useQuery({
    queryKey: ['acquisition', 'campaigns'],
    queryFn: async (): Promise<OutreachCampaign[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('outreach_campaigns').select(CAMPAIGN_COLUMNS).order('created_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as CampaignRow[]).map(mapCampaign)
    },
  })
}

export function useOutreachCampaign(campaignId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'campaign', campaignId],
    enabled: Boolean(campaignId),
    queryFn: async (): Promise<OutreachCampaign> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('outreach_campaigns').select(CAMPAIGN_COLUMNS).eq('id', campaignId!).single()
      if (error) throw error
      return mapCampaign(data as CampaignRow)
    },
  })
}

/**
 * Creates a campaign and attaches the selected prospects as PENDING
 * recipients. Pending is a pre-send bookkeeping state that the eligibility
 * gate always allows; the gate runs when preparation moves them to queued.
 */
export function useCreateOutreachCampaign() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      name: string
      prospectIds: string[]
      whatsappAccountId: string | null
      maxSendsPerHour?: number
      selectionFilters?: Record<string, unknown>
      experimentId?: string | null
    }) => {
      const supabase = getSupabaseClient()

      const { data: campaign, error: campaignError } = await supabase
        .from('outreach_campaigns')
        .insert({
          name: input.name,
          channel: 'whatsapp',
          status: 'draft',
          whatsapp_account_id: input.whatsappAccountId,
          max_sends_per_hour: input.maxSendsPerHour ?? 60,
          selection_filters: input.selectionFilters ?? {},
          experiment_id: input.experimentId ?? null,
        })
        .select(CAMPAIGN_COLUMNS)
        .single()

      if (campaignError) throw campaignError

      const created = mapCampaign(campaign as CampaignRow)

      if (input.prospectIds.length > 0) {
        // Chunked so a large selection does not exceed the request size
        // limit. UNIQUE (campaign_id, prospect_id) makes a duplicate in the
        // selection harmless.
        const CHUNK = 500
        for (let i = 0; i < input.prospectIds.length; i += CHUNK) {
          const chunk = input.prospectIds.slice(i, i + CHUNK)
          const { error: recipientError } = await supabase
            .from('outreach_recipients')
            .insert(chunk.map((prospectId) => ({ campaign_id: created.id, prospect_id: prospectId, state: 'pending' })))
          if (recipientError) throw recipientError
        }
      }

      return created
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'campaigns'] })
    },
  })
}

/** Lifecycle transitions go through the validating RPC, never a raw UPDATE. */
export function useSetOutreachCampaignStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { campaignId: string; status: OutreachCampaignStatus }) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('set_outreach_campaign_status', {
        p_campaign_id: input.campaignId,
        p_status: input.status,
      })
      if (error) throw error
      return data
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'campaigns'] })
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'campaign', variables.campaignId] })
    },
  })
}

/** Enqueues the preparation job: eligibility gate, template selection, rendering. */
export function usePrepareOutreachCampaign() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (campaignId: string) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('prospect_jobs')
        .insert({ job_type: 'outreach_preparation', payload: { campaignId }, priority: 150 })
        .select('id')
        .single()
      if (error) throw error
      return data as { id: string }
    },
    onSuccess: (_data, campaignId) => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'campaign', campaignId] })
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'jobs'] })
    },
  })
}

/** Enqueues a send batch for a running campaign. */
export function useEnqueueWhatsAppSend() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (campaignId: string) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('prospect_jobs')
        .insert({ job_type: 'whatsapp_send', payload: { campaignId }, priority: 150 })
        .select('id')
        .single()
      if (error) throw error
      return data as { id: string }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'jobs'] })
    },
  })
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

export interface OutreachRecipient {
  id: string
  campaignId: string
  prospectId: string
  prospectName: string | null
  state: OutreachRecipientState
  templateId: string | null
  templateKey: string | null
  selectionMethod: string | null
  selectionReason: Record<string, unknown>
  locale: string | null
  salesAngle: string | null
  renderedBody: string | null
  destination: string | null
  blockedReason: string | null
  experimentArm: string | null
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  repliedAt: string | null
  lastError: string | null
}

interface RecipientRow {
  id: string
  campaign_id: string
  prospect_id: string
  state: string
  template_id: string | null
  selection_method: string | null
  selection_reason: Record<string, unknown> | null
  locale: string | null
  sales_angle: string | null
  rendered_body: string | null
  destination: string | null
  blocked_reason: string | null
  experiment_arm: string | null
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  replied_at: string | null
  last_error: string | null
  prospects: { canonical_name: string } | null
  outreach_templates: { key: string } | null
}

const RECIPIENT_COLUMNS =
  'id, campaign_id, prospect_id, state, template_id, selection_method, selection_reason, locale, sales_angle, rendered_body, destination, blocked_reason, experiment_arm, sent_at, delivered_at, read_at, replied_at, last_error, prospects(canonical_name), outreach_templates(key)'

function mapRecipient(row: RecipientRow): OutreachRecipient {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    prospectId: row.prospect_id,
    prospectName: row.prospects?.canonical_name ?? null,
    state: row.state as OutreachRecipientState,
    templateId: row.template_id,
    templateKey: row.outreach_templates?.key ?? null,
    selectionMethod: row.selection_method,
    selectionReason: row.selection_reason ?? {},
    locale: row.locale,
    salesAngle: row.sales_angle,
    renderedBody: row.rendered_body,
    destination: row.destination,
    blockedReason: row.blocked_reason,
    experimentArm: row.experiment_arm,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
    repliedAt: row.replied_at,
    lastError: row.last_error,
  }
}

export function useCampaignRecipients(campaignId: string | undefined, state?: OutreachRecipientState) {
  return useQuery({
    queryKey: ['acquisition', 'campaign', campaignId, 'recipients', state ?? 'all'],
    enabled: Boolean(campaignId),
    queryFn: async (): Promise<OutreachRecipient[]> => {
      const supabase = getSupabaseClient()
      let query = supabase.from('outreach_recipients').select(RECIPIENT_COLUMNS).eq('campaign_id', campaignId!).limit(500)
      if (state) query = query.eq('state', state)
      const { data, error } = await query.order('created_at')
      if (error) throw error
      return ((data ?? []) as unknown as RecipientRow[]).map(mapRecipient)
    },
  })
}

/** Recipients that have replied and are awaiting a human sentiment classification. */
export function useRepliesAwaitingClassification() {
  return useQuery({
    queryKey: ['acquisition', 'replies', 'unclassified'],
    queryFn: async (): Promise<OutreachRecipient[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('outreach_recipients')
        .select(RECIPIENT_COLUMNS)
        .eq('state', 'replied')
        .order('replied_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return ((data ?? []) as unknown as RecipientRow[]).map(mapRecipient)
    },
  })
}

/**
 * Human reply classification (spec §34). The Worker never infers sentiment
 * — only deterministic opt-out keywords are matched automatically.
 */
export function useClassifyOutreachReply() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { recipientId: string; positive: boolean; note?: string }) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('classify_outreach_reply', {
        p_recipient_id: input.recipientId,
        p_positive: input.positive,
        p_note: input.note ?? null,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'replies'] })
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'campaign'] })
    },
  })
}

/** Suppresses a prospect from every future campaign, on every channel. */
export function useSuppressProspectOutreach() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { prospectId: string; reason: string }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('suppress_prospect_outreach', {
        p_prospect_id: input.prospectId,
        p_reason: input.reason,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition'] })
    },
  })
}

/**
 * Previews why a prospect would be blocked, using the SAME function the
 * send path enforces — so the preview cannot drift from reality.
 */
export function useOutreachBlockReason(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect', prospectId, 'block-reason'],
    enabled: Boolean(prospectId),
    queryFn: async (): Promise<string | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('outreach_block_reason', {
        p_prospect_id: prospectId!,
        p_channel: 'whatsapp',
      })
      if (error) throw error
      return (data as string | null) ?? null
    },
  })
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface TemplatePerformanceRow {
  templateId: string
  templateKey: string
  name: string
  locale: string
  status: OutreachTemplateStatus
  salesAngle: string | null
  segmentKey: string | null
  bookingProviderKey: string | null
  recipients: number
  sent: number
  delivered: number
  read: number
  replied: number
  positiveReply: number
  optedOut: number
  claimed: number
  activated: number
  paid: number
  /** NULL when nothing has been sent — an untested template is not a 0% template. */
  replyRate: number | null
  positiveReplyRate: number | null
  activationRate: number | null
  paidRate: number | null
}

export function useTemplatePerformance() {
  return useQuery({
    queryKey: ['acquisition', 'template-performance'],
    queryFn: async (): Promise<TemplatePerformanceRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('template_performance').select('*')
      if (error) throw error
      return asRows(data).map((row) => ({
        templateId: str(row, 'template_id'),
        templateKey: str(row, 'template_key'),
        name: str(row, 'name'),
        locale: str(row, 'locale'),
        status: enumValue(row, 'status', OUTREACH_TEMPLATE_STATUSES, 'draft'),
        salesAngle: strOrNull(row, 'sales_angle'),
        segmentKey: strOrNull(row, 'segment_key'),
        bookingProviderKey: strOrNull(row, 'booking_provider_key'),
        recipients: num(row, 'recipients'),
        sent: num(row, 'sent'),
        delivered: num(row, 'delivered'),
        read: num(row, 'read'),
        replied: num(row, 'replied'),
        positiveReply: num(row, 'positive_reply'),
        optedOut: num(row, 'opted_out'),
        claimed: num(row, 'claimed'),
        activated: num(row, 'activated'),
        paid: num(row, 'paid'),
        // numOrNull, not num: the view returns NULL when nothing was sent,
        // and coercing that to 0 would make an untested template look like
        // a 0%-performing one.
        replyRate: numOrNull(row, 'reply_rate'),
        positiveReplyRate: numOrNull(row, 'positive_reply_rate'),
        activationRate: numOrNull(row, 'activation_rate'),
        paidRate: numOrNull(row, 'paid_rate'),
      }))
    },
  })
}

export interface FunnelStatsRow {
  campaignId: string
  campaignName: string
  templateKey: string | null
  locale: string | null
  salesAngle: string | null
  bookingProviderKey: string | null
  country: string
  recipients: number
  blocked: number
  sent: number
  delivered: number
  read: number
  replied: number
  positiveReply: number
  optedOut: number
  claimed: number
  activated: number
  paid: number
}

export function useOutreachFunnelStats() {
  return useQuery({
    queryKey: ['acquisition', 'funnel-stats'],
    queryFn: async (): Promise<FunnelStatsRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('outreach_funnel_stats').select('*').limit(500)
      if (error) throw error
      return asRows(data).map((row) => ({
        campaignId: str(row, 'campaign_id'),
        campaignName: str(row, 'campaign_name'),
        templateKey: strOrNull(row, 'template_key'),
        locale: strOrNull(row, 'locale'),
        salesAngle: strOrNull(row, 'sales_angle'),
        bookingProviderKey: strOrNull(row, 'booking_provider_key'),
        country: str(row, 'country'),
        recipients: num(row, 'recipients'),
        blocked: num(row, 'blocked'),
        sent: num(row, 'sent'),
        delivered: num(row, 'delivered'),
        read: num(row, 'read'),
        replied: num(row, 'replied'),
        positiveReply: num(row, 'positive_reply'),
        optedOut: num(row, 'opted_out'),
        claimed: num(row, 'claimed'),
        activated: num(row, 'activated'),
        paid: num(row, 'paid'),
      }))
    },
  })
}

// ---------------------------------------------------------------------------
// WhatsApp accounts
// ---------------------------------------------------------------------------

export interface WhatsAppAccount {
  id: string
  label: string
  wabaId: string
  phoneNumberId: string
  displayPhoneNumber: string | null
  /** The NAME of the env var holding the token. The value never reaches the browser. */
  accessTokenEnvVar: string
  isActive: boolean
  providerMode: 'mock' | 'live'
}

export function useWhatsAppAccounts() {
  return useQuery({
    queryKey: ['acquisition', 'whatsapp-accounts'],
    queryFn: async (): Promise<WhatsAppAccount[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('whatsapp_accounts')
        .select('id, label, waba_id, phone_number_id, display_phone_number, access_token_env_var, is_active, provider_mode')
        .order('label')
      if (error) throw error
      return asRows(data).map((row) => ({
        id: str(row, 'id'),
        label: str(row, 'label'),
        wabaId: str(row, 'waba_id'),
        phoneNumberId: str(row, 'phone_number_id'),
        displayPhoneNumber: strOrNull(row, 'display_phone_number'),
        accessTokenEnvVar: str(row, 'access_token_env_var'),
        isActive: bool(row, 'is_active'),
        // Defaults to 'mock' when unrecognised: the safe direction is
        // "sends nothing", never "sends for real".
        providerMode: enumValue(row, 'provider_mode', ['mock', 'live'] as const, 'mock'),
      }))
    },
  })
}
