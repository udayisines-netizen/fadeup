import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig, resetConfigCache } from '../src/config.js'
import { buildSourceRegistry } from '../src/sources/registry.js'
import { PlanityAdapter, PlanityListingError } from '../src/sources/planity.js'
import {
  isPlanityListingUrl,
  isPlanitySitemapUrl,
  isBarberRelevantSchemaType,
  parsePlanityListing,
} from '../src/competitors/planity.js'
import { logger } from '../src/logger.js'
import { planityListingPage, planitySitemap, PLANITY_ROBOTS } from './fixtures/planity.js'

/**
 * Planity as a first-class SourceAdapter.
 *
 * The properties under test are the ones that make a discovery source safe to
 * point at a third party: it stops when asked, it does not wander, it does not
 * turn a failure into an empty result, and it does not decide FadeUp's market
 * by ingesting whatever the provider happened to list.
 */

const ctx = { jobId: null, logger }

function baseEnv(overrides: Record<string, string> = {}) {
  return {
    DB_HOST: 'localhost',
    DB_NAME: 'test',
    DB_USER: 'test',
    DB_PASSWORD: 'test',
    // Zero so tests do not sit out the politeness delay.
    PLANITY_MIN_REQUEST_INTERVAL_MS: '0',
    ...overrides,
  }
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } })
}

/**
 * Serves robots, sitemap shards and listing pages by URL, and records every
 * request so bounds and early stopping can be asserted on the REQUESTS made,
 * not merely on the value returned.
 */
function stubPlanity(routes: Record<string, () => Response>, fallback?: () => Response) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const href = String(url)
      calls.push(href)
      if (href.endsWith('/robots.txt')) {
        return new Response(PLANITY_ROBOTS, { status: 200, headers: { 'content-type': 'text/plain' } })
      }
      const route = routes[href]
      if (route) return route()
      if (fallback) return fallback()
      return new Response('not found', { status: 404 })
    }),
  )
  return { calls }
}

/** Requests that are not robots and not a sitemap — i.e. actual listing reads. */
function listingCalls(calls: string[]): string[] {
  return calls.filter((c) => !c.endsWith('/robots.txt') && !/sitemap-\d+\.xml$/.test(c))
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetConfigCache()
})

describe('source registration', () => {
  it('planity is in the source registry alongside the other adapters', () => {
    const registry = buildSourceRegistry(loadConfig(baseEnv()))
    expect([...registry.keys()]).toEqual(
      expect.arrayContaining(['osm', 'geoapify', 'sirene', 'google_places', 'website', 'instagram', 'planity']),
    )
  })

  it('reports configured when enabled — it needs no credential', () => {
    // Unlike Google/Geoapify/Instagram there is no key to hold, so "configured"
    // can only sensibly mean "switched on".
    expect(new PlanityAdapter(loadConfig(baseEnv())).isConfigured()).toBe(true)
  })

  it('reports NOT configured when explicitly disabled', () => {
    expect(new PlanityAdapter(loadConfig(baseEnv({ PLANITY_ENABLED: 'false' }))).isConfigured()).toBe(false)
  })

  it('treats an unrecognised PLANITY_ENABLED value as disabled', () => {
    // Fail closed: a typo must not start sending requests at a third party.
    expect(new PlanityAdapter(loadConfig(baseEnv({ PLANITY_ENABLED: 'yes-please' }))).isConfigured()).toBe(false)
  })

  it('exposes a display name for `sources list`', () => {
    expect(new PlanityAdapter(loadConfig(baseEnv())).displayName).toContain('Planity')
  })
})

describe('geographic and query scope', () => {
  it('skips a non-French country without making a request', async () => {
    const { calls } = stubPlanity({})
    const adapter = new PlanityAdapter(loadConfig(baseEnv()))

    const result = await adapter.discover({ country: 'GB', city: 'London' }, ctx)

    expect(result).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('skips a query with no city — there is no listing page to read', async () => {
    const { calls } = stubPlanity({})
    const adapter = new PlanityAdapter(loadConfig(baseEnv()))

    const result = await adapter.discover({ country: 'FR', latitude: 48.85, longitude: 2.35 }, ctx)

    expect(result).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('makes no request at all when the source is disabled', async () => {
    const { calls } = stubPlanity({})
    const adapter = new PlanityAdapter(loadConfig(baseEnv({ PLANITY_ENABLED: 'false' })))

    expect(await adapter.discover({ country: 'FR', city: 'Paris' }, ctx)).toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe('city resolution through the published sitemap', () => {
  it('resolves a city and reads its listing', async () => {
    const { calls } = stubPlanity({
      'https://www.planity.com/sitemap-0.xml': () => html(planitySitemap(['paris-75'])),
      'https://www.planity.com/barbier/paris-75': () => html(planityListingPage({ salons: 3 })),
    })
    const adapter = new PlanityAdapter(loadConfig(baseEnv()))

    const result = await adapter.discover({ country: 'FR', city: 'Paris' }, ctx)

    expect(result).toHaveLength(3)
    expect(calls).toContain('https://www.planity.com/barbier/paris-75')
  })

  it('resolves the postcode-first slug form too', async () => {
    stubPlanity({
      'https://www.planity.com/sitemap-0.xml': () => html(planitySitemap(['76380-montigny'])),
      'https://www.planity.com/barbier/76380-montigny': () => html(planityListingPage({ salons: 1 })),
    })
    const adapter = new PlanityAdapter(loadConfig(baseEnv()))

    expect(await adapter.discover({ country: 'FR', city: 'Montigny' }, ctx)).toHaveLength(1)
  })

  it('stops scanning shards as soon as the city is found', async () => {
    const { calls } = stubPlanity({
      'https://www.planity.com/sitemap-0.xml': () => html(planitySitemap(['paris-75'])),
      'https://www.planity.com/barbier/paris-75': () => html(planityListingPage({ salons: 1 })),
    })
    const adapter = new PlanityAdapter(loadConfig(baseEnv()))

    await adapter.discover({ country: 'FR', city: 'Paris' }, ctx)

    const shards = calls.filter((c) => /sitemap-\d+\.xml$/.test(c))
    expect(shards).toEqual(['https://www.planity.com/sitemap-0.xml'])
  })

  it('bounds the shard scan when the city is never found', async () => {
    const { calls } = stubPlanity({}, () => html(planitySitemap(['lyon-69'])))
    const adapter = new PlanityAdapter(loadConfig(baseEnv({ PLANITY_MAX_SITEMAP_SHARDS: '3' })))

    const result = await adapter.discover({ country: 'FR', city: 'Nowhere' }, ctx)

    expect(result).toEqual([])
    expect(calls.filter((c) => /sitemap-\d+\.xml$/.test(c))).toHaveLength(3)
  })

  it('reports an uncovered city as zero candidates, not as a failure', async () => {
    stubPlanity({}, () => html(planitySitemap(['lyon-69'])))
    const adapter = new PlanityAdapter(loadConfig(baseEnv({ PLANITY_MAX_SITEMAP_SHARDS: '1' })))

    // "Planity publishes no barber listing here" is a real observation. It is
    // NOT "this city has no barbers", and it is not an error either.
    await expect(adapter.discover({ country: 'FR', city: 'Nowhere' }, ctx)).resolves.toEqual([])
  })

  it('indexes only city-level barbier URLs, never service-refined or other trees', async () => {
    // The fixture's sitemap also contains /barbier/barbe/paris-75 and a
    // manucure URL. Indexing either would produce duplicate or irrelevant
    // listings.
    stubPlanity({
      'https://www.planity.com/sitemap-0.xml': () => html(planitySitemap(['paris-75'])),
      'https://www.planity.com/barbier/paris-75': () => html(planityListingPage({ salons: 1 })),
    })
    const adapter = new PlanityAdapter(loadConfig(baseEnv()))

    expect(await adapter.discover({ country: 'FR', city: 'Paris' }, ctx)).toHaveLength(1)
  })

  it('caches the resolution, so a second discovery re-reads no sitemap', async () => {
    const { calls } = stubPlanity({
      'https://www.planity.com/sitemap-0.xml': () => html(planitySitemap(['paris-75'])),
      'https://www.planity.com/barbier/paris-75': () => html(planityListingPage({ salons: 1 })),
    })
    const adapter = new PlanityAdapter(loadConfig(baseEnv()))

    await adapter.discover({ country: 'FR', city: 'Paris' }, ctx)
    await adapter.discover({ country: 'FR', city: 'Paris' }, ctx)

    expect(calls.filter((c) => /sitemap-\d+\.xml$/.test(c))).toHaveLength(1)
  })
})

describe('candidate mapping', () => {
  async function discoverOne() {
    stubPlanity({
      'https://www.planity.com/sitemap-0.xml': () => html(planitySitemap(['paris-75'])),
      'https://www.planity.com/barbier/paris-75': () => html(planityListingPage({ salons: 1 })),
    })
    const adapter = new PlanityAdapter(loadConfig(baseEnv()))
    const [candidate] = await adapter.discover({ country: 'FR', city: 'Paris' }, ctx)
    return candidate!
  }

  it('maps a listing entry onto the standard RawCandidate shape', async () => {
    const candidate = await discoverOne()

    expect(candidate).toMatchObject({
      externalId: 'https://www.planity.com/salon-0-75000-paris',
      externalType: 'planity_establishment',
      name: 'HairSalon 0',
      addressLine: '0 Rue de Test',
      city: 'Paris',
      postalCode: '75000',
      country: 'FR',
      websiteUrl: 'https://www.planity.com/salon-0-75000-paris',
    })
    expect(candidate.confidence).toBeGreaterThan(0.5)
    expect(candidate.confidence).toBeLessThan(1)
  })

  it('uses the canonical URL as the external id, so re-discovery is idempotent', async () => {
    // prospect_source_records is unique on (source_id, external_id), so a
    // stable id is what stops a second run creating a second provenance row.
    const candidate = await discoverOne()
    expect(candidate.externalId).toBe(candidate.rawPayload['canonicalPlanityUrl'])
  })

  it('carries rating and reviews in the payload without inventing anything else', async () => {
    const candidate = await discoverOne()

    expect(candidate.rawPayload).toMatchObject({ rating: 4.5, reviewCount: 100 })
    // A listing shows a business is there, not that it is bookable.
    expect(candidate.rawPayload['bookingStatus']).toBe('UNKNOWN')
    // A listing carries no phone and no coordinates; they must stay absent
    // rather than being filled with a plausible guess.
    expect(candidate.phone).toBeUndefined()
    expect(candidate.latitude).toBeUndefined()
  })
})

describe('classification — Planity does not decide FadeUp’s market', () => {
  it('drops NailSalon entries that appear on the barber listing', async () => {
    // Observed live: "Meet Nail - Marais Paris 4" is returned by
    // /barbier/paris-75. Without this filter FadeUp ingests nail bars as
    // barbershops.
    stubPlanity({
      'https://www.planity.com/sitemap-0.xml': () => html(planitySitemap(['paris-75'])),
      'https://www.planity.com/barbier/paris-75': () => html(planityListingPage({ salons: 2, nailSalons: 3 })),
    })
    const adapter = new PlanityAdapter(loadConfig(baseEnv()))

    const result = await adapter.discover({ country: 'FR', city: 'Paris' }, ctx)

    expect(result).toHaveLength(2)
    expect(result.every((c) => c.name?.startsWith('HairSalon'))).toBe(true)
  })

  it('keeps an unfamiliar type rather than silently dropping real supply', () => {
    // A denylist fails toward keeping businesses; an allowlist would drop every
    // type Planity adds later, losing supply with no symptom.
    expect(isBarberRelevantSchemaType('BarberShop')).toBe(true)
    expect(isBarberRelevantSchemaType('HealthAndBeautyBusiness')).toBe(true)
    expect(isBarberRelevantSchemaType('SomethingNewPlanityInvented')).toBe(true)
    expect(isBarberRelevantSchemaType(null)).toBe(true)
    expect(isBarberRelevantSchemaType('NailSalon')).toBe(false)
    expect(isBarberRelevantSchemaType('DaySpa')).toBe(false)
  })
})

describe('bounds and early stopping', () => {
  it('honours maxCandidates and stops reading pages once satisfied', async () => {
    const { calls } = stubPlanity({
      'https://www.planity.com/sitemap-0.xml': () => html(planitySitemap(['paris-75'])),
      'https://www.planity.com/barbier/paris-75': () =>
        html(planityListingPage({ salons: 20, nextPage: 'https://www.planity.com/barbier/paris-75/page-2' })),
      'https://www.planity.com/barbier/paris-75/page-2': () => html(planityListingPage({ salons: 20, startIndex: 20 })),
    })
    const adapter = new PlanityAdapter(loadConfig(baseEnv()))

    const result = await adapter.discover({ country: 'FR', city: 'Paris', maxCandidates: 5 }, ctx)

    expect(result).toHaveLength(5)
    // The decisive assertion: it did not read page 2 to throw 35 rows away.
    expect(listingCalls(calls)).toEqual(['https://www.planity.com/barbier/paris-75'])
  })

  it('follows pagination when more candidates are wanted', async () => {
    const { calls } = stubPlanity({
      'https://www.planity.com/sitemap-0.xml': () => html(planitySitemap(['paris-75'])),
      'https://www.planity.com/barbier/paris-75': () =>
        html(planityListingPage({ salons: 3, nextPage: 'https://www.planity.com/barbier/paris-75/page-2' })),
      'https://www.planity.com/barbier/paris-75/page-2': () => html(planityListingPage({ salons: 3, startIndex: 10 })),
    })
    const adapter = new PlanityAdapter(loadConfig(baseEnv()))

    const result = await adapter.discover({ country: 'FR', city: 'Paris', maxCandidates: 50 }, ctx)

    expect(result).toHaveLength(6)
    expect(listingCalls(calls)).toHaveLength(2)
  })

  it('caps pagination even when the provider keeps offering a next page', async () => {
    // An endless rel=next must not become an endless walk.
    const { calls } = stubPlanity(
      { 'https://www.planity.com/sitemap-0.xml': () => html(planitySitemap(['paris-75'])) },
      () => html(planityListingPage({ salons: 2, nextPage: 'https://www.planity.com/barbier/paris-75/page-9' })),
    )
    const adapter = new PlanityAdapter(loadConfig(baseEnv({ PLANITY_MAX_DISCOVERY_PAGES: '2' })))

    await adapter.discover({ country: 'FR', city: 'Paris', maxCandidates: 500 }, ctx)

    expect(listingCalls(calls)).toHaveLength(2)
  })

  it('de-duplicates establishments repeated across pages', async () => {
    // startIndex is identical, so page 2 lists the same salons as page 1.
    stubPlanity({
      'https://www.planity.com/sitemap-0.xml': () => html(planitySitemap(['paris-75'])),
      'https://www.planity.com/barbier/paris-75': () =>
        html(planityListingPage({ salons: 3, nextPage: 'https://www.planity.com/barbier/paris-75/page-2' })),
      'https://www.planity.com/barbier/paris-75/page-2': () => html(planityListingPage({ salons: 3 })),
    })
    const adapter = new PlanityAdapter(loadConfig(baseEnv()))

    const result = await adapter.discover({ country: 'FR', city: 'Paris', maxCandidates: 50 }, ctx)

    expect(result).toHaveLength(3)
    expect(new Set(result.map((c) => c.externalId)).size).toBe(3)
  })

  it('never fetches an establishment detail page during discovery', async () => {
    const { calls } = stubPlanity({
      'https://www.planity.com/sitemap-0.xml': () => html(planitySitemap(['paris-75'])),
      'https://www.planity.com/barbier/paris-75': () => html(planityListingPage({ salons: 5 })),
    })
    const adapter = new PlanityAdapter(loadConfig(baseEnv()))

    await adapter.discover({ country: 'FR', city: 'Paris' }, ctx)

    // Detail parsing belongs to planity_enrichment. Twenty detail fetches here
    // would make discovery twenty times more expensive for data enrichment is
    // going to fetch anyway.
    expect(listingCalls(calls).every((c) => c.includes('/barbier/'))).toBe(true)
  })
})

describe('failure is never an empty city', () => {
  const cases = [
    { name: 'a 403', response: () => html('no', 403) },
    { name: 'a 429', response: () => html('slow down', 429) },
    { name: 'a challenge interstitial served with 200', response: () => html('<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>') },
    { name: 'a page whose ItemList has vanished', response: () => html(planityListingPage({ withItemList: false })) },
  ]

  it.each(cases)('throws rather than returning zero candidates on $name', async ({ response }) => {
    stubPlanity({
      'https://www.planity.com/sitemap-0.xml': () => html(planitySitemap(['paris-75'])),
      'https://www.planity.com/barbier/paris-75': response,
    })
    const adapter = new PlanityAdapter(loadConfig(baseEnv()))

    // The Overpass lesson, applied to a different provider: a silent zero here
    // would be recorded as "completed, 0 candidates" and read forever after as
    // "Paris has no barbers".
    await expect(adapter.discover({ country: 'FR', city: 'Paris' }, ctx)).rejects.toThrow(PlanityListingError)
  })

  it('returns zero candidates for a genuinely empty listing', async () => {
    // The page loaded, the ItemList was there, and it was empty. THAT is a real
    // negative observation and must not be an error.
    stubPlanity({
      'https://www.planity.com/sitemap-0.xml': () => html(planitySitemap(['paris-75'])),
      'https://www.planity.com/barbier/paris-75': () => html(planityListingPage({ salons: 0, nailSalons: 1 })),
    })
    const adapter = new PlanityAdapter(loadConfig(baseEnv()))

    await expect(adapter.discover({ country: 'FR', city: 'Paris' }, ctx)).resolves.toEqual([])
  })

  it('keeps what it already collected when a LATER page fails', async () => {
    stubPlanity({
      'https://www.planity.com/sitemap-0.xml': () => html(planitySitemap(['paris-75'])),
      'https://www.planity.com/barbier/paris-75': () =>
        html(planityListingPage({ salons: 3, nextPage: 'https://www.planity.com/barbier/paris-75/page-2' })),
      'https://www.planity.com/barbier/paris-75/page-2': () => html('no', 403),
    })
    const adapter = new PlanityAdapter(loadConfig(baseEnv()))

    // A partial result is honest; discarding three real businesses because
    // page two was refused would not be.
    await expect(adapter.discover({ country: 'FR', city: 'Paris', maxCandidates: 50 }, ctx)).resolves.toHaveLength(3)
  })

  it('classifies its failure as retryable', () => {
    expect(new PlanityListingError('blocked', 'rate_limited').retryable).toBe(true)
  })
})

describe('URL kind guards', () => {
  it('recognises listing URLs including pagination', () => {
    expect(isPlanityListingUrl('https://www.planity.com/barbier/paris-75')).toBe(true)
    expect(isPlanityListingUrl('https://www.planity.com/barbier/76380-montigny')).toBe(true)
    expect(isPlanityListingUrl('https://www.planity.com/barbier/rasage-homme/paris-75')).toBe(true)
    expect(isPlanityListingUrl('https://www.planity.com/barbier/paris-75/page-2')).toBe(true)
    expect(isPlanityListingUrl('https://www.planity.com/coiffeur/paris-75')).toBe(true)
  })

  it('refuses non-listing and non-barber-relevant trees', () => {
    expect(isPlanityListingUrl('https://www.planity.com/la-loge-76380-montigny')).toBe(false)
    expect(isPlanityListingUrl('https://www.planity.com/manucure-et-pedicure/paris-75')).toBe(false)
    expect(isPlanityListingUrl('https://www.planity.com')).toBe(false)
    expect(isPlanityListingUrl('https://evilplanity.com/barbier/paris-75')).toBe(false)
  })

  it('recognises published sitemaps only', () => {
    expect(isPlanitySitemapUrl('https://www.planity.com/sitemap.xml')).toBe(true)
    expect(isPlanitySitemapUrl('https://www.planity.com/sitemap-3.xml')).toBe(true)
    expect(isPlanitySitemapUrl('https://www.planity.com/barbier/paris-75')).toBe(false)
    expect(isPlanitySitemapUrl('https://evilplanity.com/sitemap.xml')).toBe(false)
  })
})

describe('listing parser', () => {
  it('skips entries with no url or no name instead of crashing', () => {
    const listing = parsePlanityListing(planityListingPage({ salons: 2, malformed: 3 }), 'https://www.planity.com/barbier/paris-75')
    expect(listing.items).toHaveLength(2)
    expect(listing.hasStructuredData).toBe(true)
  })

  it('reports hasStructuredData=false when the ItemList is gone', () => {
    const listing = parsePlanityListing(planityListingPage({ withItemList: false }), 'https://www.planity.com/barbier/paris-75')
    expect(listing.hasStructuredData).toBe(false)
    expect(listing.items).toEqual([])
  })

  it('resolves a relative rel=next against the fetched URL', () => {
    const page = planityListingPage({ salons: 1, nextPage: '/barbier/paris-75/page-2' })
    const listing = parsePlanityListing(page, 'https://www.planity.com/barbier/paris-75')
    expect(listing.nextPageUrl).toBe('https://www.planity.com/barbier/paris-75/page-2')
  })

  it('refuses a rel=next that points off-site', () => {
    const page = planityListingPage({ salons: 1, nextPage: 'https://evilplanity.com/barbier/paris-75/page-2' })
    const listing = parsePlanityListing(page, 'https://www.planity.com/barbier/paris-75')
    expect(listing.nextPageUrl).toBeNull()
  })

  it('never throws on malformed JSON-LD', () => {
    const broken = '<script type="application/ld+json">{"@type":"ItemList", oops</script>'
    expect(() => parsePlanityListing(broken, 'https://www.planity.com/barbier/paris-75')).not.toThrow()
  })
})
