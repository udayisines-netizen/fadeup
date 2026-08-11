import { useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import {
  PROSPECT_PIPELINE_STAGES,
  PROSPECT_SCORE_BUCKETS,
  PROSPECT_TYPES,
  type ProspectPipelineStage,
  type ProspectScoreBucket,
  type ProspectType,
} from './types'

/**
 * PostgREST here runs with db-aggregates-enabled=false (the default), so
 * `select=col,count()` group-by shortcuts are not available — every count
 * below is a real, exact `count: 'exact', head: true` query (no rows
 * transferred, just a count), run in parallel. Nothing on this page is a
 * placeholder number: a metric this file doesn't compute is simply not
 * shown, per CLAUDE.md's "never fabricate data" rule.
 */

/** Unwraps a `{ count, error }` head-count response into a plain number, throwing on error. */
function readCount({ count, error }: { count: number | null; error: { message: string } | null }): number {
  if (error) throw error
  return count ?? 0
}

export interface AcquisitionCityCount {
  country: string
  city: string
  count: number
}

export interface AcquisitionSourceCount {
  sourceId: string
  key: string
  displayName: string
  prospectCount: number
}

export interface AcquisitionSourceHealthSummary {
  sourceId: string
  key: string
  displayName: string
  isPaused: boolean
  pausedReason: string | null
  failureCount: number
  successCount: number
}

export interface AcquisitionOverviewStats {
  totalProspects: number
  discoveredToday: number
  byType: Record<ProspectType, number>
  byScoreBucket: Record<ProspectScoreBucket, number>
  unscoredCount: number
  topCities: AcquisitionCityCount[]
  bySource: AcquisitionSourceCount[]
  jobCounts: { queued: number; running: number; failed: number }
  sourceHealth: AcquisitionSourceHealthSummary[]
}

function startOfTodayIso(): string {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.toISOString()
}

export function useAcquisitionOverview() {
  return useQuery({
    queryKey: ['acquisition', 'overview'],
    queryFn: async (): Promise<AcquisitionOverviewStats> => {
      const supabase = getSupabaseClient()

      const [
        totalProspectsRes,
        discoveredTodayRes,
        byTypeResults,
        byBucketResults,
        unscoredCountRes,
        queuedCountRes,
        runningCountRes,
        failedCountRes,
        locationsRes,
        sourceRecordsRes,
        sourcesRes,
        healthRes,
      ] = await Promise.all([
        supabase.from('prospects').select('id', { count: 'exact', head: true }),
        supabase.from('prospects').select('id', { count: 'exact', head: true }).gte('created_at', startOfTodayIso()),
        Promise.all(PROSPECT_TYPES.map((type) => supabase.from('prospects').select('id', { count: 'exact', head: true }).eq('type', type))),
        Promise.all(
          PROSPECT_SCORE_BUCKETS.map((bucket) =>
            supabase.from('prospects').select('id', { count: 'exact', head: true }).eq('current_score_bucket', bucket),
          ),
        ),
        supabase.from('prospects').select('id', { count: 'exact', head: true }).is('current_score_bucket', null),
        supabase.from('prospect_jobs').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
        supabase.from('prospect_jobs').select('id', { count: 'exact', head: true }).eq('status', 'running'),
        supabase.from('prospect_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
        supabase.from('prospect_locations').select('country, city').eq('is_primary', true).not('city', 'is', null).limit(1000),
        supabase.from('prospect_source_records').select('source_id, prospect_id').not('prospect_id', 'is', null).limit(1000),
        supabase.from('prospect_sources').select('id, key, display_name'),
        supabase.from('api_source_health').select('source_id, is_paused, paused_reason, failure_count, success_count'),
      ])

      const totalProspects = readCount(totalProspectsRes)
      const discoveredToday = readCount(discoveredTodayRes)
      const byTypeCounts = byTypeResults.map(readCount)
      const byBucketCounts = byBucketResults.map(readCount)
      const unscoredCount = readCount(unscoredCountRes)
      const queuedCount = readCount(queuedCountRes)
      const runningCount = readCount(runningCountRes)
      const failedCount = readCount(failedCountRes)

      if (locationsRes.error) throw locationsRes.error
      if (sourceRecordsRes.error) throw sourceRecordsRes.error
      if (sourcesRes.error) throw sourcesRes.error
      if (healthRes.error) throw healthRes.error

      const byType = Object.fromEntries(PROSPECT_TYPES.map((type, index) => [type, byTypeCounts[index]])) as Record<ProspectType, number>
      const byScoreBucket = Object.fromEntries(
        PROSPECT_SCORE_BUCKETS.map((bucket, index) => [bucket, byBucketCounts[index]]),
      ) as Record<ProspectScoreBucket, number>

      // Top cities — aggregated client-side from the (capped) location rows above.
      const cityCounts = new Map<string, AcquisitionCityCount>()
      for (const row of (locationsRes.data ?? []) as { country: string; city: string }[]) {
        const city = row.city?.trim()
        if (!city) continue
        const key = `${row.country}:${city}`
        const existing = cityCounts.get(key)
        if (existing) existing.count += 1
        else cityCounts.set(key, { country: row.country, city, count: 1 })
      }
      const topCities = [...cityCounts.values()].sort((a, b) => b.count - a.count).slice(0, 5)

      // Counts by source — distinct prospects per source, aggregated client-side from the (capped) source-record rows above.
      const sources = (sourcesRes.data ?? []) as { id: string; key: string; display_name: string }[]
      const prospectIdsBySource = new Map<string, Set<string>>()
      for (const row of (sourceRecordsRes.data ?? []) as { source_id: string; prospect_id: string }[]) {
        const set = prospectIdsBySource.get(row.source_id) ?? new Set<string>()
        set.add(row.prospect_id)
        prospectIdsBySource.set(row.source_id, set)
      }
      const bySource = sources
        .map((source) => ({
          sourceId: source.id,
          key: source.key,
          displayName: source.display_name,
          prospectCount: prospectIdsBySource.get(source.id)?.size ?? 0,
        }))
        .sort((a, b) => b.prospectCount - a.prospectCount)

      const healthBySourceId = new Map<string, { is_paused: boolean; paused_reason: string | null; failure_count: number; success_count: number }>()
      for (const row of (healthRes.data ?? []) as {
        source_id: string
        is_paused: boolean
        paused_reason: string | null
        failure_count: number
        success_count: number
      }[]) {
        healthBySourceId.set(row.source_id, row)
      }
      const sourceHealth: AcquisitionSourceHealthSummary[] = sources.map((source) => {
        const health = healthBySourceId.get(source.id)
        return {
          sourceId: source.id,
          key: source.key,
          displayName: source.display_name,
          isPaused: health?.is_paused ?? false,
          pausedReason: health?.paused_reason ?? null,
          failureCount: health?.failure_count ?? 0,
          successCount: health?.success_count ?? 0,
        }
      })

      return {
        totalProspects,
        discoveredToday,
        byType,
        byScoreBucket,
        unscoredCount,
        topCities,
        bySource,
        jobCounts: { queued: queuedCount, running: runningCount, failed: failedCount },
        sourceHealth,
      }
    },
  })
}

/** Prospect count per pipeline stage — powers the Pipeline funnel view. Every stage gets an exact count query, even ones with 0 prospects. */
export function useProspectStageCounts() {
  return useQuery({
    queryKey: ['acquisition', 'stage-counts'],
    queryFn: async (): Promise<Record<ProspectPipelineStage, number>> => {
      const supabase = getSupabaseClient()
      const results = await Promise.all(
        PROSPECT_PIPELINE_STAGES.map((stage) => supabase.from('prospects').select('id', { count: 'exact', head: true }).eq('status', stage)),
      )
      const counts = results.map(readCount)
      return Object.fromEntries(PROSPECT_PIPELINE_STAGES.map((stage, index) => [stage, counts[index]])) as Record<
        ProspectPipelineStage,
        number
      >
    },
  })
}
