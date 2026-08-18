import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * Competitor (booking-provider) intelligence.
 *
 * Source of truth: db/migrations/20260818100000_prospect_competitor_intelligence.sql
 * (public.booking_providers, public.booking_provider_observations) and the
 * public.competitor_analytics view.
 *
 * Everything here is FadeUp-internal acquisition data, readable only by
 * platform staff — RLS on those tables is what enforces it, not this file.
 */

/** The 16 seeded registry keys. Extensible: the table is the source of truth, this type is the convenience mirror. */
export type BookingProviderKey =
  | 'PLANITY'
  | 'BOOKSY'
  | 'FRESHA'
  | 'TREATWELL'
  | 'KIUTE'
  | 'RESERVIO'
  | 'SUMUP_BOOKINGS'
  | 'SQUIRE'
  | 'PHOREST'
  | 'SALONIZED'
  | 'TIMIFY'
  | 'TIMELY'
  | 'CUSTOM_BOOKING'
  | 'OTHER'
  | 'NO_BOOKING'
  | 'UNKNOWN'

export type BookingProviderDetectionMethod =
  | 'booking_url'
  | 'outbound_link'
  | 'embedded_widget'
  | 'iframe_domain'
  | 'script_domain'
  | 'booking_button_target'
  | 'structured_data'
  | 'domain_pattern'
  | 'provider_directory'
  | 'manual_override'

export interface BookingProvider {
  id: string
  key: string
  displayName: string
  homepageUrl: string | null
  primaryMarkets: string[]
  isSentinel: boolean
  /** null = not yet assessed. Never treat null as permission to use it as a discovery source. */
  supportsCompliantDiscovery: boolean | null
  discoveryNotes: string | null
  isActive: boolean
}

interface BookingProviderRow {
  id: string
  key: string
  display_name: string
  homepage_url: string | null
  primary_markets: string[] | null
  is_sentinel: boolean
  supports_compliant_discovery: boolean | null
  discovery_notes: string | null
  is_active: boolean
}

function mapProvider(row: BookingProviderRow): BookingProvider {
  return {
    id: row.id,
    key: row.key,
    displayName: row.display_name,
    homepageUrl: row.homepage_url,
    primaryMarkets: row.primary_markets ?? [],
    isSentinel: row.is_sentinel,
    supportsCompliantDiscovery: row.supports_compliant_discovery,
    discoveryNotes: row.discovery_notes,
    isActive: row.is_active,
  }
}

const PROVIDER_COLUMNS =
  'id, key, display_name, homepage_url, primary_markets, is_sentinel, supports_compliant_discovery, discovery_notes, is_active'

export function useBookingProviders() {
  return useQuery({
    queryKey: ['acquisition', 'booking-providers'],
    queryFn: async (): Promise<BookingProvider[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('booking_providers').select(PROVIDER_COLUMNS).order('key')
      if (error) throw error
      return ((data ?? []) as BookingProviderRow[]).map(mapProvider)
    },
  })
}

export interface CompetitorAnalyticsRow {
  providerId: string
  providerKey: string
  displayName: string
  isSentinel: boolean
  discovered: number
  qualified: number
  contacted: number
  replied: number
  positiveReply: number
  claimed: number
  activated: number
  paid: number
  avgMigrationScore: number | null
  avgFitScore: number | null
}

interface CompetitorAnalyticsDbRow {
  provider_id: string
  provider_key: string
  display_name: string
  is_sentinel: boolean
  discovered: number
  qualified: number
  contacted: number
  replied: number
  positive_reply: number
  claimed: number
  activated: number
  paid: number
  avg_migration_score: number | null
  avg_fit_score: number | null
}

/**
 * Per-competitor discovery -> paid funnel, computed live from real rows by
 * public.competitor_analytics. No percentage in this UI is hardcoded.
 */
export function useCompetitorAnalytics() {
  return useQuery({
    queryKey: ['acquisition', 'competitor-analytics'],
    queryFn: async (): Promise<CompetitorAnalyticsRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('competitor_analytics').select('*')
      if (error) throw error
      return ((data ?? []) as CompetitorAnalyticsDbRow[]).map((row) => ({
        providerId: row.provider_id,
        providerKey: row.provider_key,
        displayName: row.display_name,
        isSentinel: row.is_sentinel,
        discovered: row.discovered ?? 0,
        qualified: row.qualified ?? 0,
        contacted: row.contacted ?? 0,
        replied: row.replied ?? 0,
        positiveReply: row.positive_reply ?? 0,
        claimed: row.claimed ?? 0,
        activated: row.activated ?? 0,
        paid: row.paid ?? 0,
        avgMigrationScore: row.avg_migration_score,
        avgFitScore: row.avg_fit_score,
      }))
    },
  })
}

export interface BookingProviderObservation {
  id: string
  providerKey: string
  providerDisplayName: string
  detectionMethod: BookingProviderDetectionMethod
  evidence: string | null
  evidenceUrl: string | null
  confidence: number
  observedAt: string
  firstSeenAt: string
  lastSeenAt: string
  isCurrent: boolean
}

interface ObservationRow {
  id: string
  detection_method: string
  evidence: string | null
  evidence_url: string | null
  confidence: number
  observed_at: string
  first_seen_at: string
  last_seen_at: string
  is_current: boolean
  booking_providers: { key: string; display_name: string } | null
}

/**
 * The full competitor HISTORY for one prospect, newest first — the
 * Planity -> Booksy -> FadeUp trail that makes migration intelligence
 * possible (spec §13).
 */
export function useProspectBookingProviderHistory(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect', prospectId, 'booking-providers'],
    enabled: Boolean(prospectId),
    queryFn: async (): Promise<BookingProviderObservation[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('booking_provider_observations')
        .select(
          'id, detection_method, evidence, evidence_url, confidence, observed_at, first_seen_at, last_seen_at, is_current, booking_providers(key, display_name)',
        )
        .eq('prospect_id', prospectId!)
        .order('is_current', { ascending: false })
        .order('last_seen_at', { ascending: false })
      if (error) throw error

      return ((data ?? []) as unknown as ObservationRow[]).map((row) => ({
        id: row.id,
        providerKey: row.booking_providers?.key ?? 'UNKNOWN',
        providerDisplayName: row.booking_providers?.display_name ?? 'Unknown',
        detectionMethod: row.detection_method as BookingProviderDetectionMethod,
        evidence: row.evidence,
        evidenceUrl: row.evidence_url,
        confidence: Number(row.confidence),
        observedAt: row.observed_at,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        isCurrent: row.is_current,
      }))
    },
  })
}

/**
 * Human override of a prospect's detected competitor (spec §72). Recorded
 * as a normal observation with detection_method = 'manual_override', so the
 * history stays uniform and the override is auditable.
 */
export function useOverrideProspectBookingProvider() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { prospectId: string; providerKey: string; note?: string }) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('override_prospect_booking_provider', {
        p_prospect_id: input.prospectId,
        p_provider_key: input.providerKey,
        p_note: input.note ?? null,
      })
      if (error) throw error
      return data
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'prospect', variables.prospectId] })
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'competitor-analytics'] })
    },
  })
}

/** Prospect counts per competitor, for the segment/filter sidebars. */
export function useCompetitorProspectCounts() {
  return useQuery({
    queryKey: ['acquisition', 'competitor-counts'],
    queryFn: async (): Promise<Record<string, number>> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('competitor_analytics').select('provider_key, discovered')
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const row of (data ?? []) as { provider_key: string; discovered: number }[]) {
        counts[row.provider_key] = row.discovered ?? 0
      }
      return counts
    },
  })
}
