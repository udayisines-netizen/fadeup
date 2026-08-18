import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import type { ProspectJob } from '../queue/types.js'
import { computeFeatures, FEATURE_VERSION, type ComputedFeature, type FeatureInput } from '../features/compute.js'
import { parseTribool, type Tribool } from '../features/tribool.js'
import { computeFadeUpFitScore, computeMigrationPotentialScore, type ScoringFeatures } from '../scoring/fit-scores.js'
import { computeSegments, SEGMENTER_VERSION } from '../scoring/segments.js'
import { resolveLocale } from '../locale/resolve.js'
import type { CrawlResult } from '../crawler/crawl.js'
import type { CompetitorDetection } from '../competitors/detect.js'

/**
 * The post-enrichment pipeline for one prospect:
 *
 *   features -> data quality -> locale -> fadeup_fit -> migration_potential
 *            -> segments
 *
 * Deliberately one job rather than six: every step reads the same
 * prospect snapshot, and splitting them would mean six re-reads plus a
 * window where a prospect has new features and a stale score.
 */

export interface FeatureComputationResult {
  prospectId: string
  featuresWritten: number
  fadeUpFitScore: number
  migrationPotentialScore: number
  segments: string[]
  locale: string | null
  localeReviewRequired: boolean
  dataQuality: number
}

export async function runFeatureComputationJob(
  pool: DbPool,
  job: ProspectJob,
  log: Logger,
): Promise<FeatureComputationResult> {
  const payload = job.payload as Record<string, unknown>
  const prospectId = String(payload['prospectId'] ?? '')
  if (!prospectId) throw new Error('feature_computation: payload.prospectId is required')

  const snapshot = await loadProspectSnapshot(pool, prospectId)
  if (!snapshot) throw new Error(`feature_computation: prospect ${prospectId} not found`)

  // --- 1. Features -----------------------------------------------------
  const features = computeFeatures(snapshot.featureInput)
  await persistFeatures(pool, prospectId, features)

  const featureMap = new Map(features.map((f) => [f.key, f]))
  const tribool = (key: string): Tribool =>
    featureMap.get(key)?.value.kind === 'bool' ? (featureMap.get(key)!.value as { kind: 'bool'; value: Tribool }).value : 'UNKNOWN'
  const numeric = (key: string): number | null => {
    const value = featureMap.get(key)?.value
    return value?.kind === 'numeric' ? value.value : null
  }
  const text = (key: string): string | null => {
    const value = featureMap.get(key)?.value
    return value?.kind === 'text' ? value.value : null
  }

  // --- 2. Data quality -------------------------------------------------
  const quality = await computeAndPersistDataQuality(pool, prospectId, snapshot)

  // --- 3. Locale -------------------------------------------------------
  const resolved = resolveLocale({
    verifiedCountry: snapshot.sireneCountry,
    addressCountry: snapshot.addressCountry ?? snapshot.featureInput.prospect.country,
    websiteHtmlLang: snapshot.featureInput.crawl?.pages[0]?.lang ?? null,
    providerLocale: snapshot.providerLocale,
    phoneE164: snapshot.phoneE164,
    dominantWebsiteLanguage: null,
  })

  await pool.query(
    `insert into public.prospect_locales
       (prospect_id, detected_country, detected_language, locale, language_source,
        language_confidence, language_review_required, evidence, computed_at)
     values ($1, $2, $3, $4, $5::public.prospect_locale_source, $6, $7, $8, now())
     on conflict (prospect_id) do update
     set detected_country = excluded.detected_country,
         detected_language = excluded.detected_language,
         locale = excluded.locale,
         language_source = excluded.language_source,
         language_confidence = excluded.language_confidence,
         language_review_required = excluded.language_review_required,
         evidence = excluded.evidence,
         computed_at = now()`,
    [
      prospectId,
      resolved.detectedCountry,
      resolved.detectedLanguage,
      resolved.locale,
      resolved.languageSource,
      resolved.languageConfidence,
      resolved.reviewRequired,
      JSON.stringify(resolved.evidence),
    ],
  )

  // --- 4. Scores -------------------------------------------------------
  const scoringFeatures: ScoringFeatures = {
    rating: snapshot.featureInput.prospect.rating,
    reviewCount: snapshot.featureInput.prospect.reviewCount,
    barberCount: numeric('estimated_barber_count'),
    shopType: snapshot.featureInput.prospect.type,
    locationCount: snapshot.featureInput.locationCount,
    hasWebsite: tribool('has_website'),
    websiteQualityScore: numeric('website_quality_score'),
    mobileReady: tribool('mobile_ready'),
    bookingDetected: tribool('booking_detected'),
    bookingProviderKey: text('booking_provider') ?? 'UNKNOWN',
    onlineBookingGap: tribool('online_booking_gap'),
    instagramPresence: tribool('instagram_presence'),
    socialPresence: tribool('social_presence'),
    phoneAvailable: tribool('phone_available'),
    emailAvailable: tribool('email_available'),
    liveQueueFit: numeric('live_queue_fit') ?? 0,
    marketplaceFit: numeric('marketplace_fit') ?? 0,
    shopManagementFit: numeric('shop_management_fit') ?? 0,
    digitalGapScore: numeric('digital_gap_score') ?? 0,
    competitorTenureDays: snapshot.competitorTenureDays,
  }

  const fitScore = computeFadeUpFitScore(scoringFeatures)
  const migrationScore = computeMigrationPotentialScore(scoringFeatures)

  for (const [kind, result] of [
    ['fadeup_fit', fitScore],
    ['migration_potential', migrationScore],
  ] as const) {
    await pool.query(
      `insert into public.prospect_fit_scores
         (prospect_id, score_kind, score, classification, breakdown, ruleset_version, job_id, is_current)
       values ($1, $2, $3, $4::public.prospect_fit_class, $5, $6, $7, true)`,
      [prospectId, kind, result.score, result.classification, JSON.stringify(result.breakdown), result.rulesetVersion, job.id],
    )
  }

  // --- 5. Segments -----------------------------------------------------
  const reviewReasons: string[] = []
  if (resolved.reviewRequired) reviewReasons.push('locale_review_required')
  if (snapshot.hasAmbiguousIdentityMatch) reviewReasons.push('identity_match_review_required')

  const segments = computeSegments({
    features: scoringFeatures,
    fadeUpFitScore: fitScore.score,
    migrationPotentialScore: migrationScore.score,
    needsHumanReview: reviewReasons.length > 0,
    reviewReasons,
  })

  // Replace the whole membership set: segmentation is a pure function of
  // the current snapshot, so a prospect that no longer qualifies must
  // actually leave the segment rather than lingering.
  await pool.query(`delete from public.prospect_segments where prospect_id = $1`, [prospectId])
  for (const segment of segments) {
    await pool.query(
      `insert into public.prospect_segments (prospect_id, segment_key, rationale, segmenter_version)
       values ($1, $2, $3, $4)
       on conflict (prospect_id, segment_key) do update set rationale = excluded.rationale`,
      [prospectId, segment.segmentKey, JSON.stringify(segment.rationale), SEGMENTER_VERSION],
    )
  }

  log.info('feature_computation: completed', {
    prospect_id: prospectId,
    features: features.length,
    fadeup_fit: fitScore.score,
    migration_potential: migrationScore.score,
    segments: segments.length,
  })

  return {
    prospectId,
    featuresWritten: features.length,
    fadeUpFitScore: fitScore.score,
    migrationPotentialScore: migrationScore.score,
    segments: segments.map((s) => s.segmentKey),
    locale: resolved.locale,
    localeReviewRequired: resolved.reviewRequired,
    dataQuality: quality,
  }
}

async function persistFeatures(pool: DbPool, prospectId: string, features: ComputedFeature[]): Promise<void> {
  for (const feature of features) {
    const valueBool = feature.value.kind === 'bool' ? feature.value.value : null
    const valueNumeric = feature.value.kind === 'numeric' ? feature.value.value : null
    const valueText = feature.value.kind === 'text' ? feature.value.value : null

    await pool.query(
      `insert into public.prospect_features
         (prospect_id, feature_key, feature_version, value_bool, value_numeric, value_text,
          evidence_source, evidence, confidence, observed_at, computed_at)
       values ($1, $2, $3, $4::public.prospect_tribool, $5, $6, $7, $8, $9, $10, now())
       on conflict (prospect_id, feature_key, feature_version) do update
       set value_bool = excluded.value_bool,
           value_numeric = excluded.value_numeric,
           value_text = excluded.value_text,
           evidence_source = excluded.evidence_source,
           evidence = excluded.evidence,
           confidence = excluded.confidence,
           observed_at = excluded.observed_at,
           computed_at = now()`,
      [
        prospectId,
        feature.key,
        FEATURE_VERSION,
        valueBool,
        valueNumeric,
        valueText,
        feature.evidenceSource,
        JSON.stringify(feature.evidence),
        feature.confidence,
        feature.observedAt,
      ],
    )
  }
}

interface ProspectSnapshot {
  featureInput: FeatureInput
  sireneCountry: string | null
  addressCountry: string | null
  providerLocale: string | null
  phoneE164: string | null
  competitorTenureDays: number | null
  hasAmbiguousIdentityMatch: boolean
  sourceConfidenceAvg: number | null
  enrichmentAttempted: boolean
  enrichmentSucceeded: boolean
  conflictCount: number
}

async function loadProspectSnapshot(pool: DbPool, prospectId: string): Promise<ProspectSnapshot | null> {
  const prospectResult = await pool.query<{
    id: string
    type: 'barbershop' | 'independent_barber'
    country: string
    rating: string | null
    review_count: number | null
    estimated_barber_count: number | null
    phone_e164: string | null
    email: string | null
    website_url: string | null
  }>(
    `select id, type, country, rating, review_count, estimated_barber_count, phone_e164, email, website_url
     from public.prospects where id = $1`,
    [prospectId],
  )
  const prospect = prospectResult.rows[0]
  if (!prospect) return null

  const locationResult = await pool.query<{ city: string | null; country: string | null; location_count: string }>(
    `select
       (select city from public.prospect_locations where prospect_id = $1 and is_primary limit 1) as city,
       (select country from public.prospect_locations where prospect_id = $1 and is_primary limit 1) as country,
       (select count(*) from public.prospect_locations where prospect_id = $1) as location_count`,
    [prospectId],
  )
  const location = locationResult.rows[0]

  const socialResult = await pool.query<{ platform: string; handle: string | null; is_business_account: boolean | null }>(
    `select platform::text, handle, is_business_account from public.prospect_social_profiles where prospect_id = $1`,
    [prospectId],
  )

  // The most recent website-crawl provenance row carries whether the crawl
  // actually succeeded — the single fact that decides UNKNOWN vs FALSE.
  const crawlResult = await pool.query<{ raw_payload: Record<string, unknown>; source_url: string | null }>(
    `select r.raw_payload, r.source_url
     from public.prospect_source_records r
     join public.prospect_sources s on s.id = r.source_id
     where r.prospect_id = $1 and s.key = 'website' and r.external_type = 'website_crawl'
     order by r.fetched_at desc limit 1`,
    [prospectId],
  )
  const crawlRecord = crawlResult.rows[0]

  const observationsResult = await pool.query<{
    provider_key: string
    detection_method: string
    evidence: string | null
    evidence_url: string | null
    confidence: string
    first_seen_at: string
    is_current: boolean
  }>(
    `select bp.key as provider_key, o.detection_method::text, o.evidence, o.evidence_url,
            o.confidence, o.first_seen_at, o.is_current
     from public.booking_provider_observations o
     join public.booking_providers bp on bp.id = o.provider_id
     where o.prospect_id = $1
     order by o.is_current desc, o.confidence desc`,
    [prospectId],
  )

  const sourceStatsResult = await pool.query<{
    source_count: string
    avg_confidence: string | null
    sirene_country: string | null
    conflict_count: string
  }>(
    `select
       (select count(distinct source_id) from public.prospect_source_records where prospect_id = $1) as source_count,
       (select avg(confidence) from public.prospect_source_records where prospect_id = $1) as avg_confidence,
       (select case when exists (
          select 1 from public.prospect_source_records r
          join public.prospect_sources s on s.id = r.source_id
          where r.prospect_id = $1 and s.key = 'sirene'
        ) then (select country from public.prospects where id = $1) end) as sirene_country,
       -- A conflict is two sources disagreeing on a normalized identifier.
       (select count(*) from (
          select distinct r.raw_payload->>'phone' as v
          from public.prospect_source_records r
          where r.prospect_id = $1 and r.raw_payload->>'phone' is not null
        ) t) as conflict_count`,
    [prospectId],
  )
  const sourceStats = sourceStatsResult.rows[0]

  const ambiguousResult = await pool.query<{ exists: boolean }>(
    `select exists (
       select 1 from public.prospect_identity_matches
       where prospect_id = $1 and state in ('POSSIBLE_MATCH', 'REVIEW_REQUIRED') and reviewed_at is null
     ) as exists`,
    [prospectId],
  )

  // Reconstruct a minimal CrawlResult from stored provenance. Only the
  // fields feature computation reads are needed; page-level signals were
  // already consumed by the enrichment job and distilled into the stored
  // payload plus the observations above.
  const crawlPayload = crawlRecord?.raw_payload ?? null
  const crawlSucceeded = crawlPayload?.['succeeded'] === true

  const crawl: CrawlResult | null = crawlPayload
    ? {
        succeeded: crawlSucceeded,
        startUrl: prospect.website_url ?? '',
        finalUrl: crawlRecord?.source_url ?? null,
        // Feature computation reads page-level flags; reconstruct a single
        // synthetic page carrying the distilled signals we persisted.
        pages: crawlSucceeded
          ? [
              {
                url: crawlRecord?.source_url ?? prospect.website_url ?? '',
                statusCode: 200,
                contentType: 'text/html',
                byteSize: 0,
                responseTimeMs: Number(crawlPayload['duration_ms'] ?? 0),
                depth: 0,
                title: null,
                metaDescription: null,
                lang: (crawlPayload['html_lang'] as string | undefined) ?? null,
                internalLinks: [],
                outboundLinks: [],
                scriptSrcs: [],
                iframeSrcs: [],
                formActions: [],
                bookingLinks: [],
                bookingButtonTargets: [],
                structuredDataUrls: [],
                emails: prospect.email ? [prospect.email] : [],
                phones: prospect.phone_e164 ? [prospect.phone_e164] : [],
                instagramHandles: [],
                facebookUrls: [],
                tiktokHandles: [],
                hasContactForm: crawlPayload['has_contact_form'] === true,
                hasMobileViewport: crawlPayload['has_mobile_viewport'] === true,
                hasStructuredData: crawlPayload['has_structured_data'] === true,
                hasEcommerceSignal: crawlPayload['has_ecommerce'] === true,
                hasGiftCardSignal: crawlPayload['has_gift_cards'] === true,
                cms: (crawlPayload['cms'] as string | null) ?? null,
                analytics: Array.isArray(crawlPayload['analytics']) ? (crawlPayload['analytics'] as string[]) : [],
                teamMemberCount: (crawlPayload['team_member_count'] as number | null) ?? null,
                priceCount: Number(crawlPayload['price_count'] ?? 0),
              },
            ]
          : [],
        redirectChain: Array.isArray(crawlPayload['redirect_chain']) ? (crawlPayload['redirect_chain'] as string[]) : [],
        httpsSupported: (crawlPayload['https_supported'] as boolean | null) ?? null,
        failureReason: (crawlPayload['failure_reason'] as string | null) ?? null,
        brokenLinks: Array.isArray(crawlPayload['broken_links']) ? (crawlPayload['broken_links'] as string[]) : [],
        totalDurationMs: Number(crawlPayload['duration_ms'] ?? 0),
      }
    : null

  const competitorDetections: CompetitorDetection[] = observationsResult.rows
    .filter((row) => row.is_current)
    .map((row) => ({
      providerKey: row.provider_key as CompetitorDetection['providerKey'],
      detectionMethod: row.detection_method as CompetitorDetection['detectionMethod'],
      evidence: row.evidence ?? '',
      evidenceUrl: row.evidence_url,
      confidence: Number(row.confidence),
    }))

  const currentObservation = observationsResult.rows.find((row) => row.is_current)
  const competitorTenureDays =
    currentObservation && !['NO_BOOKING', 'UNKNOWN'].includes(currentObservation.provider_key)
      ? (Date.now() - new Date(currentObservation.first_seen_at).getTime()) / 86_400_000
      : null

  return {
    featureInput: {
      prospect: {
        id: prospect.id,
        type: prospect.type,
        country: prospect.country,
        city: location?.city ?? null,
        rating: prospect.rating === null ? null : Number(prospect.rating),
        reviewCount: prospect.review_count,
        estimatedBarberCount: prospect.estimated_barber_count,
        hasPhone: prospect.phone_e164 !== null,
        hasEmail: prospect.email !== null,
        websiteUrl: prospect.website_url,
      },
      crawl,
      competitorDetections,
      socialProfiles: socialResult.rows.map((row) => ({
        platform: row.platform,
        handle: row.handle,
        isBusinessAccount: row.is_business_account,
      })),
      sourceCount: Number(sourceStats?.source_count ?? 0),
      locationCount: Number(location?.location_count ?? 0),
    },
    sireneCountry: sourceStats?.sirene_country ?? null,
    addressCountry: location?.country ?? null,
    providerLocale: null,
    phoneE164: prospect.phone_e164,
    competitorTenureDays,
    hasAmbiguousIdentityMatch: ambiguousResult.rows[0]?.exists ?? false,
    sourceConfidenceAvg: sourceStats?.avg_confidence === null || sourceStats?.avg_confidence === undefined ? null : Number(sourceStats.avg_confidence),
    enrichmentAttempted: crawlPayload !== null,
    enrichmentSucceeded: crawlSucceeded,
    conflictCount: Math.max(0, Number(sourceStats?.conflict_count ?? 1) - 1),
  }
}

/**
 * Data-quality snapshot (spec §18). Completeness is measured against what
 * we could plausibly know, and enrichment_success is tri-state so
 * "never attempted" is visibly different from "attempted and failed".
 */
async function computeAndPersistDataQuality(pool: DbPool, prospectId: string, snapshot: ProspectSnapshot): Promise<number> {
  const p = snapshot.featureInput.prospect

  const identityFields = [p.country !== null, snapshot.addressCountry !== null, snapshot.featureInput.locationCount > 0]
  const contactFields = [p.hasPhone, p.hasEmail, p.websiteUrl !== null]
  const digitalFields = [
    p.websiteUrl !== null,
    snapshot.featureInput.socialProfiles.length > 0,
    snapshot.featureInput.competitorDetections.length > 0,
  ]

  const ratio = (flags: boolean[]): number => (flags.length === 0 ? 0 : flags.filter(Boolean).length / flags.length)

  const identityCompleteness = ratio(identityFields)
  const contactCompleteness = ratio(contactFields)
  const digitalCompleteness = ratio(digitalFields)

  const enrichmentSuccess: Tribool = !snapshot.enrichmentAttempted ? 'UNKNOWN' : snapshot.enrichmentSucceeded ? 'TRUE' : 'FALSE'

  // Agreement across sources is only meaningful with 2+ sources; with one
  // source it is NULL, not 1.0 (a single source trivially agrees with
  // itself, and reporting that as perfect agreement is misleading).
  const sourceAgreement =
    snapshot.featureInput.sourceCount >= 2
      ? Math.max(0, 1 - snapshot.conflictCount / Math.max(1, snapshot.featureInput.sourceCount))
      : null

  const overallConfidence =
    0.3 * identityCompleteness +
    0.3 * contactCompleteness +
    0.2 * digitalCompleteness +
    0.2 * (snapshot.sourceConfidenceAvg ?? 0)

  const freshnessResult = await pool.query<{ days: string | null }>(
    `select extract(epoch from (now() - max(fetched_at))) / 86400 as days
     from public.prospect_source_records where prospect_id = $1`,
    [prospectId],
  )

  await pool.query(
    `insert into public.prospect_data_quality
       (prospect_id, identity_completeness, contact_completeness, digital_completeness,
        source_count, source_agreement, conflict_count, enrichment_success,
        data_freshness_days, overall_confidence, computed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::public.prospect_tribool, $9, $10, now())
     on conflict (prospect_id) do update
     set identity_completeness = excluded.identity_completeness,
         contact_completeness = excluded.contact_completeness,
         digital_completeness = excluded.digital_completeness,
         source_count = excluded.source_count,
         source_agreement = excluded.source_agreement,
         conflict_count = excluded.conflict_count,
         enrichment_success = excluded.enrichment_success,
         data_freshness_days = excluded.data_freshness_days,
         overall_confidence = excluded.overall_confidence,
         computed_at = now()`,
    [
      prospectId,
      identityCompleteness.toFixed(4),
      contactCompleteness.toFixed(4),
      digitalCompleteness.toFixed(4),
      snapshot.featureInput.sourceCount,
      sourceAgreement === null ? null : sourceAgreement.toFixed(4),
      snapshot.conflictCount,
      enrichmentSuccess,
      freshnessResult.rows[0]?.days ?? null,
      overallConfidence.toFixed(4),
    ],
  )

  return Number(overallConfidence.toFixed(4))
}

/** Re-exported for the parse helper used by callers reading persisted features. */
export { parseTribool }
