import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import type { SourceAdapter } from '../sources/registry.js'
import type { DiscoveryQuery, RawCandidate } from '../sources/types.js'
import { isSourcePaused, recordApiUsage, SourcePausedError } from '../quota.js'
import { normalizeBusinessName } from '../normalize/name.js'
import { normalizePhoneE164 } from '../normalize/phone.js'
import { normalizeDomain, normalizeUrl } from '../normalize/domain.js'
import { normalizeEmail, normalizeSocialHandle } from '../normalize/email.js'
import { normalizeAddressLine, normalizeCity, normalizeCountryCode, normalizePostalCode } from '../normalize/address.js'
import { findHighConfidenceMatch, findFuzzyCandidates, recordDuplicateCandidate } from '../dedupe/candidates.js'
import { computeProspectScore } from '../scoring/score.js'
import type { ProspectJob, DiscoveryJobPayload } from '../queue/types.js'

// France gets the full waterfall (Sirene is France-only); every other
// country skips straight from Geoapify to Google — see spec's
// source-waterfall section.
// Planity is France-only and LAST in the French waterfall, deliberately.
//
// Order matters here because the loop links candidates into whichever prospect
// already exists, so an earlier source's record becomes the anchor a later one
// reconciles against. OSM/Geoapify/Sirene are broad geographic and registry
// sweeps; Planity covers only businesses that chose to be on Planity. Running
// it last means its candidates mostly MERGE into prospects the sweeps already
// found — adding a booking-provider fact to a known business — rather than
// creating a parallel population of Planity-only prospects that the sweeps
// then have to be reconciled against.
//
// It is also the most expensive to run and the one a provider could start
// refusing, so it is the right thing to reach last and cheapest to lose.
const BULK_SOURCES_BY_COUNTRY: Record<string, string[]> = {
  FR: ['osm', 'geoapify', 'sirene', 'planity'],
}
const DEFAULT_BULK_SOURCES = ['osm', 'geoapify']

const GOOGLE_ENRICHMENT_MIN_CONFIDENCE = 0.6

export interface DiscoveryJobResult {
  candidatesFound: number
  prospectsCreated: number
  prospectsLinked: number
  duplicateCandidatesFound: number
  sourceErrors: Record<string, string>
}

export async function runDiscoveryJob(
  pool: DbPool,
  job: ProspectJob,
  sources: Map<string, SourceAdapter>,
  log: Logger,
): Promise<DiscoveryJobResult> {
  const payload = job.payload as unknown as DiscoveryJobPayload
  const country = normalizeCountryCode(payload.country) ?? 'FR'
  const bulkSourceKeys = BULK_SOURCES_BY_COUNTRY[country] ?? DEFAULT_BULK_SOURCES

  const summary: DiscoveryJobResult = {
    candidatesFound: 0,
    prospectsCreated: 0,
    prospectsLinked: 0,
    duplicateCandidatesFound: 0,
    sourceErrors: {},
  }

  const query: DiscoveryQuery = {
    country,
    city: payload.city,
    latitude: payload.latitude,
    longitude: payload.longitude,
    radiusKm: payload.radiusKm,
    entityType: payload.entityType,
    keywords: payload.keywords,
    maxCandidates: payload.maxCandidates,
  }

  const processedProspectIds: string[] = []

  for (const sourceKey of bulkSourceKeys) {
    const jobSourceId = await getJobSourceId(pool, job.id, sourceKey)
    if (!jobSourceId) continue // recorded 'skipped' at job creation (disabled source) — see 20260811150200's create_prospect_discovery_job

    const adapter = sources.get(sourceKey)
    if (!adapter || !adapter.isConfigured()) {
      await markJobSource(pool, jobSourceId, 'skipped', 0, adapter ? 'not configured (missing credentials)' : 'unknown source');
      continue
    }

    if (await isSourcePaused(pool, sourceKey)) {
      await markJobSource(pool, jobSourceId, 'skipped', 0, 'paused (manual pause or quota exhausted)')
      continue
    }

    await markJobSource(pool, jobSourceId, 'running', 0, null)
    const startedAt = Date.now()

    try {
      const candidates = await adapter.discover(query, { jobId: job.id, logger: log.child({ source: sourceKey }) })
      await recordApiUsage(pool, {
        sourceKey,
        jobId: job.id,
        endpoint: 'discover',
        success: true,
        latencyMs: Date.now() - startedAt,
      })

      summary.candidatesFound += candidates.length

      for (const raw of candidates) {
        const outcome = await processCandidate(pool, job.id, sourceKey, country, raw, log)
        if (outcome) {
          if (outcome.created) summary.prospectsCreated++
          else summary.prospectsLinked++
          summary.duplicateCandidatesFound += outcome.duplicateCandidates
          processedProspectIds.push(outcome.prospectId)

          // A business found ON Planity is a Planity customer. That is known
          // right now, from the page that listed it — waiting for a later
          // website crawl to rediscover it would leave the competitor record
          // empty for businesses whose only web presence IS their Planity page,
          // which is exactly the population this source finds.
          //
          // booking_status stays UNKNOWN: a listing shows that a business is
          // there, not that its services are bookable. Only planity_enrichment,
          // which reads the establishment page, can say that.
          if (sourceKey === 'planity') {
            await recordPlanityProviderObservation(pool, job.id, outcome.prospectId, raw, log)
          }
        }
      }

      await markJobSource(pool, jobSourceId, 'completed', candidates.length, null)
    } catch (error) {
      // A failed source must not destroy the entire discovery job — per
      // spec. Every OTHER source in bulkSourceKeys still runs.
      const message = error instanceof Error ? error.message : String(error)
      log.warn('discovery: source failed, continuing with remaining sources', { source: sourceKey, error: message })
      summary.sourceErrors[sourceKey] = message
      if (!(error instanceof SourcePausedError)) {
        await recordApiUsage(pool, { sourceKey, jobId: job.id, endpoint: 'discover', success: false, latencyMs: Date.now() - startedAt, error: message })
      }
      await markJobSource(pool, jobSourceId, 'failed', 0, message)
    }
  }

  // Google enrichment pass — ONLY for candidates that already cleared the
  // free/cheap sources with a decent confidence, per spec: "Google
  // enrichment for useful candidates" (never a blanket bulk sweep).
  await runEnrichmentPass(pool, job, sources, 'google_places', processedProspectIds, log, async (prospect) => {
    if (prospect.sourceConfidence < GOOGLE_ENRICHMENT_MIN_CONFIDENCE) return null
    return { ...query, city: prospect.city ?? query.city, keywords: [prospect.canonicalName], maxCandidates: 1 }
  })

  // Website enrichment — for every candidate that has a website URL.
  await runEnrichmentPass(pool, job, sources, 'website', processedProspectIds, log, async (prospect) => {
    if (!prospect.websiteUrl) return null
    return { ...query, websiteUrl: prospect.websiteUrl }
  })

  // Instagram enrichment — official API only, only for candidates with a
  // handle already discovered (e.g. from OSM tags or website crawl).
  await runEnrichmentPass(pool, job, sources, 'instagram', processedProspectIds, log, async (prospect) => {
    if (!prospect.instagramHandle) return null
    return { ...query, instagramHandle: prospect.instagramHandle }
  })

  // Score every prospect this job touched.
  for (const prospectId of new Set(processedProspectIds)) {
    await scoreProspect(pool, prospectId)
  }

  return summary
}

interface ProcessOutcome {
  prospectId: string
  created: boolean
  duplicateCandidates: number
}

async function processCandidate(
  pool: DbPool,
  jobId: string,
  sourceKey: string,
  country: string,
  raw: RawCandidate,
  log: Logger,
): Promise<ProcessOutcome | null> {
  const canonicalName = raw.name?.trim()
  if (!canonicalName) return null

  const phoneE164 = normalizePhoneE164(raw.phone, raw.country ?? country)
  const websiteUrl = normalizeUrl(raw.websiteUrl)
  const websiteDomain = normalizeDomain(raw.websiteUrl)
  const email = normalizeEmail(raw.email)
  const instagramHandle = normalizeSocialHandle(raw.instagramHandle)

  // Suppression check BEFORE writing anything — a previously
  // do-not-contact identifier must not resurrect a new prospect row.
  for (const [scope, value] of [
    ['phone', phoneE164],
    ['email', email],
    ['domain', websiteDomain],
    ['instagram_handle', instagramHandle],
  ] as const) {
    if (value) {
      const suppressed = await pool.query<{ is_prospect_value_suppressed: boolean }>('select private.is_prospect_value_suppressed($1, $2)', [scope, value])
      if (suppressed.rows[0]?.is_prospect_value_suppressed) {
        log.info('discovery: candidate matches a suppressed identifier — skipped', { scope, canonicalName })
        return null
      }
    }
  }

  const match = await findHighConfidenceMatch(pool, {
    sourceKey,
    externalId: raw.externalId,
    siret: sourceKey === 'sirene' ? raw.externalId : undefined,
    phoneE164,
    websiteDomain,
    instagramHandle,
    canonicalName,
    country,
  })

  let prospectId: string
  let created: boolean

  if (match) {
    prospectId = match.prospectId
    created = false
    await mergeIntoExistingProspect(pool, prospectId, { phoneE164, email, websiteUrl, websiteDomain })
  } else {
    const insertResult = await pool.query<{ id: string }>(
      `insert into public.prospects (type, canonical_name, country, website_url, website_domain, phone_e164, email)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      ['barbershop', canonicalName, country, websiteUrl, websiteDomain, phoneE164, email],
    )
    prospectId = insertResult.rows[0]!.id
    created = true

    const city = normalizeCity(raw.city)
    const postalCode = normalizePostalCode(raw.postalCode)
    const addressLine = normalizeAddressLine(raw.addressLine)
    if (city || postalCode || addressLine || (raw.latitude && raw.longitude)) {
      await pool.query(
        `insert into public.prospect_locations (prospect_id, is_primary, address_line, city, postal_code, region, country, latitude, longitude)
         values ($1, true, $2, $3, $4, $5, $6, $7, $8)`,
        [prospectId, addressLine, city, postalCode, raw.region ?? null, raw.country ?? country, raw.latitude ?? null, raw.longitude ?? null],
      )
    }
  }

  if (instagramHandle) {
    await pool.query(
      `insert into public.prospect_social_profiles (prospect_id, platform, handle, url)
       values ($1, 'instagram', $2, $3)
       on conflict (prospect_id, platform, handle) where handle is not null do nothing`,
      [prospectId, instagramHandle, raw.rawPayload['website'] ?? null],
    )
  }
  if (raw.facebookUrl) {
    await pool.query(
      `insert into public.prospect_social_profiles (prospect_id, platform, url)
       values ($1, 'facebook', $2)
       on conflict do nothing`,
      [prospectId, raw.facebookUrl],
    )
  }

  await pool.query(
    `insert into public.prospect_source_records (source_id, prospect_id, external_id, external_type, source_url, raw_payload, confidence, job_id)
     values ((select id from public.prospect_sources where key = $1), $2, $3, $4, $5, $6, $7, $8)
     on conflict (source_id, external_id) where external_id is not null
     do update set prospect_id = excluded.prospect_id, last_verified_at = now()`,
    [sourceKey, prospectId, raw.externalId, raw.externalType, raw.sourceUrl ?? null, JSON.stringify(raw.rawPayload), raw.confidence, jobId],
  )

  let duplicateCandidates = 0
  if (created && raw.latitude && raw.longitude) {
    const fuzzy = await findFuzzyCandidates(pool, prospectId, canonicalName, raw.latitude, raw.longitude)
    for (const candidate of fuzzy) {
      await recordDuplicateCandidate(pool, prospectId, candidate)
      duplicateCandidates++
    }
  }

  return { prospectId, created, duplicateCandidates }
}

async function mergeIntoExistingProspect(
  pool: DbPool,
  prospectId: string,
  fields: { phoneE164: string | null; email: string | null; websiteUrl: string | null; websiteDomain: string | null },
): Promise<void> {
  // Only fill in gaps — an existing confirmed value is never silently
  // overwritten by a lower-provenance re-discovery.
  await pool.query(
    `update public.prospects
     set phone_e164 = coalesce(phone_e164, $2),
         email = coalesce(email, $3),
         website_url = coalesce(website_url, $4),
         website_domain = coalesce(website_domain, $5)
     where id = $1`,
    [prospectId, fields.phoneE164, fields.email, fields.websiteUrl, fields.websiteDomain],
  )
}

export interface ProspectEnrichmentContext {
  canonicalName: string
  city: string | null
  websiteUrl: string | null
  instagramHandle: string | null
  sourceConfidence: number
}

export async function runEnrichmentPass(
  pool: DbPool,
  job: ProspectJob,
  sources: Map<string, SourceAdapter>,
  sourceKey: string,
  prospectIds: string[],
  log: Logger,
  buildQuery: (ctx: ProspectEnrichmentContext) => Promise<DiscoveryQuery | null>,
): Promise<void> {
  const adapter = sources.get(sourceKey)
  if (!adapter || !adapter.isConfigured()) return

  for (const prospectId of new Set(prospectIds)) {
    if (await isSourcePaused(pool, sourceKey)) {
      log.debug('enrichment pass: source paused mid-run, stopping this source for the rest of the job', { source: sourceKey })
      return
    }

    const ctxResult = await pool.query<{
      canonical_name: string
      city: string | null
      website_url: string | null
      instagram_handle: string | null
      source_confidence: number | null
    }>(
      `select p.canonical_name, pl.city, p.website_url,
              (select handle from public.prospect_social_profiles where prospect_id = p.id and platform = 'instagram' limit 1) as instagram_handle,
              (select avg(confidence) from public.prospect_source_records where prospect_id = p.id) as source_confidence
       from public.prospects p
       left join public.prospect_locations pl on pl.prospect_id = p.id and pl.is_primary
       where p.id = $1`,
      [prospectId],
    )
    const row = ctxResult.rows[0]
    if (!row) continue

    const query = await buildQuery({
      canonicalName: row.canonical_name,
      city: row.city,
      websiteUrl: row.website_url,
      instagramHandle: row.instagram_handle,
      sourceConfidence: row.source_confidence ?? 0,
    })
    if (!query) continue

    const startedAt = Date.now()
    try {
      const results = await adapter.discover(query, { jobId: job.id, logger: log.child({ source: sourceKey, prospectId }) })
      await recordApiUsage(pool, { sourceKey, jobId: job.id, endpoint: 'enrich', success: true, latencyMs: Date.now() - startedAt })

      const first = results[0]
      if (first) {
        await processCandidate(pool, job.id, sourceKey, 'FR', { ...first, name: first.name ?? row.canonical_name }, log)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!(error instanceof SourcePausedError)) {
        await recordApiUsage(pool, { sourceKey, jobId: job.id, endpoint: 'enrich', success: false, latencyMs: Date.now() - startedAt, error: message })
      }
      log.warn('enrichment pass: failed for one candidate, continuing', { source: sourceKey, prospectId, error: message })
    }
  }
}

export async function scoreProspect(pool: DbPool, prospectId: string): Promise<void> {
  const result = await pool.query<{
    category_match_exact: boolean
    has_phone: boolean
    has_email: boolean
    has_website: boolean
    has_social: boolean
    has_business_social: boolean
    booking_provider_detected: boolean
    source_confidence_avg: number | null
    location_count: number
  }>(
    `select
       exists (select 1 from public.prospect_source_records where prospect_id = $1 and confidence >= 0.75) as category_match_exact,
       p.phone_e164 is not null as has_phone,
       p.email is not null as has_email,
       p.website_url is not null as has_website,
       exists (select 1 from public.prospect_social_profiles where prospect_id = $1) as has_social,
       exists (select 1 from public.prospect_social_profiles where prospect_id = $1 and is_business_account) as has_business_social,
       exists (
         select 1 from public.prospect_source_records
         where prospect_id = $1 and raw_payload->>'bookingProvider' is not null
       ) as booking_provider_detected,
       (select avg(confidence) from public.prospect_source_records where prospect_id = $1) as source_confidence_avg,
       (select count(*) from public.prospect_locations where prospect_id = $1) as location_count
     from public.prospects p where p.id = $1`,
    [prospectId],
  )
  const row = result.rows[0]
  if (!row) return

  const scoring = computeProspectScore({
    categoryMatch: row.category_match_exact ? 'exact' : 'none',
    hasPhone: row.has_phone,
    hasEmail: row.has_email,
    hasWebsite: row.has_website,
    hasSocialProfile: row.has_social,
    isBusinessSocialAccount: row.has_business_social,
    barberCount: null,
    isMultiLocation: row.location_count > 1,
    isDenseUrbanMarket: false,
    bookingProviderDetected: row.booking_provider_detected,
    sourceConfidenceAvg: row.source_confidence_avg ?? 0,
    hasActivePublicPresence: row.has_business_social,
    hasWalkInIndicator: false,
  })

  await pool.query('insert into public.prospect_scores (prospect_id, score, bucket, factors) values ($1, $2, $3, $4)', [
    prospectId,
    scoring.score,
    scoring.bucket,
    JSON.stringify(scoring.factors),
  ])
}

async function getJobSourceId(pool: DbPool, jobId: string, sourceKey: string): Promise<string | null> {
  const result = await pool.query<{ id: string; status: string }>(
    `select js.id, js.status from public.prospect_job_sources js
     join public.prospect_sources s on s.id = js.source_id
     where js.job_id = $1 and s.key = $2`,
    [jobId, sourceKey],
  )
  const row = result.rows[0]
  if (!row || row.status === 'skipped') return null
  return row.id
}

async function markJobSource(pool: DbPool, jobSourceId: string, status: string, candidatesFound: number, error: string | null): Promise<void> {
  await pool.query(
    `update public.prospect_job_sources
     set status = $2::public.prospect_job_source_status,
         candidates_found = $3,
         error = $4,
         started_at = case when $2 = 'running' then now() else started_at end,
         completed_at = case when $2 in ('completed','failed') then now() else completed_at end
     where id = $1`,
    [jobSourceId, status, candidatesFound, error],
  )
}

/**
 * Records the booking-provider fact implied by finding a business on Planity.
 *
 * Uses the SAME append-only observation table and the same BEFORE INSERT
 * trigger as website-based competitor detection, so re-running discovery
 * extends `last_seen_at` on the existing row instead of accumulating one per
 * run. `provider_public_page` is the honest detection method: the evidence came
 * from Planity's own listing, not from something found on the business's site.
 *
 * Non-fatal by design. A discovery job that found a real business must not be
 * failed because a secondary provider fact could not be written — the prospect
 * and its provenance are already committed, and website enrichment would
 * eventually record the same relationship anyway.
 */
async function recordPlanityProviderObservation(
  pool: DbPool,
  jobId: string,
  prospectId: string,
  raw: RawCandidate,
  log: Logger,
): Promise<void> {
  const url = typeof raw.rawPayload['canonicalPlanityUrl'] === 'string'
    ? (raw.rawPayload['canonicalPlanityUrl'] as string)
    : raw.sourceUrl

  if (!url) return

  try {
    await pool.query(
      `insert into public.booking_provider_observations
         (prospect_id, provider_id, detection_method, evidence, evidence_url,
          confidence, job_id, is_current, booking_status)
       select $1, bp.id, 'provider_public_page'::public.booking_provider_detection_method,
              $2, $2, $3, $4, true, 'UNKNOWN'::public.booking_availability_status
       from public.booking_providers bp where bp.key = 'PLANITY'`,
      [prospectId, url, 0.95, jobId],
    )
  } catch (error) {
    log.warn('discovery: could not record Planity provider observation', {
      prospect_id: prospectId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
