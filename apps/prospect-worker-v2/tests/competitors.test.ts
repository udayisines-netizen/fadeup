import { describe, expect, it } from 'vitest'
import { CompetitorRegistry, DEFAULT_PROVIDER_SIGNATURES } from '../src/competitors/registry.js'
import { detectCompetitors, noBookingDetection, strongestDetection } from '../src/competitors/detect.js'
import type { CrawledPage } from '../src/crawler/crawl.js'

const registry = CompetitorRegistry.fromDefaults()

/** A CrawledPage with everything empty, so each test declares only the signal it cares about. */
function page(overrides: Partial<CrawledPage>): CrawledPage {
  return {
    url: 'https://barbier-exemple.fr/',
    statusCode: 200,
    contentType: 'text/html',
    byteSize: 1000,
    responseTimeMs: 200,
    depth: 0,
    title: null,
    metaDescription: null,
    lang: null,
    internalLinks: [],
    outboundLinks: [],
    scriptSrcs: [],
    iframeSrcs: [],
    formActions: [],
    bookingLinks: [],
    bookingButtonTargets: [],
    structuredDataUrls: [],
    emails: [],
    phones: [],
    instagramHandles: [],
    facebookUrls: [],
    tiktokHandles: [],
    hasContactForm: false,
    hasMobileViewport: false,
    hasStructuredData: false,
    hasEcommerceSignal: false,
    hasGiftCardSignal: false,
    cms: null,
    analytics: [],
    teamMemberCount: null,
    priceCount: 0,
    ...overrides,
  }
}

describe('CompetitorRegistry', () => {
  it('includes every provider the spec names as mandatory', () => {
    const keys = DEFAULT_PROVIDER_SIGNATURES.map((s) => s.key)
    for (const required of [
      'PLANITY',
      'BOOKSY',
      'FRESHA',
      'TREATWELL',
      'KIUTE',
      'RESERVIO',
      'SUMUP_BOOKINGS',
      'SQUIRE',
      'PHOREST',
      'SALONIZED',
      'TIMIFY',
      'TIMELY',
      'CUSTOM_BOOKING',
      'OTHER',
      'NO_BOOKING',
      'UNKNOWN',
    ]) {
      expect(keys).toContain(required)
    }
  })

  it('matches an exact provider host', () => {
    expect(registry.matchHost('https://www.planity.com/salon/x')?.signature.key).toBe('PLANITY')
    expect(registry.matchHost('https://booksy.com/b/12345')?.signature.key).toBe('BOOKSY')
    expect(registry.matchHost('https://www.fresha.com/a/salon-x')?.signature.key).toBe('FRESHA')
    expect(registry.matchHost('https://widget.treatwell.fr/place/abc')?.signature.key).toBe('TREATWELL')
  })

  it('matches subdomains of a provider', () => {
    expect(registry.matchHost('https://app.planity.com/booking')?.signature.key).toBe('PLANITY')
  })

  it('does NOT match a lookalike domain that merely ends with the provider name', () => {
    // booksy.com.evil.test must not be treated as Booksy — a naive
    // endsWith() check would accept it.
    expect(registry.matchHost('https://booksy.com.evil.test/x')).toBeNull()
    expect(registry.matchHost('https://notplanity.com/x')).toBeNull()
    expect(registry.matchHost('https://myplanity.com/x')).toBeNull()
  })

  it('reports whether the matched URL also hit a booking path pattern', () => {
    expect(registry.matchHost('https://www.planity.com/booking/x')?.pathMatched).toBe(true)
    expect(registry.matchHost('https://www.planity.com/about')?.pathMatched).toBe(false)
  })

  it('treats an unassessed provider as NOT discoverable', () => {
    // supports_compliant_discovery = null means "not assessed", which is
    // not permission to use it as a discovery source (spec §12).
    expect(registry.discoverable()).toHaveLength(0)
  })

  it('excludes sentinels from the detectable set', () => {
    const detectableKeys = registry.detectable().map((s) => s.key)
    expect(detectableKeys).not.toContain('NO_BOOKING')
    expect(detectableKeys).not.toContain('UNKNOWN')
  })
})

describe('detectCompetitors', () => {
  it('detects Planity from a script domain', () => {
    const detections = detectCompetitors([page({ scriptSrcs: ['https://d3jl2t8w1p2s0k.planity.com/widget.js'] })], registry)
    expect(detections[0]?.providerKey).toBe('PLANITY')
    expect(detections[0]?.detectionMethod).toBe('script_domain')
    expect(detections[0]?.confidence).toBeGreaterThan(0.85)
  })

  it('detects Booksy from a booking link and rates it highly', () => {
    const detections = detectCompetitors([page({ bookingLinks: ['https://booksy.com/b/98765'] })], registry)
    expect(detections[0]?.providerKey).toBe('BOOKSY')
    expect(detections[0]?.detectionMethod).toBe('booking_url')
    expect(detections[0]?.confidence).toBeGreaterThan(0.95)
  })

  it('detects Fresha from an iframe', () => {
    const detections = detectCompetitors([page({ iframeSrcs: ['https://www.fresha.com/a/le-barbier'] })], registry)
    expect(detections[0]?.providerKey).toBe('FRESHA')
    expect(detections[0]?.detectionMethod).toBe('iframe_domain')
  })

  it('detects Treatwell from JSON-LD structured data', () => {
    const detections = detectCompetitors(
      [page({ structuredDataUrls: ['https://www.treatwell.fr/place/le-barbier-de-paris/'] })],
      registry,
    )
    expect(detections[0]?.providerKey).toBe('TREATWELL')
    expect(detections[0]?.detectionMethod).toBe('structured_data')
  })

  it('rates a booking BUTTON target above a plain footer link', () => {
    const button = detectCompetitors([page({ bookingButtonTargets: ['https://www.planity.com/x'] })], registry)
    const footer = detectCompetitors([page({ outboundLinks: ['https://www.planity.com/x'] })], registry)
    expect(button[0]!.confidence).toBeGreaterThan(footer[0]!.confidence)
  })

  it('returns nothing when the page mentions no provider', () => {
    const detections = detectCompetitors([page({ outboundLinks: ['https://www.instagram.com/lebarbier'] })], registry)
    expect(detections).toHaveLength(0)
  })

  it('detects CUSTOM_BOOKING when booking lives on the business’s own domain', () => {
    const detections = detectCompetitors(
      [page({ url: 'https://barbier-exemple.fr/', bookingLinks: ['https://barbier-exemple.fr/prendre-rdv'] })],
      registry,
    )
    expect(detections[0]?.providerKey).toBe('CUSTOM_BOOKING')
  })

  it('prefers a third-party provider over the own-domain fallback', () => {
    const detections = detectCompetitors(
      [
        page({
          url: 'https://barbier-exemple.fr/',
          bookingLinks: ['https://barbier-exemple.fr/rendez-vous', 'https://www.planity.com/le-barbier'],
        }),
      ],
      registry,
    )
    expect(strongestDetection(detections)?.providerKey).toBe('PLANITY')
  })

  it('surfaces the strongest detection first when several providers appear', () => {
    const detections = detectCompetitors(
      [
        page({
          outboundLinks: ['https://www.treatwell.fr/place/x'],
          bookingLinks: ['https://booksy.com/b/1'],
        }),
      ],
      registry,
    )
    // A booking URL beats a footer outbound link.
    expect(strongestDetection(detections)?.providerKey).toBe('BOOKSY')
    expect(detections.map((d) => d.providerKey)).toContain('TREATWELL')
  })

  it('carries evidence and evidence URL on every detection', () => {
    const detections = detectCompetitors(
      [page({ url: 'https://barbier.fr/contact', scriptSrcs: ['https://cdn.booksy.com/w.js'] })],
      registry,
    )
    expect(detections[0]?.evidence).toContain('booksy.com')
    expect(detections[0]?.evidenceUrl).toBe('https://barbier.fr/contact')
  })
})

describe('noBookingDetection', () => {
  it('is an evidence-backed negative, not a certainty', () => {
    const detection = noBookingDetection('https://barbier.fr/', 3)
    expect(detection.providerKey).toBe('NO_BOOKING')
    expect(detection.evidence).toContain('3 page')
    // Absence of evidence over a small crawl is a weaker claim than a
    // positive match, and the confidence must say so.
    expect(detection.confidence).toBeLessThan(0.9)
  })
})
