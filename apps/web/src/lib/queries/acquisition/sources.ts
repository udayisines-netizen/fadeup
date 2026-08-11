import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import type { ProspectSourceKey } from './types'

export interface ProspectSource {
  id: string
  key: ProspectSourceKey
  displayName: string
  isEnabled: boolean
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

interface ProspectSourceRow {
  id: string
  key: string
  display_name: string
  is_enabled: boolean
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

function mapSource(row: ProspectSourceRow): ProspectSource {
  return {
    id: row.id,
    key: row.key as ProspectSourceKey,
    displayName: row.display_name,
    isEnabled: row.is_enabled,
    config: row.config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SOURCE_COLUMNS = 'id, key, display_name, is_enabled, config, created_at, updated_at'

/** The 6 registered discovery/enrichment adapters — readable by any platform role. */
export function useProspectSources() {
  return useQuery({
    queryKey: ['acquisition', 'sources'],
    queryFn: async (): Promise<ProspectSource[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('prospect_sources').select(SOURCE_COLUMNS).order('key', { ascending: true })
      if (error) throw error
      return ((data ?? []) as ProspectSourceRow[]).map(mapSource)
    },
  })
}

export interface ApiSourceHealth {
  sourceId: string
  requestsToday: number
  requestsThisMonth: number
  successCount: number
  failureCount: number
  rateLimitedCount: number
  avgLatencyMs: number | null
  lastRequestAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  isPaused: boolean
  pausedReason: string | null
}

interface ApiSourceHealthRow {
  source_id: string
  requests_today: number
  requests_this_month: number
  success_count: number
  failure_count: number
  rate_limited_count: number
  avg_latency_ms: number | null
  last_request_at: string | null
  last_success_at: string | null
  last_failure_at: string | null
  last_error: string | null
  is_paused: boolean
  paused_reason: string | null
}

function mapHealth(row: ApiSourceHealthRow): ApiSourceHealth {
  return {
    sourceId: row.source_id,
    requestsToday: row.requests_today,
    requestsThisMonth: row.requests_this_month,
    successCount: row.success_count,
    failureCount: row.failure_count,
    rateLimitedCount: row.rate_limited_count,
    avgLatencyMs: row.avg_latency_ms,
    lastRequestAt: row.last_request_at,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    lastError: row.last_error,
    isPaused: row.is_paused,
    pausedReason: row.paused_reason,
  }
}

const HEALTH_COLUMNS =
  'source_id, requests_today, requests_this_month, success_count, failure_count, rate_limited_count, avg_latency_ms, last_request_at, last_success_at, last_failure_at, last_error, is_paused, paused_reason'

/** Rolling per-source counters + pause state. One row per source (seeded 1:1 with prospect_sources). */
export function useApiSourceHealth() {
  return useQuery({
    queryKey: ['acquisition', 'source-health'],
    queryFn: async (): Promise<ApiSourceHealth[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('api_source_health').select(HEALTH_COLUMNS)
      if (error) throw error
      return ((data ?? []) as ApiSourceHealthRow[]).map(mapHealth)
    },
  })
}

export interface ApiSourceLimits {
  sourceId: string
  maxRequestsPerMinute: number | null
  maxRequestsPerDay: number | null
  maxRequestsPerMonth: number | null
}

interface ApiSourceLimitsRow {
  source_id: string
  max_requests_per_minute: number | null
  max_requests_per_day: number | null
  max_requests_per_month: number | null
}

/** Configured request budgets per source — informational in V1 (editing limits is not yet exposed). */
export function useApiSourceLimits() {
  return useQuery({
    queryKey: ['acquisition', 'source-limits'],
    queryFn: async (): Promise<ApiSourceLimits[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('api_source_limits')
        .select('source_id, max_requests_per_minute, max_requests_per_day, max_requests_per_month')
      if (error) throw error
      return ((data ?? []) as ApiSourceLimitsRow[]).map((row) => ({
        sourceId: row.source_id,
        maxRequestsPerMinute: row.max_requests_per_minute,
        maxRequestsPerDay: row.max_requests_per_day,
        maxRequestsPerMonth: row.max_requests_per_month,
      }))
    },
  })
}

/** Toggles a source on/off for discovery/enrichment. Platform owner/admin only (RLS + RPC-level check). */
export function useSetProspectSourceEnabled() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { key: ProspectSourceKey; enabled: boolean }) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('set_prospect_source_enabled', { p_key: input.key, p_enabled: input.enabled })
      if (error) throw error
      return data as ProspectSourceRow
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'sources'] })
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'overview'] })
    },
  })
}

/** Manual pause/resume override, independent of the automatic budget-based pause. Platform owner/admin only. */
export function useSetProspectSourcePaused() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { key: ProspectSourceKey; paused: boolean; reason?: string | null }) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('set_prospect_source_paused', {
        p_key: input.key,
        p_paused: input.paused,
        p_reason: input.reason ?? null,
      })
      if (error) throw error
      return data as ApiSourceHealthRow
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'source-health'] })
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'overview'] })
    },
  })
}
