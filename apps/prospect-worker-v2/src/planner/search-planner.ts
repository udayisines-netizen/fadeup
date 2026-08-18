import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import {
  assessSaturation,
  estimatedCostUsd,
  keywordVariantsFor,
  providerResultLimit,
  subdivideCell,
  type GeoCell,
} from './partition.js'

/**
 * The adaptive search planner.
 *
 * Turns one operator request ("barbers in Paris") into a bounded tree of
 * per-provider, per-geography, per-keyword partitions, subdividing only
 * where a provider truncated its answer AND the partition is still
 * yielding new businesses.
 *
 * Every hard limit (depth, partitions, requests, runtime) is checked HERE
 * and re-asserted by the database trigger on prospect_search_partitions —
 * belt and braces, because a runaway planner spends real money.
 */

export interface SearchRequest {
  id: string
  country: string
  region: string | null
  city: string | null
  postalCode: string | null
  latitude: number | null
  longitude: number | null
  radiusKm: number | null
  entityType: 'barbershop' | 'independent_barber' | 'both'
  keywords: string[]
  sourceKeys: string[]
  maxResults: number | null
  maxDepth: number
  maxPartitions: number
  maxRequests: number
  maxRuntimeSeconds: number
}

export interface PlannedPartition {
  id: string
  searchId: string
  parentPartitionId: string | null
  sourceKey: string
  query: string | null
  country: string
  region: string | null
  city: string | null
  postalCode: string | null
  cell: GeoCell | null
  depth: number
}

export interface PartitionOutcome {
  rawResults: number
  uniqueResults: number
  duplicateResults: number
  requests: number
  retries: number
  durationMs: number
  providerReportedMore: boolean
  error?: string
}

export interface PlannerBudget {
  partitionsCreated: number
  requestsUsed: number
  startedAtMs: number
}

export class SearchPlanner {
  private readonly budget: PlannerBudget

  constructor(
    private readonly pool: DbPool,
    private readonly request: SearchRequest,
    private readonly log: Logger,
  ) {
    this.budget = { partitionsCreated: 0, requestsUsed: 0, startedAtMs: Date.now() }
  }

  /**
   * Builds the root partitions: the cartesian product of
   * (selected sources x keyword variants), each covering the whole search
   * area at depth 0. Subdivision then happens per-partition, lazily, only
   * where saturation warrants it.
   */
  async planRootPartitions(): Promise<PlannedPartition[]> {
    const keywords = keywordVariantsFor(this.request.country, this.request.keywords)
    const rootCell = this.rootCell()
    const planned: PlannedPartition[] = []

    for (const sourceKey of this.request.sourceKeys) {
      // Overpass/Sirene are area/registry queries rather than keyword
      // searches — fanning them across keyword variants would issue N
      // identical requests. One root partition each is correct.
      const sourceKeywords = sourceKey === 'osm' || sourceKey === 'sirene' ? [null] : keywords

      for (const keyword of sourceKeywords) {
        if (!this.hasPartitionBudget()) {
          this.log.warn('planner: partition budget exhausted while planning roots', {
            search_id: this.request.id,
            created: this.budget.partitionsCreated,
          })
          return planned
        }

        const partition = await this.createPartition({
          parentPartitionId: null,
          sourceKey,
          query: keyword,
          cell: rootCell,
          depth: 0,
        })
        if (partition) planned.push(partition)
      }
    }

    return planned
  }

  /**
   * Records a partition's outcome and, when justified, creates its
   * children. Returns the children so the caller can enqueue them.
   */
  async completePartition(partition: PlannedPartition, outcome: PartitionOutcome): Promise<PlannedPartition[]> {
    const verdict = assessSaturation({
      rawResults: outcome.rawResults,
      providerResultLimit: providerResultLimit(partition.sourceKey),
      providerReportedMore: outcome.providerReportedMore,
      uniqueResults: outcome.uniqueResults,
    })

    this.budget.requestsUsed += outcome.requests

    const canSubdivide =
      verdict.shouldSubdivide &&
      partition.cell !== null &&
      partition.depth < this.request.maxDepth &&
      this.hasPartitionBudget() &&
      this.hasRequestBudget() &&
      !this.isOutOfTime()

    await this.pool.query(
      `update public.prospect_search_partitions
       set status = $2::public.prospect_search_partition_status,
           raw_results = $3,
           unique_results = $4,
           duplicate_results = $5,
           requests = $6,
           retries = $7,
           duration_ms = $8,
           saturated = $9,
           estimated_cost_usd = $10,
           error = $11,
           completed_at = now()
       where id = $1`,
      [
        partition.id,
        outcome.error ? 'failed' : canSubdivide ? 'subdivided' : verdict.saturated ? 'saturated' : 'completed',
        outcome.rawResults,
        outcome.uniqueResults,
        outcome.duplicateResults,
        outcome.requests,
        outcome.retries,
        outcome.durationMs,
        verdict.saturated,
        estimatedCostUsd(partition.sourceKey, outcome.requests),
        outcome.error ?? null,
      ],
    )

    this.log.debug('planner: partition completed', {
      search_id: this.request.id,
      partition_id: partition.id,
      provider: partition.sourceKey,
      depth: partition.depth,
      raw: outcome.rawResults,
      unique: outcome.uniqueResults,
      saturation: verdict.reason,
      subdividing: canSubdivide,
    })

    if (!canSubdivide || partition.cell === null) return []

    const children: PlannedPartition[] = []
    for (const childCell of subdivideCell(partition.cell)) {
      if (!this.hasPartitionBudget()) break
      const child = await this.createPartition({
        parentPartitionId: partition.id,
        sourceKey: partition.sourceKey,
        query: partition.query,
        cell: childCell,
        depth: partition.depth + 1,
      })
      if (child) children.push(child)
    }

    return children
  }

  /** True while the search is still inside every hard limit. */
  canContinue(): boolean {
    return this.hasPartitionBudget() && this.hasRequestBudget() && !this.isOutOfTime()
  }

  limitReport(): Record<string, unknown> {
    return {
      partitions_created: this.budget.partitionsCreated,
      max_partitions: this.request.maxPartitions,
      requests_used: this.budget.requestsUsed,
      max_requests: this.request.maxRequests,
      elapsed_seconds: Math.round((Date.now() - this.budget.startedAtMs) / 1000),
      max_runtime_seconds: this.request.maxRuntimeSeconds,
    }
  }

  private hasPartitionBudget(): boolean {
    return this.budget.partitionsCreated < this.request.maxPartitions
  }

  private hasRequestBudget(): boolean {
    return this.budget.requestsUsed < this.request.maxRequests
  }

  private isOutOfTime(): boolean {
    return Date.now() - this.budget.startedAtMs > this.request.maxRuntimeSeconds * 1000
  }

  /**
   * The area the search covers at depth 0. An explicit lat/lon+radius wins;
   * otherwise the search is administrative (country/region/city) and has no
   * cell, which is exactly why such a partition can never be subdivided —
   * there is no geometry to split.
   */
  private rootCell(): GeoCell | null {
    if (this.request.latitude === null || this.request.longitude === null) return null
    return {
      centerLatitude: this.request.latitude,
      centerLongitude: this.request.longitude,
      radiusKm: this.request.radiusKm ?? 5,
    }
  }

  private async createPartition(input: {
    parentPartitionId: string | null
    sourceKey: string
    query: string | null
    cell: GeoCell | null
    depth: number
  }): Promise<PlannedPartition | null> {
    try {
      const result = await this.pool.query<{ id: string }>(
        `insert into public.prospect_search_partitions
           (search_id, parent_partition_id, source_key, query, country, region, city, postal_code,
            center_latitude, center_longitude, radius_km, depth, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'planned')
         returning id`,
        [
          this.request.id,
          input.parentPartitionId,
          input.sourceKey,
          input.query,
          this.request.country,
          this.request.region,
          this.request.city,
          this.request.postalCode,
          input.cell?.centerLatitude ?? null,
          input.cell?.centerLongitude ?? null,
          input.cell?.radiusKm ?? null,
          input.depth,
        ],
      )

      const id = result.rows[0]?.id
      if (!id) return null

      this.budget.partitionsCreated++

      return {
        id,
        searchId: this.request.id,
        parentPartitionId: input.parentPartitionId,
        sourceKey: input.sourceKey,
        query: input.query,
        country: this.request.country,
        region: this.request.region,
        city: this.request.city,
        postalCode: this.request.postalCode,
        cell: input.cell,
        depth: input.depth,
      }
    } catch (error) {
      // The database enforces max_partitions/max_depth independently. A
      // rejection here means the planner tried to exceed a limit — log it
      // and stop growing the tree rather than failing the whole search.
      this.log.warn('planner: partition rejected by database limits', {
        search_id: this.request.id,
        depth: input.depth,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }
}

/** Loads a search row into the planner's request shape. */
export async function loadSearchRequest(pool: DbPool, searchId: string): Promise<SearchRequest | null> {
  const result = await pool.query<{
    id: string
    country: string
    region: string | null
    city: string | null
    postal_code: string | null
    latitude: number | null
    longitude: number | null
    radius_km: string | null
    entity_type: string
    keywords: string[]
    source_keys: string[]
    max_results: number | null
    max_depth: number
    max_partitions: number
    max_requests: number
    max_runtime_seconds: number
  }>(
    `select id, country, region, city, postal_code, latitude, longitude, radius_km, entity_type,
            keywords, source_keys, max_results, max_depth, max_partitions, max_requests, max_runtime_seconds
     from public.prospect_searches where id = $1`,
    [searchId],
  )

  const row = result.rows[0]
  if (!row) return null

  return {
    id: row.id,
    country: row.country,
    region: row.region,
    city: row.city,
    postalCode: row.postal_code,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusKm: row.radius_km === null ? null : Number(row.radius_km),
    entityType: row.entity_type as SearchRequest['entityType'],
    keywords: row.keywords ?? [],
    sourceKeys: row.source_keys ?? [],
    maxResults: row.max_results,
    maxDepth: row.max_depth,
    maxPartitions: row.max_partitions,
    maxRequests: row.max_requests,
    maxRuntimeSeconds: row.max_runtime_seconds,
  }
}
