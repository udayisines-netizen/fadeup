import type { Config } from '../config.js'
import { peekPool, type DbPool } from '../db.js'
import {
  canonicalizePlanityUrl,
  isBarberRelevantSchemaType,
  parsePlanityListing,
  type PlanityListingItem,
} from '../competitors/planity.js'
import { PlanityClient } from '../competitors/planity-client.js'
import type { DiscoveryQuery, RawCandidate, SourceAdapter, SourceAdapterContext } from './types.js'

/**
 * Planity as a first-class discovery source.
 *
 * WHAT MAKES THIS COMPLIANT
 *
 * Planity publishes a barber-specific category tree — `/barbier/{city}` — and
 * advertises a sitemap from robots.txt. Both are surfaces built to be read by
 * machines. This adapter uses only those two:
 *
 *   sitemap (published index)  ->  the listing URL for a city
 *   listing page (ItemList)    ->  candidates
 *
 * It never constructs a Planity URL from a business name or a guessed slug.
 * That distinction is the whole difference between using a published index and
 * brute-forcing an infrastructure, and it is why city resolution goes through
 * the sitemap even though building `/barbier/paris-75` by hand would be easier.
 *
 * DISCOVERY IS CHEAP, ON PURPOSE
 *
 * One listing page carries twenty establishments with name, full postal
 * address, rating, review count and canonical URL — everything a RawCandidate
 * needs. So discovery fetches listing pages and NOTHING else. It does not open
 * a single establishment page.
 *
 * Detail parsing already exists as `planity_enrichment`, which is scheduled by
 * freshness and reads one page per prospect. Fetching twenty detail pages here
 * would make discovery twenty times more expensive to learn things enrichment
 * is going to fetch anyway.
 *
 * WHAT IT REFUSES TO DO
 *
 *   * No detail-page fetching during discovery.
 *   * No unbounded pagination — capped, and it stops the moment maxCandidates
 *     is satisfied.
 *   * No country other than France.
 *   * No nail bars. Planity's own barber listing returns NailSalon entries, and
 *     shipping those into FadeUp as barbershops would be the source deciding
 *     FadeUp's market for it.
 */
export class PlanityAdapter implements SourceAdapter {
  readonly key = 'planity'
  readonly displayName = 'Planity (public listings)'

  /**
   * Resolved city -> listing URL, and the parsed index that produced it.
   * Per-process: the sitemap is ~7 MB a shard, and paying that once per worker
   * lifetime is the difference between this being usable and not.
   */
  private listingIndex: Map<string, string> | null = null
  private indexShardsLoaded = 0

  constructor(private readonly config: Config) {}

  /**
   * No credential exists to check — these are public pages. "Configured"
   * therefore means "switched on", matching how the operator actually
   * experiences it in `sources list`.
   */
  isConfigured(): boolean {
    return this.config.PLANITY_ENABLED
  }

  async discover(query: DiscoveryQuery, ctx: SourceAdapterContext): Promise<RawCandidate[]> {
    if (!this.config.PLANITY_ENABLED) {
      ctx.logger.debug('planity: skipped — source disabled')
      return []
    }

    // Planity's coverage is France-weighted and its category slugs are French.
    // Running this against another country would send French-language requests
    // at pages that do not exist and report the 404s as "no barbershops".
    if (query.country !== 'FR') {
      ctx.logger.debug('planity: skipped — France-only source', { country: query.country })
      return []
    }

    if (!query.city) {
      // Planity's discovery surface is city-indexed. A lat/lon query has no
      // listing page to read, and geocoding it here would be inventing a
      // capability this adapter does not have.
      ctx.logger.debug('planity: skipped — no city in query')
      return []
    }

    const client = this.buildClient(ctx)
    const maxCandidates = Math.max(1, Math.min(query.maxCandidates ?? 50, 200))

    const listingUrl = await this.resolveListingUrl(client, query.city, ctx)
    if (!listingUrl) {
      // LIMITED DISCOVERY, reported honestly. "Planity publishes no barber
      // listing for this city" is a real observation; it is NOT "this city has
      // no barbers", and it is not a failure either.
      ctx.logger.info('planity: no published listing for this city — limited discovery', {
        city: query.city,
        shards_loaded: this.indexShardsLoaded,
      })
      return []
    }

    return this.collectFromListing(client, listingUrl, maxCandidates, ctx)
  }

  /** Overridable in tests; the pool is only needed for the quota guard. */
  protected buildClient(ctx: SourceAdapterContext): PlanityClient {
    return new PlanityClient(this.poolForQuota(), ctx.jobId, ctx.logger, {
      timeoutMs: this.config.PLANITY_REQUEST_TIMEOUT_MS,
      minRequestIntervalMs: this.config.PLANITY_MIN_REQUEST_INTERVAL_MS,
      maxResponseBytes: 4 * 1024 * 1024,
    })
  }

  /**
   * The worker's pool when running inside the worker, a stub otherwise.
   *
   * The quota guard needs a pool, and SourceAdapter deliberately has none —
   * widening that interface for one source would make every other adapter
   * carry a dependency it does not use.
   *
   * Inside a job the process pool already exists, so quota accounting, source
   * pausing and api_source_health all work normally. Under `cli.js source
   * test` there is no pool and `peekPool` returns undefined; rather than
   * opening a database connection for a read-only probe, the client gets a
   * stub that reports the source as un-paused. A CLI probe consumes no budget
   * anyone is tracking, and the request itself is still rate-limited and
   * robots-checked by the client.
   */
  private poolForQuota(): DbPool {
    return peekPool() ?? unpausedStubPool()
  }

  /**
   * City -> listing URL, resolved through Planity's own published sitemap.
   *
   * Shards are scanned in order and the scan STOPS at the first match, so a
   * common city costs a few shards and a miss costs the cap. Only city-level
   * `/barbier/` URLs are retained — the service-refined tree
   * (`/barbier/barbe/paris-75`) is a narrower slice of the same businesses and
   * reading it as well would return duplicates.
   */
  private async resolveListingUrl(
    client: PlanityClient,
    city: string,
    ctx: SourceAdapterContext,
  ): Promise<string | null> {
    const wanted = citySlug(city)

    if (this.listingIndex) {
      return this.listingIndex.get(wanted) ?? null
    }

    const index = new Map<string, string>()
    const maxShards = Math.max(1, Math.min(this.config.PLANITY_MAX_SITEMAP_SHARDS, 20))

    for (let shard = 0; shard < maxShards; shard += 1) {
      const outcome = await client.fetchSitemap(`https://www.planity.com/sitemap-${shard}.xml`)

      if (outcome.status === 'not_found') break
      if (outcome.status !== 'ok') {
        ctx.logger.warn('planity: sitemap shard unavailable — city resolution may be incomplete', {
          shard,
          status: outcome.status,
        })
        break
      }

      this.indexShardsLoaded = shard + 1
      for (const [slug, url] of extractCityListings(outcome.html)) {
        if (!index.has(slug)) index.set(slug, url)
      }

      // Early stop: the caller wants one city, not the whole index.
      if (index.has(wanted)) break
    }

    // Cached even on a miss. Without this, a city Planity does not cover would
    // re-scan every shard on every discovery job forever.
    this.listingIndex = index
    return index.get(wanted) ?? null
  }

  /**
   * Walks listing pages until maxCandidates is satisfied or the bound is hit.
   *
   * Early stopping is the point. A Paris barber listing runs to 29 pages; a
   * query for five candidates must read one page, not twenty-nine.
   */
  private async collectFromListing(
    client: PlanityClient,
    firstPageUrl: string,
    maxCandidates: number,
    ctx: SourceAdapterContext,
  ): Promise<RawCandidate[]> {
    const candidates: RawCandidate[] = []
    const seen = new Set<string>()
    const maxPages = Math.max(1, Math.min(this.config.PLANITY_MAX_DISCOVERY_PAGES, 20))

    let nextUrl: string | null = firstPageUrl
    let page = 0

    while (nextUrl && page < maxPages && candidates.length < maxCandidates) {
      const outcome: Awaited<ReturnType<PlanityClient['fetchListing']>> = await client.fetchListing(nextUrl)
      page += 1

      if (outcome.status !== 'ok') {
        // A blocked, refused or failed page is NOT an empty city. Throwing lets
        // the discovery job record a real source failure on this job's
        // prospect_job_sources row instead of a clean zero — the Overpass
        // silent-zero lesson, applied to a different provider.
        if (candidates.length > 0) {
          ctx.logger.warn('planity: listing page failed mid-walk — returning what was already collected', {
            page,
            status: outcome.status,
          })
          break
        }
        throw new PlanityListingError(outcome.status, 'reason' in outcome ? String(outcome.reason) : null)
      }

      const listing = parsePlanityListing(outcome.html, outcome.finalUrl)

      if (!listing.hasStructuredData) {
        // The page loaded and carried no ItemList. That is a changed layout,
        // not a city without barbers, and reporting it as zero would poison
        // every downstream count.
        if (candidates.length > 0) break
        throw new PlanityListingError('parser_degraded', 'no ItemList in listing page')
      }

      for (const item of listing.items) {
        if (candidates.length >= maxCandidates) break
        if (seen.has(item.canonicalUrl)) continue
        seen.add(item.canonicalUrl)

        if (!isBarberRelevantSchemaType(item.schemaType)) {
          ctx.logger.debug('planity: skipping non-barber listing entry', { schema_type: item.schemaType })
          continue
        }

        candidates.push(toRawCandidate(item))
      }

      nextUrl = listing.nextPageUrl
    }

    ctx.logger.info('planity: discovery complete', {
      candidates: candidates.length,
      pages_read: page,
      early_stopped: candidates.length >= maxCandidates,
    })

    return candidates
  }
}

/**
 * A listing page that could not be read.
 *
 * Deliberately an ERROR rather than an empty array. The discovery job records a
 * thrown source failure on prospect_job_sources; an empty array would be
 * recorded as "completed, 0 candidates", which is how a timed-out geographic
 * cell comes to look permanently exhausted.
 */
export class PlanityListingError extends Error {
  readonly retryable = true

  constructor(
    readonly outcome: string,
    detail: string | null,
  ) {
    super(`planity listing unavailable (${outcome}${detail ? `: ${detail}` : ''})`)
    this.name = 'PlanityListingError'
  }
}

/**
 * A listing entry as a RawCandidate.
 *
 * `externalId` is the canonical URL rather than an invented identifier: Planity
 * exposes no stable public establishment id, and the canonical URL is stable,
 * unique and already the thing every other part of this subsystem keys on. It
 * is also what makes re-running discovery idempotent — the same establishment
 * produces the same external id, so prospect_source_records' unique
 * (source_id, external_id) collapses the repeat.
 *
 * Only fields the listing actually carries are populated. Nothing is inferred:
 * a listing has no phone and no coordinates, so those stay absent rather than
 * being filled with a plausible guess.
 */
function toRawCandidate(item: PlanityListingItem): RawCandidate {
  return {
    externalId: item.canonicalUrl,
    externalType: 'planity_establishment',
    sourceUrl: item.canonicalUrl,
    name: item.name,
    category: item.schemaType ?? undefined,
    addressLine: item.streetAddress ?? undefined,
    city: item.city ?? undefined,
    postalCode: item.postalCode ?? undefined,
    country: item.countryCode ?? 'FR',
    // The business's Planity page IS a website of theirs, and recording it here
    // is what lets planity_enrichment find this prospect later without a crawl.
    websiteUrl: item.canonicalUrl,
    // Below Google Places' 0.9 and above a bare directory listing. Planity
    // publishes a structured record the business itself maintains, which is
    // strong — but it is a commercial platform, not a registry.
    confidence: 0.85,
    rawPayload: {
      canonicalPlanityUrl: item.canonicalUrl,
      schemaType: item.schemaType,
      rating: item.rating,
      reviewCount: item.reviewCount,
      // Booking status is deliberately absent: a listing does not show it, and
      // guessing ACTIVE from "is listed" is exactly what R4.1 forbids.
      bookingStatus: 'UNKNOWN',
    },
  }
}

/**
 * Extracts city-level `/barbier/` listing URLs from one sitemap shard.
 *
 * Regex over the XML rather than a parser: the shards are ~7 MB and this needs
 * one field. Only two-segment paths are kept — a three-segment path is the
 * service-refined tree, which lists a subset of the same businesses.
 */
function extractCityListings(xml: string): [string, string][] {
  const out: [string, string][] = []

  for (const match of xml.matchAll(/<loc>(https:\/\/www\.planity\.com\/barbier\/[^<]+)<\/loc>/g)) {
    const url = canonicalizePlanityUrl(match[1]!)
    if (!url) continue

    const segments = new URL(url).pathname.split('/').filter(Boolean)
    if (segments.length !== 2) continue

    out.push([normalizeSlug(segments[1]!), url])
  }

  return out
}

/**
 * A city name as it appears in a Planity listing slug.
 *
 * Planity uses two forms — `paris-75` (city + department) and `76380-montigny`
 * (postcode + city) — so the index is keyed on the CITY token of each, and a
 * query for "Paris" or "Montigny" resolves either way.
 */
function citySlug(city: string): string {
  return normalizeSlug(city)
}

/** Strips the numeric department/postcode token and normalises the rest. */
function normalizeSlug(raw: string): string {
  const slug = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug
    .split('-')
    .filter((part) => part !== '' && !/^\d+$/.test(part))
    .join('-')
}

/**
 * A pool-shaped object that answers only the pause check, used when no worker
 * pool exists. Records nothing, because there is nothing to record against.
 */
function unpausedStubPool(): DbPool {
  return {
    query: async (text: string) => {
      if (typeof text === 'string' && text.includes('is_prospect_source_paused')) {
        return { rows: [{ is_prospect_source_paused: false }] }
      }
      return { rows: [] }
    },
  } as unknown as DbPool
}
