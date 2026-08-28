/**
 * Planity public establishment pages — URL handling and parsing.
 *
 * PURE. No network, no database, no clock. Everything here is a function of
 * its arguments, so the whole surface is testable from fixtures and the
 * network module beside it has nothing to reason about except transport.
 *
 * WHAT THIS IS FOR
 *
 * The competitor subsystem already detects Planity from a business's OWN
 * website: a link, a script, an iframe pointing at planity.com. That proves a
 * relationship exists. It cannot say whether the business is actually bookable
 * there, because that fact is not on their website — it is on Planity's.
 *
 * Reading Planity's own public page makes a second, different fact observable.
 * Keeping the two apart is the point of this module.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   * No enumeration. The caller supplies a URL that was already discovered
 *     through a first-party link. Nothing here constructs a Planity URL from a
 *     business name, and guessing slugs would be exactly the brute-forcing the
 *     brief forbids.
 *   * No practitioner identities. Team size is counted and the names are
 *     discarded in the same expression — see countCollaborators.
 *   * No authenticated surface, no private endpoint, no challenge solving.
 */

/**
 * Registrable domains Planity serves establishment pages from.
 *
 * Kept here rather than read from the booking_providers registry on purpose:
 * the registry's `domains` are DETECTION signatures, matched permissively
 * against any URL found on a third-party page. This list decides what we are
 * willing to send a request TO, which is a stricter question and should not
 * widen because somebody edited a signature in /platform.
 */
export const PLANITY_HOSTS = ['planity.com', 'planity.fr'] as const

/**
 * Exact host or subdomain — never a substring or suffix test.
 *
 * `evilplanity.com` ends with "planity.com" under a naive endsWith and is a
 * completely unrelated registrable domain. So does `planity.com.attacker.test`.
 * Both must be refused, and both have tests.
 */
export function isPlanityHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '')
  return PLANITY_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

/** Query parameters that identify a referral rather than a resource. */
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid', 'ref', 'referrer', 'source',
]

/**
 * The canonical, de-duplicated form of a Planity URL, or null when the input
 * is not one.
 *
 * Canonicalisation is what makes the provider observation idempotent: the same
 * establishment reached through `http://planity.com/x?utm_source=fb#top` and
 * `https://www.planity.com/x/` must produce one identical stored URL, or the
 * append-only observation table accumulates a row per spelling.
 */
export function canonicalizePlanityUrl(rawUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }

  // A `javascript:` or `data:` URL can carry a convincing-looking host.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  if (!isPlanityHost(parsed.hostname)) return null

  // Planity's own <link rel="canonical"> uses www, and normalising toward it
  // means a link written either way collapses to one row.
  const bare = parsed.hostname.toLowerCase().replace(/^www\./, '')
  const host = PLANITY_HOSTS.includes(bare as (typeof PLANITY_HOSTS)[number]) ? `www.${bare}` : parsed.hostname.toLowerCase()

  for (const param of TRACKING_PARAMS) parsed.searchParams.delete(param)

  // A fragment is a position on a page, never a different page.
  const search = parsed.searchParams.toString()
  const path = parsed.pathname.replace(/\/+$/, '') || '/'

  return `https://${host}${path}${search ? `?${search}` : ''}`
}

/**
 * True for a URL that addresses one establishment, rather than a category or
 * marketing page.
 *
 * Planity establishment paths are `/{slug}-{postcode}-{city}`; its directory
 * pages are `/coiffeur/{service}/{postcode}-{city}` and locale-prefixed
 * variants. Fetching a directory page and attaching it to a prospect as
 * "their Planity listing" would be a silent mis-attribution, so the shape is
 * checked before the request rather than after.
 */
export function isPlanityEstablishmentUrl(rawUrl: string): boolean {
  const canonical = canonicalizePlanityUrl(rawUrl)
  if (!canonical) return false

  const { pathname } = new URL(canonical)
  const segments = pathname.split('/').filter(Boolean)

  // Exactly one segment, ending in -{postcode}-{city}. A locale prefix
  // (/de-DE/...) or a category path produces two or more segments.
  if (segments.length !== 1) return false
  return /-\d{4,6}-[a-z0-9-]+$/i.test(segments[0]!)
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

export interface RobotsRules {
  /** Disallow patterns that apply to `User-agent: *`. */
  disallow: string[]
}

/**
 * Parses the `User-agent: *` group of a robots.txt.
 *
 * Deliberately reads only the wildcard group. FadeUp's worker is not
 * Googlebot, and adopting a more permissive named group's rules because they
 * happen to be laxer would be precisely the evasion the brief forbids.
 *
 * A robots.txt that cannot be fetched or parsed must be treated by the CALLER
 * as "disallowed", not as "allowed" — see PlanityClient.
 */
export function parseRobots(text: string): RobotsRules {
  const disallow: string[] = []
  let inWildcardGroup = false

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue

    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!match) continue

    const field = match[1]!.toLowerCase()
    const value = match[2]!.trim()

    if (field === 'user-agent') {
      inWildcardGroup = value === '*'
      continue
    }

    if (inWildcardGroup && field === 'disallow' && value) {
      disallow.push(value)
    }
  }

  return { disallow }
}

/**
 * Whether a path is permitted under the parsed rules.
 *
 * Supports the two constructs Planity actually uses: a literal path prefix
 * (`/a/`) and an embedded `*` wildcard (`/*mon-compte*`). `$` end-anchoring is
 * supported because it is cheap and its absence would silently over-allow.
 */
export function isPathAllowed(pathname: string, rules: RobotsRules): boolean {
  for (const pattern of rules.disallow) {
    if (matchesRobotsPattern(pathname, pattern)) return false
  }
  return true
}

function matchesRobotsPattern(pathname: string, pattern: string): boolean {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern

  const escaped = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')

  return new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(pathname)
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type PlanityBookingStatus = 'ACTIVE' | 'LISTED_ONLY' | 'UNKNOWN'

export interface PlanityEstablishment {
  /** The page's own declared canonical URL where available, else the fetched URL. */
  canonicalUrl: string
  name: string | null
  description: string | null
  streetAddress: string | null
  postalCode: string | null
  city: string | null
  countryCode: string | null
  latitude: number | null
  longitude: number | null
  phone: string | null
  rating: number | null
  reviewCount: number | null
  bookingStatus: PlanityBookingStatus
  /** Services the page marks bookable online. Null when no service data was found. */
  bookableServiceCount: number | null
  /** Every service listed, bookable or not. Null when no service data was found. */
  totalServiceCount: number | null
  /** Practitioner COUNT only. Names are never returned or retained. */
  collaboratorCount: number | null
  /** True when the page yielded a structured-data block; false when everything came from weaker signals. */
  hasStructuredData: boolean
}

/** schema.org types Planity uses for an establishment. */
const BUSINESS_TYPES = new Set([
  'healthandbeautybusiness', 'beautysalon', 'hairsalon', 'localbusiness', 'barbershop', 'dayspa',
])

/**
 * Parses a Planity establishment page.
 *
 * LAYERED, IN THIS ORDER, AND THE ORDER IS THE WHOLE DESIGN:
 *
 *   1. JSON-LD (schema.org). Planity publishes a HealthAndBeautyBusiness block
 *      with name, address, telephone, geo and aggregateRating. This is the
 *      contract a site maintains FOR machines; it is stable across redesigns
 *      in a way markup is not.
 *   2. <link rel="canonical"> for the canonical URL.
 *   3. Semantic data tokens for booking status — the per-service
 *      `"bookable": true|false` keys, which are DATA, not presentation.
 *
 * What it deliberately never touches: CSS class names. Planity's are
 * build-hashed (`service-module_notBookable-fobrZ`), so a selector written
 * against one would break on their next deploy and — worse — would break
 * SILENTLY, degrading every prospect to UNKNOWN with no error anywhere.
 *
 * Never throws. A page that changed shape returns nulls and UNKNOWN, which the
 * caller records as "no usable evidence" rather than as a fabricated negative.
 */
export function parsePlanityEstablishment(html: string, fetchedUrl: string): PlanityEstablishment {
  const business = extractBusinessJsonLd(html)
  const address = (business?.['address'] ?? {}) as Record<string, unknown>
  const geo = (business?.['geo'] ?? {}) as Record<string, unknown>
  const rating = (business?.['aggregateRating'] ?? {}) as Record<string, unknown>

  const services = countServices(html)

  return {
    canonicalUrl:
      canonicalizePlanityUrl(str(business?.['url']) ?? '') ??
      canonicalizePlanityUrl(extractCanonicalLink(html) ?? '') ??
      canonicalizePlanityUrl(fetchedUrl) ??
      fetchedUrl,
    name: cleanText(str(business?.['name'])),
    description: cleanText(str(business?.['description'])),
    streetAddress: cleanText(str(address['streetAddress'])),
    postalCode: cleanText(str(address['postalCode'])),
    city: cleanText(str(address['addressLocality'])),
    countryCode: normalizeCountry(str(address['addressCountry'])),
    latitude: num(geo['latitude']),
    longitude: num(geo['longitude']),
    phone: cleanText(str(business?.['telephone'])),
    rating: num(rating['ratingValue']),
    reviewCount: intOrNull(rating['reviewCount']),
    bookingStatus: classifyBookingStatus(services),
    bookableServiceCount: services.bookable,
    totalServiceCount: services.total,
    collaboratorCount: countCollaborators(html),
    hasStructuredData: business !== null,
  }
}

interface ServiceCounts {
  bookable: number | null
  total: number | null
}

/**
 * ACTIVE / LISTED_ONLY / UNKNOWN.
 *
 * The asymmetry is deliberate and matches the competitor subsystem's existing
 * NO_BOOKING-vs-UNKNOWN discipline:
 *
 *   at least one bookable service   -> ACTIVE
 *   services present, none bookable -> LISTED_ONLY   (an observed negative)
 *   no service data at all          -> UNKNOWN       (we did not observe)
 *
 * The existence of a Planity page is NOT sufficient for ACTIVE. A page can
 * outlive a subscription, and a lapsed listing marketed as an active
 * competitor account would send a barber a sales pitch about migrating away
 * from something they already left.
 */
function classifyBookingStatus(services: ServiceCounts): PlanityBookingStatus {
  if (services.total === null || services.total === 0) return 'UNKNOWN'
  if (services.bookable !== null && services.bookable > 0) return 'ACTIVE'
  return 'LISTED_ONLY'
}

/**
 * Counts services by their `bookable` data key.
 *
 * Tolerant of whitespace (`"bookable" : true`) because minifier settings
 * change. Returns nulls rather than zeros when the key is absent entirely —
 * "no services are bookable" and "this page has no service data" are different
 * claims and only the first is a negative observation.
 */
function countServices(html: string): ServiceCounts {
  const bookable = (html.match(/"bookable"\s*:\s*true/g) ?? []).length
  const notBookable = (html.match(/"bookable"\s*:\s*false/g) ?? []).length
  const total = bookable + notBookable

  if (total === 0) return { bookable: null, total: null }
  return { bookable, total }
}

/**
 * CURRENT practitioner count, names discarded.
 *
 * Planity renders a per-practitioner calendar structure. The COUNT is a
 * legitimate public signal of establishment size and feeds
 * `estimated_barber_count`. The NAMES are personal data with no purpose in
 * FadeUp's model, so they are never returned — and, per the domain rule, a
 * practitioner never becomes a standalone marketplace prospect.
 *
 * TWO FILTERS, BOTH LEARNED THE HARD WAY
 *
 * The first live run reported 33 collaborators for a Lyon barbershop. The
 * structure retains DEPARTED staff with a `deletedAt` stamp — in one observed
 * salon, four of six children were former employees going back two years — so
 * counting children naively measures everyone who has ever worked there.
 *
 * That is the specific error acquisition-intelligence.md warns about: "an
 * over-eager headcount would inflate the multi-barber signal that both scores
 * depend on". A three-chair shop with a decade of turnover would read as a
 * chain and score like one.
 *
 * So: skip anything carrying `deletedAt`, skip anything hidden from the web,
 * and only count calendars under a `system: "people"` parent — Planity uses the
 * same structure for rooms and equipment, which are not barbers.
 *
 * Bounded: the scan gives up after a fixed budget rather than brace-matching an
 * arbitrarily large blob.
 */
function countCollaborators(html: string): number | null {
  const object = extractObjectAfterKey(html, '"calendars"', 256 * 1024)
  if (!object) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(object)
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null

  let count = 0

  for (const calendar of Object.values(parsed)) {
    if (!isRecord(calendar)) continue

    // `system` names what the calendar group is FOR. Absent on older records,
    // so its absence is tolerated; a value that is present and is not "people"
    // is a resource calendar and is skipped.
    const system = calendar['system']
    if (typeof system === 'string' && system !== 'people') continue

    const children = calendar['children']
    if (!isRecord(children)) continue

    for (const child of Object.values(children)) {
      if (!isRecord(child)) continue
      if (child['deletedAt'] !== undefined && child['deletedAt'] !== null) continue
      if (child['webHidden'] === true) continue
      count += 1
    }
  }

  // Zero current practitioners on a page that clearly HAS a people calendar is
  // a real observation of an empty roster, but it is far more likely to mean
  // the structure changed under us. Null says "not observed" rather than
  // asserting a salon with no staff.
  return count > 0 ? count : null
}

/**
 * Brace-matched extraction of the object value following a key, with a hard
 * byte budget. String-aware, so a `}` inside a service description does not
 * terminate the scan early.
 */
function extractObjectAfterKey(html: string, key: string, maxBytes: number): string | null {
  const keyIndex = html.indexOf(key)
  if (keyIndex === -1) return null

  const start = html.indexOf('{', keyIndex + key.length)
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  const limit = Math.min(html.length, start + maxBytes)
  for (let i = start; i < limit; i += 1) {
    const char = html[i]!

    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (char === '"') { inString = !inString; continue }
    if (inString) continue

    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return html.slice(start, i + 1)
    }
  }

  // Ran past the budget without closing: treat as unparseable rather than
  // returning a truncated object that JSON.parse would reject anyway.
  return null
}

function extractBusinessJsonLd(html: string): Record<string, unknown> | null {
  const blocks = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)

  for (const block of blocks) {
    let parsed: unknown
    try {
      parsed = JSON.parse(block[1]!)
    } catch {
      continue
    }

    // A page may ship an array, or a @graph, or a bare object.
    const candidates: unknown[] = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed['@graph'])
        ? (parsed['@graph'] as unknown[])
        : [parsed]

    for (const candidate of candidates) {
      if (!isRecord(candidate)) continue
      const type = candidate['@type']
      const types = Array.isArray(type) ? type : [type]
      if (types.some((t) => typeof t === 'string' && BUSINESS_TYPES.has(t.toLowerCase()))) {
        return candidate
      }
    }
  }

  return null
}

function extractCanonicalLink(html: string): string | null {
  const match = /<link[^>]*rel=["']canonical["'][^>]*>/i.exec(html)
  if (!match) return null
  const href = /href=["']([^"']+)["']/i.exec(match[0])
  return href?.[1] ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function intOrNull(value: unknown): number | null {
  const parsed = num(value)
  return parsed === null ? null : Math.trunc(parsed)
}

function cleanText(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed === '' ? null : trimmed
}

/** schema.org addressCountry is sometimes a name ("France"), sometimes a code. */
function normalizeCountry(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase()
  const byName: Record<string, string> = {
    france: 'FR', belgium: 'BE', belgique: 'BE', luxembourg: 'LU',
    germany: 'DE', deutschland: 'DE', spain: 'ES', espagne: 'ES', espana: 'ES',
    switzerland: 'CH', suisse: 'CH',
  }
  return byName[trimmed.toLowerCase()] ?? null
}
