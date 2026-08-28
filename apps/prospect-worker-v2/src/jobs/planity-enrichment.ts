import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import type { Config } from '../config.js'
import type { ProspectJob } from '../queue/types.js'
import { SourcePausedError } from '../quota.js'
import { PlanityClient, type PlanityFetchOutcome } from '../competitors/planity-client.js'
import { isPlanityEstablishmentUrl, parsePlanityEstablishment, type PlanityEstablishment } from '../competitors/planity.js'
import { matchPlanityEstablishment, type MatchSubject } from '../competitors/planity-match.js'

/**
 * Reads the public Planity page of prospects already known to use Planity, and
 * records what it says.
 *
 * WHERE THE URL COMES FROM, AND WHY THIS JOB DOES NOT SEARCH
 *
 * Candidates are prospects for which website enrichment ALREADY found a link
 * to a Planity establishment page on the business's own site. That is a
 * first-party statement — "this is where you book us" — and it is the only
 * discovery path this job uses.
 *
 * It does not search for Planity pages, because Worker V2 has no general web
 * search capability (its six adapters are two places APIs, a registry, a
 * crawler and Instagram), and introducing one to guess at Planity URLs would
 * be a large, expensive dependency in service of a weaker signal. It does not
 * construct URLs from business names either: that is brute-forcing.
 *
 * WHAT IT ADDS THAT WEBSITE DETECTION CANNOT
 *
 * A link on a business's website proves a RELATIONSHIP with Planity. It cannot
 * say whether the business is actually bookable there — that fact lives on
 * Planity's page, not theirs. This job is what turns
 *
 *     "they use Planity"                    (already known)
 * into
 *     "they use Planity and 67 of their 97 services are bookable online"
 *
 * which is the difference between a migration target and a lapsed listing.
 *
 * TRUTHFUL COUNTERS
 *
 * The result distinguishes selected / attempted / enriched / noResult /
 * skipped / failed, and they mean exactly what they say. In particular
 * `enriched` counts prospects where usable evidence was returned AND matched
 * AND persisted — not prospects the candidate query happened to return. A job
 * that reported its batch size as its achievement would make the whole
 * pipeline unfalsifiable.
 */

export interface PlanityEnrichmentResult {
  /** Returned by the candidate query. */
  selected: number
  /** An HTTP request was actually made against a usable URL. */
  attempted: number
  /** Evidence returned, identity confirmed, and persisted. Only these advance last_enriched_at. */
  enriched: number
  /** The request succeeded but produced nothing usable — including a page that did not corroborate the prospect. */
  noResult: number
  /** Never attempted: source paused, URL unusable, robots refusal. */
  skipped: number
  /** A real transport, parse or persistence failure. */
  failed: number

  /** Operational detail, for logs and the platform source-health view. */
  metrics: PlanityMetrics
}

export interface PlanityMetrics {
  pagesAttempted: number
  pagesMatched: number
  pagesUnmatched: number
  activeDetected: number
  listedOnlyDetected: number
  unknownStatus: number
  parseFailures: number
  http403: number
  http429: number
  challenges: number
  notFound: number
  robotsRefusals: number
}

function emptyMetrics(): PlanityMetrics {
  return {
    pagesAttempted: 0,
    pagesMatched: 0,
    pagesUnmatched: 0,
    activeDetected: 0,
    listedOnlyDetected: 0,
    unknownStatus: 0,
    parseFailures: 0,
    http403: 0,
    http429: 0,
    challenges: 0,
    notFound: 0,
    robotsRefusals: 0,
  }
}

interface Candidate {
  prospect_id: string
  canonical_name: string
  country: string
  phone_e164: string | null
  postal_code: string | null
  city: string | null
  planity_url: string
}

/**
 * Consecutive block responses after which the job stops early.
 *
 * If Planity is refusing us, continuing to send requests is both useless and
 * exactly the behaviour the brief forbids. Two is enough to distinguish a
 * deliberate block from one unlucky response.
 */
const BLOCK_TOLERANCE = 2

export async function runPlanityEnrichmentJob(
  pool: DbPool,
  job: ProspectJob,
  config: Config,
  log: Logger,
): Promise<PlanityEnrichmentResult> {
  const payload = job.payload as { prospectIds?: string[]; limit?: number; recheckAfterHours?: number }

  const limit = clamp(payload.limit ?? config.PLANITY_BATCH_SIZE, 1, 200)
  const recheckAfterHours = clamp(
    payload.recheckAfterHours ?? config.PLANITY_RECHECK_AFTER_HOURS,
    1,
    24 * 365,
  )

  const result: PlanityEnrichmentResult = {
    selected: 0,
    attempted: 0,
    enriched: 0,
    noResult: 0,
    skipped: 0,
    failed: 0,
    metrics: emptyMetrics(),
  }

  if (!config.PLANITY_ENABLED) {
    log.info('planity_enrichment: source disabled by configuration — nothing selected')
    return result
  }

  const candidates = await selectCandidates(pool, payload.prospectIds ?? null, limit, recheckAfterHours)
  result.selected = candidates.length

  if (candidates.length === 0) {
    log.info('planity_enrichment: no candidates due for a check')
    return result
  }

  const client = new PlanityClient(pool, job.id, log, {
    timeoutMs: config.PLANITY_REQUEST_TIMEOUT_MS,
    minRequestIntervalMs: config.PLANITY_MIN_REQUEST_INTERVAL_MS,
    maxResponseBytes: 4 * 1024 * 1024,
  })

  let consecutiveBlocks = 0

  for (const candidate of candidates) {
    const childLog = log.child({ prospect_id: candidate.prospect_id, source: 'planity' })

    // Re-checked here as well as in the client: the candidate query filters on
    // a LIKE, and only this function knows the URL shape rule.
    if (!isPlanityEstablishmentUrl(candidate.planity_url)) {
      result.skipped += 1
      childLog.debug('planity_enrichment: stored url is not an establishment page', { action: 'skip' })
      continue
    }

    let outcome: PlanityFetchOutcome
    const startedAt = Date.now()
    try {
      outcome = await client.fetchEstablishment(candidate.planity_url)
    } catch (error) {
      if (error instanceof SourcePausedError) {
        // Paused mid-batch. Everything remaining is skipped, honestly counted.
        result.skipped += candidates.length - candidates.indexOf(candidate)
        childLog.info('planity_enrichment: source paused — stopping batch', { action: 'skip' })
        break
      }
      result.failed += 1
      childLog.error('planity_enrichment: unexpected failure', error, { action: 'fetch' })
      continue
    }

    if (outcome.status === 'refused') {
      result.skipped += 1
      if (outcome.reason === 'robots_denied' || outcome.reason === 'robots_unavailable') {
        result.metrics.robotsRefusals += 1
        // Robots refusal is not per-prospect bad luck; it applies to every
        // remaining candidate, so continuing would just repeat it.
        childLog.info('planity_enrichment: robots refusal — stopping batch', {
          action: 'skip',
          status: outcome.reason,
        })
        result.skipped += candidates.length - candidates.indexOf(candidate) - 1
        break
      }
      childLog.debug('planity_enrichment: refused before request', { action: 'skip', status: outcome.reason })
      continue
    }

    result.attempted += 1
    result.metrics.pagesAttempted += 1

    if (outcome.status === 'blocked') {
      result.failed += 1
      consecutiveBlocks += 1
      if (outcome.reason === 'forbidden') result.metrics.http403 += 1
      else if (outcome.reason === 'rate_limited') result.metrics.http429 += 1
      else result.metrics.challenges += 1

      childLog.warn('planity_enrichment: blocked by provider', {
        action: 'fetch',
        status: outcome.reason,
        duration_ms: Date.now() - startedAt,
      })

      if (consecutiveBlocks >= BLOCK_TOLERANCE) {
        const remaining = candidates.length - candidates.indexOf(candidate) - 1
        result.skipped += remaining
        childLog.warn('planity_enrichment: provider is refusing requests — stopping batch, not evading', {
          action: 'stop',
          remaining,
        })
        break
      }
      continue
    }

    consecutiveBlocks = 0

    if (outcome.status === 'not_found') {
      // A 404 is a real observation — the listing is gone — but this job does
      // not act on it. Retiring a provider relationship on one 404 would drop
      // a genuine competitor record on a transient routing error, and nothing
      // downstream needs it urgently.
      result.noResult += 1
      result.metrics.notFound += 1
      childLog.info('planity_enrichment: page not found', { action: 'fetch', status: 'not_found' })
      continue
    }

    if (outcome.status === 'error') {
      result.failed += 1
      childLog.warn('planity_enrichment: transport error', { action: 'fetch', error_class: 'transport' })
      continue
    }

    let page: PlanityEstablishment
    try {
      page = parsePlanityEstablishment(outcome.html, outcome.finalUrl)
    } catch (error) {
      // parsePlanityEstablishment is written not to throw; this exists so a
      // future change that breaks that promise fails loudly and countably
      // rather than taking the batch down.
      result.failed += 1
      result.metrics.parseFailures += 1
      childLog.error('planity_enrichment: parser threw', error, { action: 'parse' })
      continue
    }

    // Nothing usable came back. A page that yields no structured data and no
    // service signal is a changed layout or an interstitial we failed to spot
    // — either way it is NOT evidence that the business has no services.
    if (!page.hasStructuredData && page.totalServiceCount === null) {
      result.noResult += 1
      result.metrics.parseFailures += 1
      childLog.warn('planity_enrichment: page yielded no usable evidence', { action: 'parse', status: 'no_result' })
      continue
    }

    const verdict = matchPlanityEstablishment(toSubject(candidate), page)
    if (!verdict.matched) {
      result.noResult += 1
      result.metrics.pagesUnmatched += 1
      childLog.info('planity_enrichment: page did not corroborate the prospect — evidence discarded', {
        action: 'match',
        status: verdict.rejection ?? 'unmatched',
      })
      continue
    }

    result.metrics.pagesMatched += 1
    if (page.bookingStatus === 'ACTIVE') result.metrics.activeDetected += 1
    else if (page.bookingStatus === 'LISTED_ONLY') result.metrics.listedOnlyDetected += 1
    else result.metrics.unknownStatus += 1

    try {
      await persist(pool, job.id, candidate, page, verdict.reasons)
    } catch (error) {
      result.failed += 1
      childLog.error('planity_enrichment: persistence failed', error, { action: 'persist' })
      continue
    }

    result.enriched += 1
    childLog.info('planity_enrichment: enriched', {
      action: 'persist',
      status: page.bookingStatus,
      duration_ms: Date.now() - startedAt,
      bookable_services: page.bookableServiceCount,
      total_services: page.totalServiceCount,
      collaborators: page.collaboratorCount,
    })
  }

  log.info('planity_enrichment complete', { ...result, ...result.metrics })
  return result
}

/**
 * Candidates come from TWO first-party statements, both of which are the
 * business saying "this is where you book us".
 *
 *   A. A current PLANITY observation whose evidence is an establishment URL —
 *      i.e. the website crawler found the link on their own site.
 *
 *   B. The prospect's own `website_url` IS a Planity establishment page.
 *
 * (B) is not a fallback; it is the STRONGER of the two, and it exists because
 * the crawler cannot produce (A) for these businesses. Observed on live: a
 * Lyon barbershop whose OpenStreetMap `website` tag is its Planity page. The
 * generic crawler fetched it, hit its 2 MB per-page cap on a ~1.5 MB Planity
 * document, and correctly recorded the crawl as FAILED — which by the
 * UNKNOWN-is-not-FALSE rule means no observation at all. So the businesses
 * most obviously committed to Planity, the ones using it as their entire web
 * presence, were exactly the ones (A) could never find.
 *
 * Reading `website_url` needs no crawl, no size limit, and no inference: a
 * source recorded the business's own address for itself, and that address is a
 * Planity page.
 *
 * Deterministic and bounded. Ordered by staleness so a repeated run walks
 * forward through the backlog, using `last_seen_at` — maintained by the
 * existing observation trigger — as the freshness clock, so this needs no new
 * state. A candidate with no observation yet sorts first.
 */
async function selectCandidates(
  pool: DbPool,
  explicitIds: string[] | null,
  limit: number,
  recheckAfterHours: number,
): Promise<Candidate[]> {
  const result = await pool.query<Candidate>(
    `select distinct on (p.id)
            p.id            as prospect_id,
            p.canonical_name,
            p.country,
            p.phone_e164,
            loc.postal_code,
            loc.city,
            -- Prefer the observation's URL when one exists: it is what the
            -- crawler actually saw. Fall back to the business's own listed
            -- website when that is itself a Planity page.
            coalesce(o.evidence, p.website_url) as planity_url
     from public.prospects p
     left join public.booking_provider_observations o
            on o.prospect_id = p.id
           and o.is_current
           and o.provider_id = (select id from public.booking_providers where key = 'PLANITY')
           and o.evidence like '%planity.%'
     left join public.prospect_locations loc on loc.prospect_id = p.id and loc.is_primary
     where coalesce(o.evidence, p.website_url) like '%planity.%'
       and p.converted_organization_id is null
       and not p.do_not_contact
       and ($1::uuid[] is null or p.id = any($1::uuid[]))
       and (
         $1::uuid[] is not null
         -- No observation yet, never status-checked, or checked long enough
         -- ago to have changed.
         or o.id is null
         or o.booking_status = 'UNKNOWN'
         or o.last_seen_at < now() - make_interval(hours => $2::int)
       )
     order by p.id, o.last_seen_at asc nulls first
     limit $3`,
    [explicitIds, recheckAfterHours, limit],
  )

  return result.rows
}

/**
 * Records the evidence.
 *
 * ONE observation row, updated in place by the existing BEFORE INSERT trigger
 * when the provider is unchanged — which is what makes re-running this job
 * idempotent. The trigger extends last_seen_at and cancels the insert rather
 * than accumulating a row per run, so a nightly re-check does not grow the
 * table without bound.
 *
 * NOTE ON WHAT IS DELIBERATELY NOT WRITTEN
 *
 * No prospect_source_records row. Planity is registered as a source so the
 * quota guard and source health work, but this evidence must never count
 * toward publication independence: the page was reached by following a link on
 * the business's own website, so it is the SAME evidence chain as the
 * `website` source, one hop longer. Writing a source record here would let a
 * prospect known only from its own website clear the two-independent-sources
 * bar by way of a link it published about itself.
 *
 * No prospect field is overwritten either. Planity is a third-party listing;
 * canonical_name, phone and address stay owned by the sources that already own
 * them, and the page's version of those facts lives in the observation.
 */
async function persist(
  pool: DbPool,
  jobId: string,
  candidate: Candidate,
  page: PlanityEstablishment,
  matchReasons: string[],
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('begin')

    await client.query(
      `insert into public.booking_provider_observations
         (prospect_id, provider_id, detection_method, evidence, evidence_url,
          confidence, job_id, is_current, booking_status)
       select $1, bp.id, 'provider_public_page'::public.booking_provider_detection_method,
              $2, $3, $4, $5, true, $6::public.booking_availability_status
       from public.booking_providers bp where bp.key = 'PLANITY'`,
      [
        candidate.prospect_id,
        // The canonical page URL is the evidence. Canonicalised by the parser,
        // so the same establishment reached by two spellings is one value.
        page.canonicalUrl,
        page.canonicalUrl,
        // Reading the provider's own page is the strongest confirmation short
        // of an official API, and strictly stronger than inferring the
        // relationship from a link elsewhere.
        0.98,
        jobId,
        page.bookingStatus,
      ],
    )

    // The trigger may have cancelled the insert (same provider already
    // current). Either way the CURRENT row must carry this run's status and
    // freshness, so it is written explicitly rather than assumed.
    await client.query(
      `update public.booking_provider_observations o
       set booking_status = $2::public.booking_availability_status,
           evidence = $3,
           evidence_url = $3,
           confidence = greatest(o.confidence, 0.98),
           last_seen_at = now()
       from public.booking_providers bp
       where o.prospect_id = $1 and o.provider_id = bp.id and bp.key = 'PLANITY' and o.is_current`,
      [candidate.prospect_id, page.bookingStatus, page.canonicalUrl],
    )

    // Establishment size, as a COUNT. Practitioner names are never stored —
    // an employee is not a marketplace prospect, and their name has no use in
    // FadeUp's model. Only ever raises the estimate: a Planity page shows the
    // bookable team, which is a floor rather than a headcount.
    if (page.collaboratorCount !== null && page.collaboratorCount > 0) {
      await client.query(
        `update public.prospects
         set estimated_barber_count = greatest(coalesce(estimated_barber_count, 0), $2)
         where id = $1`,
        [candidate.prospect_id, page.collaboratorCount],
      )
    }

    // Public reputation, gap-filled only. A rating already established by
    // Google is not replaced by Planity's.
    if (page.rating !== null || page.reviewCount !== null) {
      await client.query(
        `update public.prospects
         set rating = coalesce(rating, $2), review_count = coalesce(review_count, $3)
         where id = $1`,
        [candidate.prospect_id, page.rating, page.reviewCount],
      )
    }

    // last_enriched_at LAST, and only here — on the path where evidence was
    // returned, matched and persisted. Not on selection, not on a skip, not on
    // a robots refusal, not on a 404, not on an unmatched page. The R3 trigger
    // on this column is what emits prospect_enriched, so setting it anywhere
    // else would fabricate a server-authoritative analytics event.
    await client.query(`update public.prospects set last_enriched_at = now() where id = $1`, [
      candidate.prospect_id,
    ])

    await client.query(
      `insert into public.prospect_events (prospect_id, event_type, metadata)
       values ($1, 'enriched', $2)`,
      [
        candidate.prospect_id,
        JSON.stringify({
          source: 'planity',
          booking_status: page.bookingStatus,
          bookable_services: page.bookableServiceCount,
          total_services: page.totalServiceCount,
          collaborators: page.collaboratorCount,
          match_reasons: matchReasons,
          url: page.canonicalUrl,
        }),
      ],
    )

    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

function toSubject(candidate: Candidate): MatchSubject {
  return {
    canonicalName: candidate.canonical_name,
    country: candidate.country,
    postalCode: candidate.postal_code,
    city: candidate.city,
    phoneE164: candidate.phone_e164,
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.floor(value)))
}
