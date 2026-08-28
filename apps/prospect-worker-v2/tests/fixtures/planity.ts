/**
 * Minimal Planity page fixtures.
 *
 * Deliberately hand-built to the SHAPE of a real establishment page rather
 * than being a saved copy of one. A 1.5 MB verbatim page would put a large
 * amount of someone else's copyrighted content and a named business's public
 * reviews into this repository forever, to test a parser that only ever looks
 * at a JSON-LD block and a data key.
 *
 * The structure below — a schema.org HealthAndBeautyBusiness block, a
 * canonical link, per-service `"bookable"` keys and a `"calendars"` object —
 * was verified against a live page on 2026-08-28. If Planity changes it, these
 * fixtures go stale and the tests keep passing while production degrades to
 * UNKNOWN; that risk is why the parser reports `hasStructuredData` and the job
 * counts `parseFailures` as an observable metric rather than trusting silence.
 */

interface FixtureOptions {
  bookableServices?: number
  unbookableServices?: number
  collaborators?: number
  /** Departed staff, retained by Planity with a deletedAt stamp. Must not be counted. */
  departedCollaborators?: number
  /** A non-practitioner calendar group (rooms, equipment). Must not be counted. */
  resourceCalendars?: number
  withJsonLd?: boolean
  withCanonical?: boolean
  name?: string
  postalCode?: string
  city?: string
  phone?: string
  rating?: number
  reviewCount?: number
  slug?: string
}

export function planityPage(options: FixtureOptions = {}): string {
  const {
    bookableServices = 3,
    unbookableServices = 1,
    collaborators = 2,
    departedCollaborators = 0,
    resourceCalendars = 0,
    withJsonLd = true,
    withCanonical = true,
    name = 'La Loge',
    postalCode = '76380',
    city = 'Montigny',
    phone = '+33982397336',
    rating = 4.98,
    reviewCount = 302,
    slug = 'la-loge-76380-montigny',
  } = options

  const url = `https://www.planity.com/${slug}`

  const jsonLd = withJsonLd
    ? `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'HealthAndBeautyBusiness',
        name,
        description: 'Un salon de coiffure.',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '391, Rue du Lieutenant Aubert',
          addressLocality: city,
          postalCode,
          addressCountry: 'FR',
        },
        telephone: phone,
        url,
        geo: { '@type': 'GeoCoordinates', latitude: 49.4591822, longitude: 1.0003904 },
        aggregateRating: { '@type': 'AggregateRating', ratingValue: rating, reviewCount },
      })}</script>`
    : ''

  const canonical = withCanonical ? `<link href="${url}" rel="canonical"/>` : ''

  const services = [
    ...Array.from({ length: bookableServices }, (_, i) => `{"appHidden":false,"bookable":true,"duration":30,"id":"svc-b${i}"}`),
    ...Array.from({ length: unbookableServices }, (_, i) => `{"appHidden":false,"bookable":false,"duration":30,"id":"svc-n${i}"}`),
  ].join(',')

  const calendarChildren = [
    ...Array.from({ length: collaborators }, (_, i) => `"cal-child-${i}":{"color":"#daff75","name":"Practitioner ${i}"}`),
    // Planity retains departed staff indefinitely with a deletedAt stamp.
    ...Array.from(
      { length: departedCollaborators },
      (_, i) => `"cal-gone-${i}":{"color":"#D53F8C","deletedAt":1688038806936,"name":"Departed ${i}"}`,
    ),
  ].join(',')

  const resourceChildren = Array.from(
    { length: resourceCalendars },
    (_, i) => `"res-${i}":{"name":"Chair ${i}"}`,
  ).join(',')

  const groups = [
    collaborators + departedCollaborators > 0
      ? `"cal-root":{"children":{${calendarChildren}},"system":"people"}`
      : null,
    resourceCalendars > 0 ? `"res-root":{"children":{${resourceChildren}},"system":"resources"}` : null,
  ].filter(Boolean).join(',')

  const calendars = groups ? `"calendars":{${groups}},` : ''

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"/>${canonical}${jsonLd}</head>
<body><div id="root">
<script>window.__STATE__={${calendars}"services":[${services}]}</script>
${unbookableServices > 0 && bookableServices === 0 ? '<div class="service-module_notBookable-fobrZ">Cette prestation ne peut pas être réservée en ligne.</div>' : ''}
</div></body></html>`
}

/** A page whose layout changed beyond recognition: no JSON-LD, no service data. */
export function planityUnrecognisablePage(): string {
  return '<!doctype html><html><head><title>Planity</title></head><body><div id="root"></div></body></html>'
}

/** A Cloudflare-style interstitial served with HTTP 200. */
export function planityChallengePage(): string {
  return `<!doctype html><html><head><title>Just a moment...</title></head>
<body><div class="cf-browser-verification">Checking your browser before accessing planity.com.</div></body></html>`
}

/** Real robots.txt shape, verified live 2026-08-28. */
export const PLANITY_ROBOTS = `User-agent: *
Sitemap: https://www.planity.com/sitemap.xml
Disallow: /*mon-compte*
Disallow: /*@*
Disallow: /a/
Disallow: /b/
Disallow: /t/

User-agent: Googlebot
Disallow: /*serviceSetId*
Disallow: /
`

interface ListingOptions {
  /** Barber-relevant entries (HairSalon). */
  salons?: number
  /** NailSalon entries — Planity returns these on its own barber listing. */
  nailSalons?: number
  nextPage?: string | null
  withItemList?: boolean
  /** Entries missing a url or a name; must be skipped, not crash the parse. */
  malformed?: number
  startIndex?: number
}

/**
 * A Planity category/listing page.
 *
 * Shape verified against https://www.planity.com/barbier/paris-75 on
 * 2026-08-28: a schema.org ItemList of 20 entries, each with name, full
 * PostalAddress, aggregateRating and canonical url, plus <link rel="next">.
 */
export function planityListingPage(options: ListingOptions = {}): string {
  const {
    salons = 3,
    nailSalons = 0,
    nextPage = null,
    withItemList = true,
    malformed = 0,
    startIndex = 0,
  } = options

  const entry = (type: string, i: number) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      '@type': type,
      name: `${type} ${startIndex + i}`,
      url: `https://www.planity.com/salon-${startIndex + i}-7500${(startIndex + i) % 10}-paris`,
      address: {
        '@type': 'PostalAddress',
        streetAddress: `${startIndex + i} Rue de Test`,
        addressLocality: 'Paris',
        postalCode: `7500${(startIndex + i) % 10}`,
        addressCountry: 'FR',
      },
      aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 100 + i },
    },
  })

  const items = [
    ...Array.from({ length: salons }, (_, i) => entry('HairSalon', i)),
    ...Array.from({ length: nailSalons }, (_, i) => entry('NailSalon', salons + i)),
    // No url and no name: unusable as a candidate, must be skipped silently.
    ...Array.from({ length: malformed }, (_, i) => ({
      '@type': 'ListItem',
      position: salons + nailSalons + i + 1,
      item: { '@type': 'HairSalon' },
    })),
  ]

  const jsonLd = withItemList
    ? `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        itemListElement: items,
      })}</script>`
    : ''

  const next = nextPage ? `<link data-react-helmet="true" href="${nextPage}" rel="next"/>` : ''

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"/>${next}${jsonLd}</head><body><div id="root"></div></body></html>`
}

/** A sitemap shard containing city-level /barbier/ listing URLs. */
export function planitySitemap(cities: string[] = ['paris-75']): string {
  const urls = cities
    .map((slug) => `<url><loc>https://www.planity.com/barbier/${slug}</loc></url>`)
    .join('')
  // Service-refined and non-barber entries that must NOT be indexed as cities.
  const noise =
    '<url><loc>https://www.planity.com/barbier/barbe/paris-75</loc></url>' +
    '<url><loc>https://www.planity.com/manucure-et-pedicure/paris-75</loc></url>'
  return `<?xml version="1.0" encoding="UTF-8"?><urlset>${urls}${noise}</urlset>`
}
