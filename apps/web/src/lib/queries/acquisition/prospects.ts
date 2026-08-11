import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import {
  normalizeScoreFactors,
  type ProspectEntityKind,
  type ProspectOutreachChannel,
  type ProspectOutreachDirection,
  type ProspectPipelineStage,
  type ProspectScoreBucket,
  type ProspectSocialPlatform,
  type ProspectType,
  type ScoreFactor,
} from './types'

// --- prospects (canonical business) -----------------------------------------

export interface Prospect {
  id: string
  type: ProspectType
  entityKind: ProspectEntityKind
  parentGroupId: string | null
  status: ProspectPipelineStage
  canonicalName: string
  country: string
  websiteUrl: string | null
  websiteDomain: string | null
  phoneE164: string | null
  email: string | null
  currentScore: number | null
  currentScoreBucket: ProspectScoreBucket | null
  doNotContact: boolean
  convertedOrganizationId: string | null
  firstDiscoveredAt: string
  lastEnrichedAt: string | null
  createdAt: string
  updatedAt: string
}

interface ProspectRow {
  id: string
  type: ProspectType
  entity_kind: ProspectEntityKind
  parent_group_id: string | null
  status: ProspectPipelineStage
  canonical_name: string
  country: string
  website_url: string | null
  website_domain: string | null
  phone_e164: string | null
  email: string | null
  current_score: number | null
  current_score_bucket: ProspectScoreBucket | null
  do_not_contact: boolean
  converted_organization_id: string | null
  first_discovered_at: string
  last_enriched_at: string | null
  created_at: string
  updated_at: string
}

function mapProspect(row: ProspectRow): Prospect {
  return {
    id: row.id,
    type: row.type,
    entityKind: row.entity_kind,
    parentGroupId: row.parent_group_id,
    status: row.status,
    canonicalName: row.canonical_name,
    country: row.country,
    websiteUrl: row.website_url,
    websiteDomain: row.website_domain,
    phoneE164: row.phone_e164,
    email: row.email,
    currentScore: row.current_score,
    currentScoreBucket: row.current_score_bucket,
    doNotContact: row.do_not_contact,
    convertedOrganizationId: row.converted_organization_id,
    firstDiscoveredAt: row.first_discovered_at,
    lastEnrichedAt: row.last_enriched_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const PROSPECT_COLUMNS =
  'id, type, entity_kind, parent_group_id, status, canonical_name, country, website_url, website_domain, phone_e164, email, current_score, current_score_bucket, do_not_contact, converted_organization_id, first_discovered_at, last_enriched_at, created_at, updated_at'

export interface ProspectFilters {
  search?: string
  type?: ProspectType
  status?: ProspectPipelineStage
  scoreBucket?: ProspectScoreBucket
  country?: string
}

const PROSPECT_LIST_LIMIT = 200

/**
 * Filtered prospect list, most recently discovered first, capped at 200 rows
 * — Prospects/Barbershops/Independent Barbers pages all use this with
 * different fixed `type` filters (see ProspectsTable's `presetType` prop).
 */
export function useProspects(filters: ProspectFilters = {}) {
  return useQuery({
    queryKey: ['acquisition', 'prospects', filters],
    queryFn: async (): Promise<Prospect[]> => {
      const supabase = getSupabaseClient()
      let query = supabase.from('prospects').select(PROSPECT_COLUMNS).order('created_at', { ascending: false }).limit(PROSPECT_LIST_LIMIT)

      if (filters.type) query = query.eq('type', filters.type)
      if (filters.status) query = query.eq('status', filters.status)
      if (filters.scoreBucket) query = query.eq('current_score_bucket', filters.scoreBucket)
      if (filters.country) query = query.eq('country', filters.country.toUpperCase())
      if (filters.search?.trim()) query = query.ilike('canonical_name', `%${filters.search.trim()}%`)

      const { data, error } = await query
      if (error) throw error
      return ((data ?? []) as ProspectRow[]).map(mapProspect)
    },
  })
}

export function useProspect(id: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect', id],
    queryFn: async (): Promise<Prospect | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('prospects').select(PROSPECT_COLUMNS).eq('id', id).maybeSingle()
      if (error) throw error
      return data ? mapProspect(data as ProspectRow) : null
    },
    enabled: Boolean(id),
  })
}

/** Moves a prospect to a new pipeline stage — a plain UPDATE; prospects_log_status_change auto-logs a prospect_events row. Platform owner/admin only (RLS). */
export function useUpdateProspectStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; status: ProspectPipelineStage }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('prospects').update({ status: input.status }).eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'prospect', variables.id] })
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'prospect-events', variables.id] })
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'prospects'] })
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'overview'] })
    },
  })
}

// --- locations ---------------------------------------------------------------

export interface ProspectLocation {
  id: string
  prospectId: string
  isPrimary: boolean
  addressLine: string | null
  city: string | null
  postalCode: string | null
  region: string | null
  country: string
  latitude: number | null
  longitude: number | null
}

interface ProspectLocationRow {
  id: string
  prospect_id: string
  is_primary: boolean
  address_line: string | null
  city: string | null
  postal_code: string | null
  region: string | null
  country: string
  latitude: number | null
  longitude: number | null
}

function mapLocation(row: ProspectLocationRow): ProspectLocation {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    isPrimary: row.is_primary,
    addressLine: row.address_line,
    city: row.city,
    postalCode: row.postal_code,
    region: row.region,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
  }
}

const LOCATION_COLUMNS = 'id, prospect_id, is_primary, address_line, city, postal_code, region, country, latitude, longitude'

export function useProspectLocations(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect-locations', prospectId],
    queryFn: async (): Promise<ProspectLocation[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('prospect_locations')
        .select(LOCATION_COLUMNS)
        .eq('prospect_id', prospectId)
        .order('is_primary', { ascending: false })
      if (error) throw error
      return ((data ?? []) as ProspectLocationRow[]).map(mapLocation)
    },
    enabled: Boolean(prospectId),
  })
}

export interface ProspectMapPoint extends ProspectLocation {
  prospect: Pick<Prospect, 'id' | 'canonicalName' | 'type' | 'status' | 'currentScoreBucket'>
}

/**
 * Every prospect with a primary location that has coordinates — powers the
 * Map page. Capped at 1000 (PostgREST's PGRST_DB_MAX_ROWS) since this is a
 * point-plotting query, not an aggregate; at the current dataset size this
 * is exact, and the cap is called out here so a future maintainer knows why
 * markers could go missing past that many geocoded prospects.
 */
export function useProspectMapPoints() {
  return useQuery({
    queryKey: ['acquisition', 'map-points'],
    queryFn: async (): Promise<ProspectMapPoint[]> => {
      const supabase = getSupabaseClient()
      const [locationsRes, prospectsRes] = await Promise.all([
        supabase
          .from('prospect_locations')
          .select(LOCATION_COLUMNS)
          .eq('is_primary', true)
          .not('latitude', 'is', null)
          .not('longitude', 'is', null)
          .limit(1000),
        supabase.from('prospects').select('id, canonical_name, type, status, current_score_bucket').limit(1000),
      ])
      if (locationsRes.error) throw locationsRes.error
      if (prospectsRes.error) throw prospectsRes.error

      const prospectById = new Map<string, ProspectRow>()
      for (const row of (prospectsRes.data ?? []) as ProspectRow[]) prospectById.set(row.id, row)

      const points: ProspectMapPoint[] = []
      for (const row of (locationsRes.data ?? []) as ProspectLocationRow[]) {
        const prospectRow = prospectById.get(row.prospect_id)
        if (!prospectRow) continue
        points.push({
          ...mapLocation(row),
          prospect: {
            id: prospectRow.id,
            canonicalName: prospectRow.canonical_name,
            type: prospectRow.type,
            status: prospectRow.status,
            currentScoreBucket: prospectRow.current_score_bucket,
          },
        })
      }
      return points
    },
  })
}

// --- contacts ------------------------------------------------------------------

export interface ProspectContact {
  id: string
  prospectId: string
  fullName: string | null
  roleTitle: string | null
  phoneE164: string | null
  email: string | null
  notes: string | null
}

interface ProspectContactRow {
  id: string
  prospect_id: string
  full_name: string | null
  role_title: string | null
  phone_e164: string | null
  email: string | null
  notes: string | null
}

export function useProspectContacts(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect-contacts', prospectId],
    queryFn: async (): Promise<ProspectContact[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('prospect_contacts')
        .select('id, prospect_id, full_name, role_title, phone_e164, email, notes')
        .eq('prospect_id', prospectId)
      if (error) throw error
      return ((data ?? []) as ProspectContactRow[]).map((row) => ({
        id: row.id,
        prospectId: row.prospect_id,
        fullName: row.full_name,
        roleTitle: row.role_title,
        phoneE164: row.phone_e164,
        email: row.email,
        notes: row.notes,
      }))
    },
    enabled: Boolean(prospectId),
  })
}

// --- social profiles -----------------------------------------------------------

export interface ProspectSocialProfile {
  id: string
  prospectId: string
  platform: ProspectSocialPlatform
  handle: string | null
  url: string | null
  followerCount: number | null
  isBusinessAccount: boolean | null
  lastCheckedAt: string | null
}

interface ProspectSocialProfileRow {
  id: string
  prospect_id: string
  platform: ProspectSocialPlatform
  handle: string | null
  url: string | null
  follower_count: number | null
  is_business_account: boolean | null
  last_checked_at: string | null
}

export function useProspectSocialProfiles(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect-social-profiles', prospectId],
    queryFn: async (): Promise<ProspectSocialProfile[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('prospect_social_profiles')
        .select('id, prospect_id, platform, handle, url, follower_count, is_business_account, last_checked_at')
        .eq('prospect_id', prospectId)
      if (error) throw error
      return ((data ?? []) as ProspectSocialProfileRow[]).map((row) => ({
        id: row.id,
        prospectId: row.prospect_id,
        platform: row.platform,
        handle: row.handle,
        url: row.url,
        followerCount: row.follower_count,
        isBusinessAccount: row.is_business_account,
        lastCheckedAt: row.last_checked_at,
      }))
    },
    enabled: Boolean(prospectId),
  })
}

// --- source provenance -----------------------------------------------------

export interface ProspectSourceRecord {
  id: string
  sourceId: string
  sourceKey: string
  sourceDisplayName: string
  externalId: string | null
  externalType: string | null
  sourceUrl: string | null
  confidence: number | null
  fetchedAt: string
  lastVerifiedAt: string | null
}

interface ProspectSourceRecordRow {
  id: string
  source_id: string
  external_id: string | null
  external_type: string | null
  source_url: string | null
  confidence: number | null
  fetched_at: string
  last_verified_at: string | null
}

/**
 * Full provenance trail for a prospect — "Platform Owner must clearly see
 * where information came from" per the Worker V2 spec. Joined client-side
 * against prospect_sources (a small, fully-cached lookup table) rather than
 * a PostgREST embedded select, matching this codebase's existing join
 * convention (see platform-organization-detail-page.tsx's staffProfileByUserId map).
 */
export function useProspectSourceRecords(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect-source-records', prospectId],
    queryFn: async (): Promise<ProspectSourceRecord[]> => {
      const supabase = getSupabaseClient()
      const [recordsRes, sourcesRes] = await Promise.all([
        supabase
          .from('prospect_source_records')
          .select('id, source_id, external_id, external_type, source_url, confidence, fetched_at, last_verified_at')
          .eq('prospect_id', prospectId)
          .order('fetched_at', { ascending: false }),
        supabase.from('prospect_sources').select('id, key, display_name'),
      ])
      if (recordsRes.error) throw recordsRes.error
      if (sourcesRes.error) throw sourcesRes.error

      const sourceById = new Map<string, { key: string; display_name: string }>()
      for (const row of (sourcesRes.data ?? []) as { id: string; key: string; display_name: string }[]) {
        sourceById.set(row.id, row)
      }

      return ((recordsRes.data ?? []) as ProspectSourceRecordRow[]).map((row) => {
        const source = sourceById.get(row.source_id)
        return {
          id: row.id,
          sourceId: row.source_id,
          sourceKey: source?.key ?? 'unknown',
          sourceDisplayName: source?.display_name ?? 'Unknown source',
          externalId: row.external_id,
          externalType: row.external_type,
          sourceUrl: row.source_url,
          confidence: row.confidence,
          fetchedAt: row.fetched_at,
          lastVerifiedAt: row.last_verified_at,
        }
      })
    },
    enabled: Boolean(prospectId),
  })
}

// --- scores ------------------------------------------------------------------

export interface ProspectScoreEntry {
  id: string
  prospectId: string
  score: number
  bucket: ProspectScoreBucket
  factors: ScoreFactor[]
  scoredAt: string
}

interface ProspectScoreRow {
  id: string
  prospect_id: string
  score: number
  bucket: ProspectScoreBucket
  factors: unknown
  scored_at: string
}

/** Full score history, most recent first (index [0] is "current"). Append-only — see prospect_scores comment. */
export function useProspectScores(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect-scores', prospectId],
    queryFn: async (): Promise<ProspectScoreEntry[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('prospect_scores')
        .select('id, prospect_id, score, bucket, factors, scored_at')
        .eq('prospect_id', prospectId)
        .order('scored_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as ProspectScoreRow[]).map((row) => ({
        id: row.id,
        prospectId: row.prospect_id,
        score: row.score,
        bucket: row.bucket,
        factors: normalizeScoreFactors(row.factors),
        scoredAt: row.scored_at,
      }))
    },
    enabled: Boolean(prospectId),
  })
}

// --- events (timeline) -----------------------------------------------------

export interface ProspectEvent {
  id: string
  prospectId: string
  eventType: string
  actorUserId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

interface ProspectEventRow {
  id: string
  prospect_id: string
  event_type: string
  actor_user_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export function useProspectEvents(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect-events', prospectId],
    queryFn: async (): Promise<ProspectEvent[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('prospect_events')
        .select('id, prospect_id, event_type, actor_user_id, metadata, created_at')
        .eq('prospect_id', prospectId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as ProspectEventRow[]).map((row) => ({
        id: row.id,
        prospectId: row.prospect_id,
        eventType: row.event_type,
        actorUserId: row.actor_user_id,
        metadata: row.metadata,
        createdAt: row.created_at,
      }))
    },
    enabled: Boolean(prospectId),
  })
}

// --- tags ----------------------------------------------------------------------

export interface ProspectTag {
  id: string
  prospectId: string
  tag: string
  createdAt: string
}

interface ProspectTagRow {
  id: string
  prospect_id: string
  tag: string
  created_at: string
}

export function useProspectTags(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect-tags', prospectId],
    queryFn: async (): Promise<ProspectTag[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('prospect_tags')
        .select('id, prospect_id, tag, created_at')
        .eq('prospect_id', prospectId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return ((data ?? []) as ProspectTagRow[]).map((row) => ({
        id: row.id,
        prospectId: row.prospect_id,
        tag: row.tag,
        createdAt: row.created_at,
      }))
    },
    enabled: Boolean(prospectId),
  })
}

export function useAddProspectTag() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { prospectId: string; tag: string }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('prospect_tags').insert({ prospect_id: input.prospectId, tag: input.tag })
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'prospect-tags', variables.prospectId] })
    },
  })
}

export function useRemoveProspectTag() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; prospectId: string }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('prospect_tags').delete().eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'prospect-tags', variables.prospectId] })
    },
  })
}

// --- notes -----------------------------------------------------------------

export interface ProspectNote {
  id: string
  prospectId: string
  authorUserId: string | null
  body: string
  createdAt: string
}

interface ProspectNoteRow {
  id: string
  prospect_id: string
  author_user_id: string | null
  body: string
  created_at: string
}

export function useProspectNotes(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect-notes', prospectId],
    queryFn: async (): Promise<ProspectNote[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('prospect_notes')
        .select('id, prospect_id, author_user_id, body, created_at')
        .eq('prospect_id', prospectId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as ProspectNoteRow[]).map((row) => ({
        id: row.id,
        prospectId: row.prospect_id,
        authorUserId: row.author_user_id,
        body: row.body,
        createdAt: row.created_at,
      }))
    },
    enabled: Boolean(prospectId),
  })
}

export function useAddProspectNote() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { prospectId: string; body: string }) => {
      const supabase = getSupabaseClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('prospect_notes')
        .insert({ prospect_id: input.prospectId, body: input.body, author_user_id: user?.id ?? null })
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'prospect-notes', variables.prospectId] })
    },
  })
}

// --- outreach ------------------------------------------------------------------

export interface ProspectOutreachEntry {
  id: string
  prospectId: string
  channel: ProspectOutreachChannel
  direction: ProspectOutreachDirection
  summary: string | null
  occurredAt: string
  loggedBy: string | null
}

interface ProspectOutreachRow {
  id: string
  prospect_id: string
  channel: ProspectOutreachChannel
  direction: ProspectOutreachDirection
  summary: string | null
  occurred_at: string
  logged_by: string | null
}

export function useProspectOutreach(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect-outreach', prospectId],
    queryFn: async (): Promise<ProspectOutreachEntry[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('prospect_outreach')
        .select('id, prospect_id, channel, direction, summary, occurred_at, logged_by')
        .eq('prospect_id', prospectId)
        .order('occurred_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as ProspectOutreachRow[]).map((row) => ({
        id: row.id,
        prospectId: row.prospect_id,
        channel: row.channel,
        direction: row.direction,
        summary: row.summary,
        occurredAt: row.occurred_at,
        loggedBy: row.logged_by,
      }))
    },
    enabled: Boolean(prospectId),
  })
}

export function useAddProspectOutreach() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      prospectId: string
      channel: ProspectOutreachChannel
      direction: ProspectOutreachDirection
      summary: string | null
    }) => {
      const supabase = getSupabaseClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase.from('prospect_outreach').insert({
        prospect_id: input.prospectId,
        channel: input.channel,
        direction: input.direction,
        summary: input.summary,
        logged_by: user?.id ?? null,
      })
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'prospect-outreach', variables.prospectId] })
    },
  })
}

// --- duplicates involving a single prospect -------------------------------

export interface ProspectDuplicateCandidate {
  id: string
  prospectId: string
  duplicateOfProspectId: string
  confidence: number
  reason: string
  status: 'pending' | 'confirmed_duplicate' | 'confirmed_distinct'
  createdAt: string
}

interface ProspectDuplicateRow {
  id: string
  prospect_id: string
  duplicate_of_prospect_id: string
  confidence: number
  reason: string
  status: 'pending' | 'confirmed_duplicate' | 'confirmed_distinct'
  created_at: string
}

/** Duplicate candidates where this prospect appears on either side of the pair. */
export function useProspectDuplicateCandidates(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect-duplicate-candidates', prospectId],
    queryFn: async (): Promise<ProspectDuplicateCandidate[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('prospect_duplicates')
        .select('id, prospect_id, duplicate_of_prospect_id, confidence, reason, status, created_at')
        .or(`prospect_id.eq.${prospectId},duplicate_of_prospect_id.eq.${prospectId}`)
        .order('created_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as ProspectDuplicateRow[]).map((row) => ({
        id: row.id,
        prospectId: row.prospect_id,
        duplicateOfProspectId: row.duplicate_of_prospect_id,
        confidence: row.confidence,
        reason: row.reason,
        status: row.status,
        createdAt: row.created_at,
      }))
    },
    enabled: Boolean(prospectId),
  })
}

// --- suppression -----------------------------------------------------------

/** Adds this prospect to the global Do Not Contact list — prospect_suppressions_sync_prospect also flips prospects.do_not_contact. Platform owner/admin only. */
export function useSuppressProspect() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { prospectId: string; reason: string }) => {
      const supabase = getSupabaseClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('prospect_suppressions')
        .insert({ scope: 'prospect', prospect_id: input.prospectId, reason: input.reason, created_by: user?.id ?? null })
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'prospect', variables.prospectId] })
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'prospects'] })
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'suppressions'] })
    },
  })
}

/** Primary location (city/country) for many prospects at once — used alongside useProspectsByIds by the Duplicates page. */
export function useProspectPrimaryLocationsByIds(ids: string[]) {
  return useQuery({
    queryKey: ['acquisition', 'primary-locations-by-ids', [...ids].sort()],
    queryFn: async (): Promise<Map<string, ProspectLocation>> => {
      if (ids.length === 0) return new Map()
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('prospect_locations').select(LOCATION_COLUMNS).in('prospect_id', ids).eq('is_primary', true)
      if (error) throw error
      const map = new Map<string, ProspectLocation>()
      for (const row of (data ?? []) as ProspectLocationRow[]) map.set(row.prospect_id, mapLocation(row))
      return map
    },
    enabled: ids.length > 0,
  })
}

/** Lightweight name/type lookup for many prospects at once — used by the Duplicates page to show both sides of a candidate pair. */
export function useProspectsByIds(ids: string[]) {
  return useQuery({
    queryKey: ['acquisition', 'prospects-by-ids', [...ids].sort()],
    queryFn: async (): Promise<Map<string, Prospect>> => {
      if (ids.length === 0) return new Map()
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('prospects').select(PROSPECT_COLUMNS).in('id', ids)
      if (error) throw error
      const map = new Map<string, Prospect>()
      for (const row of (data ?? []) as ProspectRow[]) map.set(row.id, mapProspect(row))
      return map
    },
    enabled: ids.length > 0,
  })
}
