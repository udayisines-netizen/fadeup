import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import type { Config } from '../config.js'
import type { ProspectJob } from '../queue/types.js'
import { crawlWebsite, DEFAULT_CRAWL_LIMITS, type CrawlResult } from '../crawler/crawl.js'
import { CompetitorRegistry } from '../competitors/registry.js'
import { detectCompetitors, noBookingDetection, type CompetitorDetection } from '../competitors/detect.js'
import { normalizeEmail, normalizeSocialHandle } from '../normalize/email.js'
import { normalizePhoneE164 } from '../normalize/phone.js'

/**
 * Website enrichment + competitor detection for a single prospect.
 *
 * The pivotal rule (spec §17): this job distinguishes three outcomes, and
 * they must stay distinct all the way into the database.
 *
 *   crawl succeeded, provider found      -> that provider, is_current
 *   crawl succeeded, no provider found   -> NO_BOOKING (a real negative)
 *   crawl did NOT succeed                -> NOTHING recorded; the prospect
 *                                           stays UNKNOWN
 *
 * The third case is the one that is easy to get wrong and expensive to get
 * wrong: writing NO_BOOKING after a timeout would put a barber who has
 * used Planity for years into a "you can't take bookings online" campaign.
 */

export interface WebsiteEnrichmentResult {
  prospectId: string
  crawlSucceeded: boolean
  failureReason: string | null
  pagesCrawled: number
  competitorDetections: number
  currentProvider: string | null
  contactsDiscovered: { email: boolean; phone: boolean; instagram: boolean }
}

export async function runWebsiteEnrichmentJob(
  pool: DbPool,
  job: ProspectJob,
  config: Config,
  log: Logger,
): Promise<WebsiteEnrichmentResult> {
  const payload = job.payload as Record<string, unknown>
  const prospectId = String(payload['prospectId'] ?? '')

  if (!prospectId) {
    throw new Error('website_enrichment: payload.prospectId is required')
  }

  const prospectResult = await pool.query<{ website_url: string | null; country: string }>(
    `select website_url, country from public.prospects where id = $1`,
    [prospectId],
  )
  const prospect = prospectResult.rows[0]
  if (!prospect) {
    throw new Error(`website_enrichment: prospect ${prospectId} not found`)
  }

  const registry = await CompetitorRegistry.load(pool)

  if (!prospect.website_url) {
    // No website URL from ANY source. That is an observed absence of a
    // website, but it says nothing about booking — a barber can take
    // bookings on Booksy with no website at all. Record neither.
    log.info('website_enrichment: prospect has no website url — nothing to crawl', { prospect_id: prospectId })
    await recordEnrichmentAttempt(pool, prospectId, null, 'no_website_url')
    return {
      prospectId,
      crawlSucceeded: false,
      failureReason: 'no_website_url',
      pagesCrawled: 0,
      competitorDetections: 0,
      currentProvider: null,
      contactsDiscovered: { email: false, phone: false, instagram: false },
    }
  }

  const crawl = await crawlWebsite(prospect.website_url, log.child({ prospect_id: prospectId }), {
    ...DEFAULT_CRAWL_LIMITS,
    maxPagesPerDomain: config.CRAWLER_MAX_PAGES_PER_DOMAIN,
    maxDepth: config.CRAWLER_MAX_DEPTH,
    totalCrawlTimeoutMs: config.CRAWLER_TOTAL_TIMEOUT_MS,
  })

  await recordEnrichmentAttempt(pool, prospectId, crawl, crawl.failureReason)

  if (!crawl.succeeded) {
    log.info('website_enrichment: crawl did not succeed — booking status stays UNKNOWN', {
      prospect_id: prospectId,
      reason: crawl.failureReason,
    })
    return {
      prospectId,
      crawlSucceeded: false,
      failureReason: crawl.failureReason,
      pagesCrawled: 0,
      competitorDetections: 0,
      currentProvider: null,
      contactsDiscovered: { email: false, phone: false, instagram: false },
    }
  }

  // --- Competitor detection --------------------------------------------
  const detections = detectCompetitors(crawl.pages, registry)
  const toRecord: CompetitorDetection[] =
    detections.length > 0 ? detections : [noBookingDetection(crawl.finalUrl ?? prospect.website_url, crawl.pages.length)]

  // Record every detection as an observation. The DB trigger keeps exactly
  // one current row per (prospect, provider) and retires the rest, so
  // history accumulates without the writer coordinating.
  const strongest = toRecord[0]!
  for (const detection of toRecord) {
    await pool.query(
      `insert into public.booking_provider_observations
         (prospect_id, provider_id, detection_method, evidence, evidence_url, confidence, job_id, is_current)
       select $1, bp.id, $2::public.booking_provider_detection_method, $3, $4, $5, $6, $7
       from public.booking_providers bp where bp.key = $8`,
      [
        prospectId,
        detection.detectionMethod,
        detection.evidence,
        detection.evidenceUrl,
        detection.confidence,
        job.id,
        // Only the strongest becomes current; weaker corroborating
        // detections are recorded as historical evidence.
        detection === strongest,
        detection.providerKey,
      ],
    )
  }

  // --- Contact discovery -----------------------------------------------
  const emails = [...new Set(crawl.pages.flatMap((p) => p.emails))]
    .map((e) => normalizeEmail(e))
    .filter((e): e is string => e !== null)
  const phones = [...new Set(crawl.pages.flatMap((p) => p.phones))]
    .map((p) => normalizePhoneE164(p, prospect.country))
    .filter((p): p is string => p !== null)
  const instagramHandles = [...new Set(crawl.pages.flatMap((p) => p.instagramHandles))]
    .map((h) => normalizeSocialHandle(h))
    .filter((h): h is string => h !== null)

  const email = emails[0] ?? null
  const phone = phones[0] ?? null

  if (email || phone) {
    // Only fill gaps — a value already confirmed by a higher-provenance
    // source is never overwritten by a page scrape.
    await pool.query(
      `update public.prospects
       set email = coalesce(email, $2), phone_e164 = coalesce(phone_e164, $3), last_enriched_at = now()
       where id = $1`,
      [prospectId, email, phone],
    )
  } else {
    await pool.query(`update public.prospects set last_enriched_at = now() where id = $1`, [prospectId])
  }

  for (const handle of instagramHandles.slice(0, 3)) {
    await pool.query(
      `insert into public.prospect_social_profiles (prospect_id, platform, handle, url)
       values ($1, 'instagram', $2, $3)
       on conflict (prospect_id, platform, handle) where handle is not null do nothing`,
      [prospectId, handle, `https://www.instagram.com/${handle}/`],
    )
  }

  for (const facebookUrl of [...new Set(crawl.pages.flatMap((p) => p.facebookUrls))].slice(0, 2)) {
    await pool.query(
      `insert into public.prospect_social_profiles (prospect_id, platform, url)
       values ($1, 'facebook', $2)
       on conflict do nothing`,
      [prospectId, facebookUrl],
    )
  }

  for (const tiktok of [...new Set(crawl.pages.flatMap((p) => p.tiktokHandles))].slice(0, 2)) {
    await pool.query(
      `insert into public.prospect_social_profiles (prospect_id, platform, handle, url)
       values ($1, 'tiktok', $2, $3)
       on conflict (prospect_id, platform, handle) where handle is not null do nothing`,
      [prospectId, tiktok, `https://www.tiktok.com/@${tiktok}`],
    )
  }

  log.info('website_enrichment: completed', {
    prospect_id: prospectId,
    pages: crawl.pages.length,
    provider: strongest.providerKey,
    detections: detections.length,
  })

  return {
    prospectId,
    crawlSucceeded: true,
    failureReason: null,
    pagesCrawled: crawl.pages.length,
    competitorDetections: detections.length,
    currentProvider: strongest.providerKey,
    contactsDiscovered: { email: email !== null, phone: phone !== null, instagram: instagramHandles.length > 0 },
  }
}

/**
 * Persists the crawl outcome as a source record, so provenance exists even
 * for a FAILED crawl. Knowing that we tried and could not reach a site is
 * itself valuable — it is the difference between UNKNOWN and never-checked.
 */
async function recordEnrichmentAttempt(
  pool: DbPool,
  prospectId: string,
  crawl: CrawlResult | null,
  failureReason: string | null,
): Promise<void> {
  await pool.query(
    `insert into public.prospect_source_records
       (source_id, prospect_id, external_id, external_type, source_url, raw_payload, confidence)
     select s.id, $1, $2, 'website_crawl', $3, $4, $5
     from public.prospect_sources s where s.key = 'website'
     on conflict (source_id, external_id) where external_id is not null
     do update set prospect_id = excluded.prospect_id,
                   raw_payload = excluded.raw_payload,
                   last_verified_at = now()`,
    [
      prospectId,
      // One provenance row per prospect's website crawl, updated in place.
      `crawl:${prospectId}`,
      crawl?.finalUrl ?? crawl?.startUrl ?? null,
      // The distilled signals feature computation reads back. Storing the
      // derived flags rather than the page bodies keeps this table bounded
      // (spec §14: never store full page bodies) while still letting the
      // feature job run without re-crawling.
      JSON.stringify({
        succeeded: crawl?.succeeded ?? false,
        failure_reason: failureReason,
        pages_crawled: crawl?.pages.length ?? 0,
        https_supported: crawl?.httpsSupported ?? null,
        redirect_chain: crawl?.redirectChain.slice(0, 10) ?? [],
        broken_links: crawl?.brokenLinks.slice(0, 10) ?? [],
        duration_ms: crawl?.totalDurationMs ?? null,
        cms: crawl?.pages.find((p) => p.cms !== null)?.cms ?? null,
        analytics: [...new Set(crawl?.pages.flatMap((p) => p.analytics) ?? [])],
        html_lang: crawl?.pages[0]?.lang ?? null,
        has_mobile_viewport: crawl?.pages.some((p) => p.hasMobileViewport) ?? false,
        has_contact_form: crawl?.pages.some((p) => p.hasContactForm) ?? false,
        has_structured_data: crawl?.pages.some((p) => p.hasStructuredData) ?? false,
        has_ecommerce: crawl?.pages.some((p) => p.hasEcommerceSignal) ?? false,
        has_gift_cards: crawl?.pages.some((p) => p.hasGiftCardSignal) ?? false,
        team_member_count:
          crawl && crawl.pages.some((p) => p.teamMemberCount !== null)
            ? Math.max(...crawl.pages.map((p) => p.teamMemberCount ?? 0))
            : null,
        price_count: Math.max(0, ...(crawl?.pages.map((p) => p.priceCount) ?? [0])),
        page_titles: crawl?.pages.slice(0, 5).map((p) => p.title).filter(Boolean) ?? [],
      }),
      crawl?.succeeded ? 0.8 : 0.1,
    ],
  )
}
