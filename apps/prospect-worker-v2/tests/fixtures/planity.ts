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

  const calendarChildren = Array.from(
    { length: collaborators },
    (_, i) => `"cal-child-${i}":{"color":"#daff75","name":"Practitioner ${i}"}`,
  ).join(',')

  const calendars = collaborators > 0 ? `"calendars":{"cal-root":{"children":{${calendarChildren}}}},` : ''

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
