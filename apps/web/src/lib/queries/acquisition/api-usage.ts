import { useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

export interface ApiUsageEntry {
  id: string
  sourceId: string
  sourceKey: string
  sourceDisplayName: string
  jobId: string | null
  endpoint: string | null
  success: boolean
  statusCode: number | null
  latencyMs: number | null
  error: string | null
  requestedAt: string
}

interface ApiUsageRow {
  id: string
  source_id: string
  job_id: string | null
  endpoint: string | null
  success: boolean
  status_code: number | null
  latency_ms: number | null
  error: string | null
  requested_at: string
}

interface SourceLookupRow {
  id: string
  key: string
  display_name: string
}

const RECENT_USAGE_LIMIT = 50

/** Append-only per-call log, most recent first — see api_usage in the schema migration. */
export function useRecentApiUsage() {
  return useQuery({
    queryKey: ['acquisition', 'api-usage', 'recent'],
    queryFn: async (): Promise<ApiUsageEntry[]> => {
      const supabase = getSupabaseClient()
      const [usageRes, sourcesRes] = await Promise.all([
        supabase
          .from('api_usage')
          .select('id, source_id, job_id, endpoint, success, status_code, latency_ms, error, requested_at')
          .order('requested_at', { ascending: false })
          .limit(RECENT_USAGE_LIMIT),
        supabase.from('prospect_sources').select('id, key, display_name'),
      ])
      if (usageRes.error) throw usageRes.error
      if (sourcesRes.error) throw sourcesRes.error

      const sourceById = new Map<string, SourceLookupRow>()
      for (const row of (sourcesRes.data ?? []) as SourceLookupRow[]) sourceById.set(row.id, row)

      return ((usageRes.data ?? []) as ApiUsageRow[]).map((row) => {
        const source = sourceById.get(row.source_id)
        return {
          id: row.id,
          sourceId: row.source_id,
          sourceKey: source?.key ?? 'unknown',
          sourceDisplayName: source?.display_name ?? 'Unknown source',
          jobId: row.job_id,
          endpoint: row.endpoint,
          success: row.success,
          statusCode: row.status_code,
          latencyMs: row.latency_ms,
          error: row.error,
          requestedAt: row.requested_at,
        }
      })
    },
  })
}
