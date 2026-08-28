import { describe, expect, it } from 'vitest'
import {
  canonicalizePlanityUrl,
  isPathAllowed,
  isPlanityEstablishmentUrl,
  isPlanityHost,
  parsePlanityEstablishment,
  parseRobots,
} from '../src/competitors/planity.js'
import { looksLikeChallenge } from '../src/competitors/planity-client.js'
import { matchPlanityEstablishment, type MatchSubject } from '../src/competitors/planity-match.js'
import { detectCompetitors } from '../src/competitors/detect.js'
import { CompetitorRegistry } from '../src/competitors/registry.js'
import {
  planityPage,
  planityChallengePage,
  planityUnrecognisablePage,
  PLANITY_ROBOTS,
} from './fixtures/planity.js'
import type { CrawledPage } from '../src/crawler/crawl.js'

const FETCHED = 'https://www.planity.com/la-loge-76380-montigny'

describe('Planity host and URL safety', () => {
  it('accepts planity.com and www.planity.com', () => {
    expect(isPlanityHost('planity.com')).toBe(true)
    expect(isPlanityHost('www.planity.com')).toBe(true)
    expect(isPlanityHost('planity.fr')).toBe(true)
  })

  it('accepts a real subdomain', () => {
    expect(isPlanityHost('pro.planity.com')).toBe(true)
  })

  // The bug class this whole module is shaped around. A naive endsWith or a
  // substring test accepts every one of these, and each is a completely
  // unrelated registrable domain that an attacker can register today.
  it.each([
    'evilplanity.com',
    'planity.com.attacker.test',
    'notplanity.fr',
    'planity.com.evil.co',
    'myplanity.com',
  ])('rejects the lookalike %s', (host) => {
    expect(isPlanityHost(host)).toBe(false)
  })

  it('canonicalizes scheme, www, trailing slash, tracking params and fragment to one form', () => {
    const expected = 'https://www.planity.com/la-loge-76380-montigny'
    for (const variant of [
      'https://www.planity.com/la-loge-76380-montigny',
      'https://www.planity.com/la-loge-76380-montigny/',
      'http://planity.com/la-loge-76380-montigny',
      'https://planity.com/la-loge-76380-montigny?utm_source=fb&utm_campaign=x',
      'https://www.planity.com/la-loge-76380-montigny#horaires',
      'https://www.planity.com/la-loge-76380-montigny/?fbclid=abc',
    ]) {
      expect(canonicalizePlanityUrl(variant)).toBe(expected)
    }
  })

  it('preserves a meaningful query parameter', () => {
    expect(canonicalizePlanityUrl('https://www.planity.com/x-75011-paris?lang=en')).toBe(
      'https://www.planity.com/x-75011-paris?lang=en',
    )
  })

  it.each([
    'javascript:alert(1)//planity.com',
    'data:text/html,<h1>planity.com</h1>',
    'https://evilplanity.com/la-loge-76380-montigny',
    'not a url',
  ])('refuses to canonicalize %s', (raw) => {
    expect(canonicalizePlanityUrl(raw)).toBeNull()
  })

  it('distinguishes an establishment page from a directory page', () => {
    expect(isPlanityEstablishmentUrl('https://www.planity.com/la-loge-76380-montigny')).toBe(true)
    expect(isPlanityEstablishmentUrl('https://www.planity.com/coiffeur/coupe-homme/76380-montigny')).toBe(false)
    expect(isPlanityEstablishmentUrl('https://www.planity.com/de-DE/friseur')).toBe(false)
    expect(isPlanityEstablishmentUrl('https://www.planity.com')).toBe(false)
    expect(isPlanityEstablishmentUrl('https://www.planity.com/coiffeur')).toBe(false)
  })
})

describe('robots.txt', () => {
  it('reads only the wildcard group, never a laxer named one', () => {
    const rules = parseRobots(PLANITY_ROBOTS)

    // Googlebot's group in the fixture contains `Disallow: /`, which would ban
    // everything if groups were merged. Adopting another agent's rules —
    // stricter or laxer — is not what this worker is entitled to do.
    expect(isPathAllowed('/la-loge-76380-montigny', rules)).toBe(true)
    expect(rules.disallow).not.toContain('/')
  })

  it('honours literal prefix disallows', () => {
    const rules = parseRobots(PLANITY_ROBOTS)
    expect(isPathAllowed('/a/something', rules)).toBe(false)
    expect(isPathAllowed('/t/x', rules)).toBe(false)
  })

  it('honours embedded wildcard disallows', () => {
    const rules = parseRobots(PLANITY_ROBOTS)
    expect(isPathAllowed('/fr/mon-compte/profil', rules)).toBe(false)
    expect(isPathAllowed('/salon/@handle', rules)).toBe(false)
  })

  it('ignores comments and blank lines', () => {
    const rules = parseRobots('# a comment\n\nUser-agent: *\nDisallow: /private # trailing\n')
    expect(isPathAllowed('/private/x', rules)).toBe(false)
    expect(isPathAllowed('/public', rules)).toBe(true)
  })
})

describe('Planity page parsing', () => {
  it('extracts identity, contact, geo and reputation from JSON-LD', () => {
    const page = parsePlanityEstablishment(planityPage(), FETCHED)

    expect(page).toMatchObject({
      canonicalUrl: FETCHED,
      name: 'La Loge',
      streetAddress: '391, Rue du Lieutenant Aubert',
      postalCode: '76380',
      city: 'Montigny',
      countryCode: 'FR',
      phone: '+33982397336',
      rating: 4.98,
      reviewCount: 302,
      hasStructuredData: true,
    })
    expect(page.latitude).toBeCloseTo(49.4591822, 5)
    expect(page.longitude).toBeCloseTo(1.0003904, 5)
  })

  it('counts collaborators without returning any name', () => {
    const page = parsePlanityEstablishment(planityPage({ collaborators: 4 }), FETCHED)

    expect(page.collaboratorCount).toBe(4)
    // The domain rule made structural: a practitioner is not a marketplace
    // prospect, and their name has no field to be stored in.
    expect(JSON.stringify(page)).not.toContain('Practitioner')
    expect(Object.keys(page)).not.toContain('collaborators')
  })

  it('returns nulls rather than throwing when optional fields are absent', () => {
    const page = parsePlanityEstablishment(planityPage({ withJsonLd: false }), FETCHED)

    expect(page.name).toBeNull()
    expect(page.rating).toBeNull()
    expect(page.postalCode).toBeNull()
    expect(page.hasStructuredData).toBe(false)
    // Service data is independent of JSON-LD, so booking status survives.
    expect(page.bookingStatus).toBe('ACTIVE')
  })

  it('degrades gracefully on a completely changed page', () => {
    const page = parsePlanityEstablishment(planityUnrecognisablePage(), FETCHED)

    expect(page.hasStructuredData).toBe(false)
    expect(page.bookingStatus).toBe('UNKNOWN')
    expect(page.totalServiceCount).toBeNull()
    // Falls back to the fetched URL rather than inventing one.
    expect(page.canonicalUrl).toBe(FETCHED)
  })

  it('survives malformed JSON-LD without throwing', () => {
    const broken = '<script type="application/ld+json">{"@type": "HealthAndBeautyBusiness", oops</script>'
    expect(() => parsePlanityEstablishment(broken, FETCHED)).not.toThrow()
    expect(parsePlanityEstablishment(broken, FETCHED).hasStructuredData).toBe(false)
  })

  it('finds the business inside an @graph wrapper', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'WebSite', name: 'Planity' }, { '@type': 'HairSalon', name: 'Graph Salon' }],
    })}</script>`
    expect(parsePlanityEstablishment(html, FETCHED).name).toBe('Graph Salon')
  })

  it('prefers the page’s own canonical URL over the fetched one', () => {
    const page = parsePlanityEstablishment(planityPage({ slug: 'real-slug-75011-paris' }), 'https://planity.com/stale-75011-paris')
    expect(page.canonicalUrl).toBe('https://www.planity.com/real-slug-75011-paris')
  })
})

describe('booking status — ACTIVE / LISTED_ONLY / UNKNOWN', () => {
  it('is ACTIVE when at least one service is bookable', () => {
    const page = parsePlanityEstablishment(planityPage({ bookableServices: 2, unbookableServices: 5 }), FETCHED)
    expect(page.bookingStatus).toBe('ACTIVE')
    expect(page.bookableServiceCount).toBe(2)
    expect(page.totalServiceCount).toBe(7)
  })

  it('is LISTED_ONLY when services exist and none is bookable', () => {
    const page = parsePlanityEstablishment(planityPage({ bookableServices: 0, unbookableServices: 4 }), FETCHED)
    expect(page.bookingStatus).toBe('LISTED_ONLY')
    expect(page.bookableServiceCount).toBe(0)
  })

  it('is UNKNOWN when the page carries no service data at all', () => {
    const page = parsePlanityEstablishment(planityPage({ bookableServices: 0, unbookableServices: 0 }), FETCHED)
    expect(page.bookingStatus).toBe('UNKNOWN')
    expect(page.totalServiceCount).toBeNull()
  })

  it('is never ACTIVE merely because a Planity page exists', () => {
    // The central rule of this classification. A page can outlive a
    // subscription, and selling "migrate off Planity" to someone who already
    // left is worse than saying nothing.
    const page = parsePlanityEstablishment(planityPage({ bookableServices: 0, unbookableServices: 0, withJsonLd: true }), FETCHED)
    expect(page.hasStructuredData).toBe(true)
    expect(page.bookingStatus).not.toBe('ACTIVE')
  })

  it('tolerates whitespace in the bookable data key', () => {
    const html = '<html><body><script>x={"bookable" : true , "b":{"bookable":false}}</script></body></html>'
    const page = parsePlanityEstablishment(html, FETCHED)
    expect(page.bookingStatus).toBe('ACTIVE')
    expect(page.totalServiceCount).toBe(2)
  })
})

describe('challenge detection', () => {
  it('recognises an interstitial served with 200', () => {
    expect(looksLikeChallenge(planityChallengePage())).toBe(true)
  })

  it('does not mistake salon copy for a challenge', () => {
    // A description containing "just a moment" must not disable the source.
    const page = planityPage().replace('Un salon de coiffure.', 'Prenez just a moment pour vous détendre')
    expect(looksLikeChallenge(page)).toBe(false)
  })
})

describe('identity matching', () => {
  const subject: MatchSubject = {
    canonicalName: 'La Loge',
    country: 'FR',
    postalCode: '76380',
    city: 'Montigny',
    phoneE164: '+33982397336',
  }
  const page = parsePlanityEstablishment(planityPage(), FETCHED)

  it('matches on an identical phone number', () => {
    const verdict = matchPlanityEstablishment({ ...subject, postalCode: null, city: null }, page)
    expect(verdict.matched).toBe(true)
    expect(verdict.reasons).toContain('phone_e164')
  })

  it('matches on postcode plus name when there is no phone', () => {
    const verdict = matchPlanityEstablishment({ ...subject, phoneE164: null }, page)
    expect(verdict.matched).toBe(true)
    expect(verdict.reasons).toEqual(expect.arrayContaining(['postal_code', 'business_name']))
  })

  it('rejects a name-only agreement as ambiguous', () => {
    const verdict = matchPlanityEstablishment(
      { canonicalName: 'La Loge', country: 'FR', postalCode: null, city: null, phoneE164: null },
      page,
    )
    expect(verdict.matched).toBe(false)
    expect(verdict.rejection).toBe('ambiguous')
  })

  it('rejects a conflicting phone number outright, however much else agrees', () => {
    // Two salons in one chain share a name and a town. They do not share a
    // phone number, so a conflict outranks any amount of agreement.
    const verdict = matchPlanityEstablishment({ ...subject, phoneE164: '+33100000000' }, page)
    expect(verdict.matched).toBe(false)
    expect(verdict.rejection).toBe('phone_conflict')
  })

  it('rejects a conflicting postcode when no phone corroborates', () => {
    const verdict = matchPlanityEstablishment({ ...subject, phoneE164: null, postalCode: '75011' }, page)
    expect(verdict.matched).toBe(false)
    expect(verdict.rejection).toBe('postal_code_conflict')
  })

  it('rejects a page that corroborates nothing', () => {
    const verdict = matchPlanityEstablishment(
      { canonicalName: 'Completely Different', country: 'FR', postalCode: null, city: null, phoneE164: null },
      page,
    )
    expect(verdict.matched).toBe(false)
    expect(verdict.rejection).toBe('no_corroborating_signal')
  })

  it('tolerates a listing suffix on the provider side', () => {
    const suffixed = parsePlanityEstablishment(planityPage({ name: 'La Loge Coiffure' }), FETCHED)
    const verdict = matchPlanityEstablishment({ ...subject, phoneE164: null }, suffixed)
    expect(verdict.matched).toBe(true)
  })

  it('does not let a two-letter name match everything', () => {
    const shortName = parsePlanityEstablishment(planityPage({ name: 'Le' }), FETCHED)
    const verdict = matchPlanityEstablishment(
      { canonicalName: 'Le', country: 'FR', postalCode: null, city: 'Montigny', phoneE164: null },
      shortName,
    )
    expect(verdict.matched).toBe(false)
  })
})

describe('website → Planity link detection (PATH 1)', () => {
  const registry = CompetitorRegistry.fromDefaults()

  function page(overrides: Partial<CrawledPage>): CrawledPage {
    return {
      url: 'https://laloge.example/',
      title: null, lang: null, cms: null,
      outboundLinks: [], bookingLinks: [], bookingButtonTargets: [],
      scriptSrcs: [], iframeSrcs: [], formActions: [], structuredDataUrls: [],
      emails: [], phones: [], instagramHandles: [], facebookUrls: [], tiktokHandles: [],
      analytics: [], hasMobileViewport: false, hasContactForm: false,
      hasStructuredData: false, hasEcommerceSignal: false, hasGiftCardSignal: false,
      teamMemberCount: null, priceCount: 0,
      ...overrides,
    } as CrawledPage
  }

  it('detects Planity from a booking link on the business’s own site', () => {
    const detections = detectCompetitors(
      [page({ bookingLinks: ['https://www.planity.com/la-loge-76380-montigny'] })],
      registry,
    )
    expect(detections[0]).toMatchObject({ providerKey: 'PLANITY', detectionMethod: 'booking_url' })
    expect(detections[0]!.confidence).toBeGreaterThan(0.9)
  })

  it('keeps the establishment URL, not the homepage link, when both are present', () => {
    // Equal confidence, same method: first-wins would keep whichever the
    // crawler saw first, and the homepage link identifies no listing.
    const detections = detectCompetitors(
      [page({ outboundLinks: ['https://www.planity.com', 'https://www.planity.com/la-loge-76380-montigny'] })],
      registry,
    )
    const planity = detections.find((d) => d.providerKey === 'PLANITY')
    expect(planity?.evidence).toBe('https://www.planity.com/la-loge-76380-montigny')
  })

  it('does not brand a business from a lookalike domain', () => {
    const detections = detectCompetitors(
      [page({ outboundLinks: ['https://evilplanity.com/x', 'https://planity.com.attacker.test/y'] })],
      registry,
    )
    expect(detections.find((d) => d.providerKey === 'PLANITY')).toBeUndefined()
  })
})

describe('collaborator counting — the over-eager headcount trap', () => {
  // The first live run reported 33 collaborators for a Lyon barbershop.
  // Planity retains DEPARTED staff indefinitely with a deletedAt stamp, so a
  // naive child count measures everyone who has ever worked there. That is the
  // exact error acquisition-intelligence.md warns about: an inflated headcount
  // feeds the multi-barber signal that BOTH scores depend on, and a three-chair
  // shop with a decade of turnover would score like a chain.
  it('counts current practitioners only, never departed ones', () => {
    const page = parsePlanityEstablishment(
      planityPage({ collaborators: 2, departedCollaborators: 4 }),
      FETCHED,
    )
    expect(page.collaboratorCount).toBe(2)
  })

  it('ignores resource calendars — a chair is not a barber', () => {
    const page = parsePlanityEstablishment(
      planityPage({ collaborators: 3, resourceCalendars: 5 }),
      FETCHED,
    )
    expect(page.collaboratorCount).toBe(3)
  })

  it('returns null rather than 0 when every practitioner has departed', () => {
    // An empty roster is far more likely to mean the structure changed than
    // that a trading salon has no staff. Null says "not observed".
    const page = parsePlanityEstablishment(
      planityPage({ collaborators: 0, departedCollaborators: 3 }),
      FETCHED,
    )
    expect(page.collaboratorCount).toBeNull()
  })

  it('still discards names while filtering', () => {
    const page = parsePlanityEstablishment(
      planityPage({ collaborators: 2, departedCollaborators: 2 }),
      FETCHED,
    )
    expect(JSON.stringify(page)).not.toContain('Departed')
    expect(JSON.stringify(page)).not.toContain('Practitioner')
  })
})
