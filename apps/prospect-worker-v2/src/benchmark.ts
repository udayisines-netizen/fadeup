import { loadConfig } from './config.js'
import { getPool, closePool } from './db.js'
import { logger } from './logger.js'

/**
 * Reproducible acquisition benchmark.
 *
 * Reports what the pipeline ACTUALLY produced, read back from the
 * database — never a projection, never a synthetic number. Where a figure
 * is not measurable (a provider that publishes no per-request price, a
 * rate with no denominator) it reports "n/a" rather than inventing one.
 *
 * Run:
 *   npm run benchmark -- --country FR
 *   npm run benchmark -- --country FR --city Paris --json
 */

interface BenchmarkArgs {
  country: string | null
  city: string | null
  json: boolean
}

function parseArgs(argv: string[]): BenchmarkArgs {
  const args: BenchmarkArgs = { country: null, city: null, json: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--country') args.country = argv[++i] ?? null
    else if (argv[i] === '--city') args.city = argv[++i] ?? null
    else if (argv[i] === '--json') args.json = true
  }
  return args
}

interface SourceBenchmark {
  sourceKey: string
  requests: number
  succeeded: number
  failed: number
  avgLatencyMs: number | null
  rawRecords: number
  /** Prospects where this source is the ONLY contributor — its unique contribution. */
  uniqueProspects: number
  /** Prospects this source contributed to alongside at least one other source. */
  overlapProspects: number
  contactsContributed: number
  competitorDetections: number
  /** Null when the provider publishes no per-request price. */
  estimatedCostUsd: number | null
  costPerUniqueProspect: number | null
}

/** Providers with a published per-request price. Everything else reports null, not zero. */
const PROVIDER_COST_USD: Record<string, number | null> = {
  google_places: 0.032,
  geoapify: null,
  osm: null,
  sirene: null,
  website: null,
  instagram: null,
  competitor_directory: null,
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  const config = loadConfig()
  const pool = getPool(config)

  const geoFilter = args.country
    ? `and p.country = ${literal(args.country)}`
    : ''
  const cityFilter = args.city
    ? `and exists (select 1 from public.prospect_locations pl where pl.prospect_id = p.id and pl.city ilike ${literal(args.city)})`
    : ''

  // --- Overall corpus ---------------------------------------------------
  const overall = await pool.query<{
    total: string
    with_phone: string
    with_email: string
    with_website: string
    with_competitor: string
    booking_unknown: string
    no_booking: string
    on_competitor: string
    hot_fit: string
    migration_candidates: string
    duplicates_pending: string
    review_required: string
  }>(`
    select
      count(*) as total,
      count(*) filter (where p.phone_e164 is not null) as with_phone,
      count(*) filter (where p.email is not null) as with_email,
      count(*) filter (where p.website_url is not null) as with_website,
      count(*) filter (where p.current_booking_provider_id is not null) as with_competitor,
      -- UNKNOWN and NO_BOOKING are reported separately: conflating them is
      -- the single most misleading thing this report could do.
      count(*) filter (where p.current_booking_provider_id is null
                          or bp.key = 'UNKNOWN') as booking_unknown,
      count(*) filter (where bp.key = 'NO_BOOKING') as no_booking,
      count(*) filter (where bp.key is not null
                          and bp.key not in ('NO_BOOKING', 'UNKNOWN', 'CUSTOM_BOOKING')) as on_competitor,
      count(*) filter (where p.fadeup_fit_class = 'HOT') as hot_fit,
      count(*) filter (where p.migration_potential_score >= 70) as migration_candidates,
      (select count(*) from public.prospect_duplicates where status = 'pending') as duplicates_pending,
      (select count(distinct prospect_id) from public.prospect_segments
       where segment_key = 'REVIEW_REQUIRED') as review_required
    from public.prospects p
    left join public.booking_providers bp on bp.id = p.current_booking_provider_id
    where true ${geoFilter} ${cityFilter}
  `)

  const totals = overall.rows[0]!
  const total = Number(totals.total)

  // --- Per source -------------------------------------------------------
  const sources = await pool.query<{
    source_key: string
    requests: string
    succeeded: string
    failed: string
    avg_latency_ms: string | null
    raw_records: string
    unique_prospects: string
    overlap_prospects: string
    contacts_contributed: string
  }>(`
    with source_records as (
      select r.prospect_id, s.key as source_key, r.raw_payload
      from public.prospect_source_records r
      join public.prospect_sources s on s.id = r.source_id
      join public.prospects p on p.id = r.prospect_id
      where true ${geoFilter} ${cityFilter}
    ),
    contributor_counts as (
      select prospect_id, count(distinct source_key) as source_count
      from source_records group by prospect_id
    )
    select
      s.key as source_key,
      coalesce((select count(*) from public.api_usage u where u.source_id = s.id), 0) as requests,
      coalesce((select count(*) from public.api_usage u where u.source_id = s.id and u.success), 0) as succeeded,
      coalesce((select count(*) from public.api_usage u where u.source_id = s.id and not u.success), 0) as failed,
      (select avg(u.latency_ms) from public.api_usage u where u.source_id = s.id) as avg_latency_ms,
      coalesce((select count(*) from source_records sr where sr.source_key = s.key), 0) as raw_records,
      -- The number that actually matters: businesses only this source found.
      coalesce((select count(*) from source_records sr
                join contributor_counts cc on cc.prospect_id = sr.prospect_id
                where sr.source_key = s.key and cc.source_count = 1), 0) as unique_prospects,
      coalesce((select count(*) from source_records sr
                join contributor_counts cc on cc.prospect_id = sr.prospect_id
                where sr.source_key = s.key and cc.source_count > 1), 0) as overlap_prospects,
      coalesce((select count(*) from source_records sr
                where sr.source_key = s.key
                  and (sr.raw_payload ? 'phone' or sr.raw_payload ? 'email')), 0) as contacts_contributed
    from public.prospect_sources s
    order by s.key
  `)

  const competitorDetectionsBySource = await pool.query<{ source_key: string; detections: string }>(`
    select 'website' as source_key, count(*)::text as detections
    from public.booking_provider_observations o
    join public.booking_providers bp on bp.id = o.provider_id
    where bp.key not in ('NO_BOOKING', 'UNKNOWN')
  `)

  const detectionsByKey = new Map(
    competitorDetectionsBySource.rows.map((row) => [row.source_key, Number(row.detections)]),
  )

  const sourceBenchmarks: SourceBenchmark[] = sources.rows.map((row) => {
    const requests = Number(row.requests)
    const uniqueProspects = Number(row.unique_prospects)
    const perRequest = PROVIDER_COST_USD[row.source_key]
    const estimatedCostUsd = perRequest === null || perRequest === undefined ? null : Number((perRequest * requests).toFixed(4))

    return {
      sourceKey: row.source_key,
      requests,
      succeeded: Number(row.succeeded),
      failed: Number(row.failed),
      avgLatencyMs: row.avg_latency_ms === null ? null : Math.round(Number(row.avg_latency_ms)),
      rawRecords: Number(row.raw_records),
      uniqueProspects,
      overlapProspects: Number(row.overlap_prospects),
      contactsContributed: Number(row.contacts_contributed),
      competitorDetections: detectionsByKey.get(row.source_key) ?? 0,
      estimatedCostUsd,
      costPerUniqueProspect:
        estimatedCostUsd === null || uniqueProspects === 0 ? null : Number((estimatedCostUsd / uniqueProspects).toFixed(4)),
    }
  })

  // --- Competitor distribution -----------------------------------------
  const competitors = await pool.query<{ provider_key: string; prospects: string; avg_migration: string | null }>(`
    select bp.key as provider_key, count(p.id)::text as prospects,
           avg(p.migration_potential_score)::text as avg_migration
    from public.booking_providers bp
    join public.prospects p on p.current_booking_provider_id = bp.id
    where true ${geoFilter} ${cityFilter}
    group by bp.key
    order by count(p.id) desc
  `)

  // --- Score distribution ----------------------------------------------
  const scores = await pool.query<{
    score_kind: string
    scored: string
    mean: string | null
    stddev: string | null
    hot: string
    warm: string
    cold: string
  }>(`
    select score_kind, count(*)::text as scored,
           avg(score)::text as mean, stddev_pop(score)::text as stddev,
           count(*) filter (where classification = 'HOT')::text as hot,
           count(*) filter (where classification = 'WARM')::text as warm,
           count(*) filter (where classification = 'COLD')::text as cold
    from public.prospect_fit_scores
    where is_current
    group by score_kind
  `)

  const report: BenchmarkReport = {
    generatedAt: new Date().toISOString(),
    filter: { country: args.country, city: args.city },
    corpus: {
      totalProspects: total,
      contactCompleteness: {
        phone: rate(Number(totals.with_phone), total),
        email: rate(Number(totals.with_email), total),
        website: rate(Number(totals.with_website), total),
      },
      bookingStatus: {
        onCompetitor: Number(totals.on_competitor),
        noBooking: Number(totals.no_booking),
        unknown: Number(totals.booking_unknown),
        competitorDetectionRate: rate(Number(totals.with_competitor), total),
      },
      hotFitProspects: Number(totals.hot_fit),
      migrationCandidates: Number(totals.migration_candidates),
      duplicatesPendingReview: Number(totals.duplicates_pending),
      prospectsNeedingReview: Number(totals.review_required),
    },
    sources: sourceBenchmarks,
    competitors: competitors.rows.map((row) => ({
      providerKey: row.provider_key,
      prospects: Number(row.prospects),
      avgMigrationScore: row.avg_migration === null ? null : Math.round(Number(row.avg_migration)),
    })),
    scores: scores.rows.map((row) => ({
      scoreKind: row.score_kind,
      scored: Number(row.scored),
      mean: row.mean === null ? null : Number(Number(row.mean).toFixed(2)),
      stddev: row.stddev === null ? null : Number(Number(row.stddev).toFixed(2)),
      hot: Number(row.hot),
      warm: Number(row.warm),
      cold: Number(row.cold),
      // The pathological-scoring detector from the spec: a score that
      // stops separating prospects is worse than no score.
      lowDiscrimination: row.stddev !== null && Number(row.stddev) < 5 && Number(row.scored) >= 50,
    })),
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    printHuman(report)
  }

  await closePool()
  return 0
}

interface BenchmarkReport {
  generatedAt: string
  filter: { country: string | null; city: string | null }
  corpus: {
    totalProspects: number
    contactCompleteness: { phone: string; email: string; website: string }
    bookingStatus: {
      onCompetitor: number
      noBooking: number
      unknown: number
      competitorDetectionRate: string
    }
    hotFitProspects: number
    migrationCandidates: number
    duplicatesPendingReview: number
    prospectsNeedingReview: number
  }
  sources: SourceBenchmark[]
  competitors: { providerKey: string; prospects: number; avgMigrationScore: number | null }[]
  scores: {
    scoreKind: string
    scored: number
    mean: number | null
    stddev: number | null
    hot: number
    warm: number
    cold: number
    lowDiscrimination: boolean
  }[]
}

function printHuman(report: BenchmarkReport): void {
  const { corpus, filter } = report

  const scope = [filter.country, filter.city].filter(Boolean).join(' / ') || 'all markets'

  process.stdout.write(`\nFadeUp acquisition benchmark — ${scope}\n`)
  process.stdout.write(`${'='.repeat(72)}\n\n`)

  process.stdout.write(`Prospects:                 ${corpus.totalProspects}\n`)
  process.stdout.write(`  with phone               ${corpus.contactCompleteness.phone}\n`)
  process.stdout.write(`  with email               ${corpus.contactCompleteness.email}\n`)
  process.stdout.write(`  with website             ${corpus.contactCompleteness.website}\n\n`)

  process.stdout.write('Booking status:\n')
  process.stdout.write(`  on a competitor          ${corpus.bookingStatus.onCompetitor}\n`)
  process.stdout.write(`  no online booking        ${corpus.bookingStatus.noBooking}   (observed absence)\n`)
  process.stdout.write(`  UNKNOWN                  ${corpus.bookingStatus.unknown}   (not yet determined — NOT the same as none)\n`)
  process.stdout.write(`  detection coverage       ${corpus.bookingStatus.competitorDetectionRate}\n\n`)

  process.stdout.write(`HOT fit prospects:         ${corpus.hotFitProspects}\n`)
  process.stdout.write(`Migration candidates:      ${corpus.migrationCandidates}\n`)
  process.stdout.write(`Duplicates pending review: ${corpus.duplicatesPendingReview}\n`)
  process.stdout.write(`Needing human review:      ${corpus.prospectsNeedingReview}\n\n`)

  process.stdout.write('Per source\n')
  process.stdout.write(`${'-'.repeat(72)}\n`)
  process.stdout.write(
    `${'source'.padEnd(22)}${'req'.padStart(7)}${'raw'.padStart(8)}${'unique'.padStart(8)}${'overlap'.padStart(9)}${'cost'.padStart(10)}${'$/uniq'.padStart(9)}\n`,
  )
  for (const source of report.sources) {
    process.stdout.write(
      source.sourceKey.padEnd(22) +
        String(source.requests).padStart(7) +
        String(source.rawRecords).padStart(8) +
        String(source.uniqueProspects).padStart(8) +
        String(source.overlapProspects).padStart(9) +
        (source.estimatedCostUsd === null ? 'n/a' : `$${source.estimatedCostUsd.toFixed(2)}`).padStart(10) +
        (source.costPerUniqueProspect === null ? 'n/a' : `$${source.costPerUniqueProspect.toFixed(3)}`).padStart(9) +
        '\n',
    )
  }
  process.stdout.write('\n  "n/a" means the provider publishes no per-request price, or there is\n')
  process.stdout.write('  no denominator yet — never a fabricated figure.\n\n')

  const { competitors } = report
  if (competitors.length > 0) {
    process.stdout.write('Competitor distribution\n')
    process.stdout.write(`${'-'.repeat(72)}\n`)
    for (const competitor of competitors) {
      process.stdout.write(
        `${competitor.providerKey.padEnd(22)}${String(competitor.prospects).padStart(7)}   avg migration ${
          competitor.avgMigrationScore ?? 'n/a'
        }\n`,
      )
    }
    process.stdout.write('\n')
  }

  const { scores } = report
  if (scores.length > 0) {
    process.stdout.write('Score health\n')
    process.stdout.write(`${'-'.repeat(72)}\n`)
    for (const score of scores) {
      process.stdout.write(
        `${score.scoreKind.padEnd(22)}n=${String(score.scored).padStart(6)}  mean ${String(score.mean ?? 'n/a').padStart(6)}  sd ${String(
          score.stddev ?? 'n/a',
        ).padStart(6)}  HOT/WARM/COLD ${score.hot}/${score.warm}/${score.cold}\n`,
      )
      if (score.lowDiscrimination) {
        process.stdout.write(
          `${' '.repeat(22)}WARNING: standard deviation below 5 — this score is not discriminating between prospects.\n`,
        )
      }
    }
    process.stdout.write('\n')
  }
}

function rate(numerator: number, denominator: number): string {
  if (denominator === 0) return 'n/a'
  return `${numerator} (${((numerator / denominator) * 100).toFixed(1)}%)`
}

/** Minimal SQL literal quoting for the geography filters, which come from argv, not from user input. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    logger.error('benchmark failed', error)
    process.exit(1)
  })
