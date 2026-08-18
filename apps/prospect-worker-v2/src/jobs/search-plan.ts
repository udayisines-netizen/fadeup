import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import type { SourceAdapter } from '../sources/registry.js'
import type { ProspectJob } from '../queue/types.js'
import { isSourcePaused } from '../quota.js'
import { loadSearchRequest, SearchPlanner, type PlannedPartition } from '../planner/search-planner.js'

/**
 * Executes an adaptive multi-provider search.
 *
 * Works a queue of partitions breadth-first: run one, record its outcome,
 * let the planner decide whether to subdivide, append any children. The
 * planner owns every hard limit; this handler owns the execution loop and
 * the per-partition discovery-job fan-out.
 *
 * Each partition becomes a normal `discovery` job rather than being
 * executed inline, so partition work goes through the same claiming,
 * retry, quota-guard and per-source-error-isolation machinery as every
 * other job — no parallel code path with its own bugs.
 */

export interface SearchPlanResult {
  searchId: string
  partitionsPlanned: number
  partitionsExecuted: number
  discoveryJobsCreated: number
  limitReport: Record<string, unknown>
  status: string
}

export async function runSearchPlanJob(
  pool: DbPool,
  job: ProspectJob,
  sources: Map<string, SourceAdapter>,
  log: Logger,
): Promise<SearchPlanResult> {
  const payload = job.payload as Record<string, unknown>
  const searchId = String(payload['searchId'] ?? '')
  if (!searchId) throw new Error('search_plan: payload.searchId is required')

  const request = await loadSearchRequest(pool, searchId)
  if (!request) throw new Error(`search_plan: search ${searchId} not found`)

  await pool.query(
    `update public.prospect_searches set status = 'running', started_at = coalesce(started_at, now()) where id = $1`,
    [searchId],
  )

  const searchLog = log.child({ search_id: searchId })
  const planner = new SearchPlanner(pool, request, searchLog)

  const queue: PlannedPartition[] = await planner.planRootPartitions()
  const result: SearchPlanResult = {
    searchId,
    partitionsPlanned: queue.length,
    partitionsExecuted: 0,
    discoveryJobsCreated: 0,
    limitReport: {},
    status: 'completed',
  }

  while (queue.length > 0) {
    if (!planner.canContinue()) {
      searchLog.warn('search_plan: a hard limit was reached — stopping', planner.limitReport())
      result.status = 'limit_reached'
      break
    }

    const partition = queue.shift()
    if (!partition) break

    const adapter = sources.get(partition.sourceKey)
    if (!adapter || !adapter.isConfigured()) {
      await markPartitionSkipped(pool, partition.id, adapter ? 'source not configured (missing credentials)' : 'unknown source')
      continue
    }

    if (await isSourcePaused(pool, partition.sourceKey)) {
      await markPartitionSkipped(pool, partition.id, 'source paused (manual pause or quota exhausted)')
      continue
    }

    const startedAt = Date.now()
    await pool.query(
      `update public.prospect_search_partitions set status = 'running', started_at = now() where id = $1`,
      [partition.id],
    )

    // Snapshot the prospect count so this partition's UNIQUE contribution
    // is measurable — the number that decides whether subdividing is worth
    // the budget.
    const beforeCount = await countProspects(pool, request.country)

    const discoveryJob = await pool.query<{ id: string }>(
      `insert into public.prospect_jobs (job_type, payload, priority, search_id, partition_id, created_by)
       values ('discovery', $1, 120, $2, $3, $4)
       returning id`,
      [
        JSON.stringify({
          country: partition.country,
          city: partition.city,
          latitude: partition.cell?.centerLatitude,
          longitude: partition.cell?.centerLongitude,
          radiusKm: partition.cell?.radiusKm,
          entityType: request.entityType,
          keywords: partition.query ? [partition.query] : undefined,
          maxCandidates: request.maxResults ?? undefined,
          sourceKeys: [partition.sourceKey],
        }),
        searchId,
        partition.id,
        null,
      ],
    )
    result.discoveryJobsCreated++

    // The discovery job runs asynchronously; this handler records the
    // partition as dispatched with the counts known at dispatch time. The
    // discovery job itself updates raw/unique counts when it completes
    // (see updatePartitionCounts below, called from discovery.ts).
    const afterCount = await countProspects(pool, request.country)

    const children = await planner.completePartition(partition, {
      rawResults: 0,
      uniqueResults: Math.max(0, afterCount - beforeCount),
      duplicateResults: 0,
      requests: 1,
      retries: 0,
      durationMs: Date.now() - startedAt,
      providerReportedMore: false,
    })

    queue.push(...children)
    result.partitionsPlanned += children.length
    result.partitionsExecuted++

    searchLog.debug('search_plan: partition dispatched', {
      partition_id: partition.id,
      provider: partition.sourceKey,
      discovery_job_id: discoveryJob.rows[0]?.id,
      children: children.length,
    })
  }

  result.limitReport = planner.limitReport()

  await pool.query(
    `update public.prospect_searches
     set status = $2,
         completed_at = now(),
         totals = $3
     where id = $1`,
    [searchId, result.status, JSON.stringify({ ...result.limitReport, discovery_jobs: result.discoveryJobsCreated })],
  )

  log.info('search_plan: completed', {
    search_id: searchId,
    partitions: result.partitionsExecuted,
    discovery_jobs: result.discoveryJobsCreated,
    status: result.status,
  })

  return result
}

async function markPartitionSkipped(pool: DbPool, partitionId: string, reason: string): Promise<void> {
  await pool.query(
    `update public.prospect_search_partitions
     set status = 'skipped', error = $2, completed_at = now()
     where id = $1`,
    [partitionId, reason],
  )
}

async function countProspects(pool: DbPool, country: string): Promise<number> {
  const result = await pool.query<{ count: string }>(`select count(*) from public.prospects where country = $1`, [country])
  return Number(result.rows[0]?.count ?? 0)
}

/**
 * Called by the discovery job when it finishes, to write the real raw and
 * unique counts back onto its partition. Keeping this here (rather than in
 * discovery.ts) keeps every partition mutation in the planner's module.
 */
export async function updatePartitionCounts(
  pool: DbPool,
  partitionId: string,
  counts: { rawResults: number; uniqueResults: number; duplicateResults: number; requests: number; durationMs: number },
): Promise<void> {
  await pool.query(
    `update public.prospect_search_partitions
     set raw_results = raw_results + $2,
         unique_results = $3,
         duplicate_results = $4,
         requests = requests + $5,
         duration_ms = coalesce(duration_ms, 0) + $6
     where id = $1`,
    [partitionId, counts.rawResults, counts.uniqueResults, counts.duplicateResults, counts.requests, counts.durationMs],
  )
}
