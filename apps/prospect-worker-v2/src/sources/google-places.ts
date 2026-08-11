import type { Config } from '../config.js'
import { fetchJson } from '../http.js'
import type { DiscoveryQuery, RawCandidate, SourceAdapter, SourceAdapterContext } from './types.js'

interface GooglePlace {
  id: string
  displayName?: { text: string }
  formattedAddress?: string
  location?: { latitude: number; longitude: number }
  internationalPhoneNumber?: string
  websiteUri?: string
  primaryType?: string
}

interface GoogleSearchTextResponse {
  places?: GooglePlace[]
}

// Deliberately minimal FieldMask — only what's needed to canonicalize and
// contact a candidate. Never requests reviews/photos (Google policy — see
// spec's "Google Places only through the official API" section and
// docs/worker-v2/api-quotas.md).
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.primaryType',
].join(',')

/**
 * Google Places API (New) — deliberately positioned LAST in the source
 * waterfall (see spec's source-waterfall section): only called for
 * candidates that already cleared OSM/Geoapify/Sirene + initial scoring,
 * to avoid consuming Google's metered quota on low-value candidates. The
 * job runner (src/jobs/discovery.ts), not this adapter, decides when to
 * call it and narrows the query to a specific candidate name + small
 * radius rather than a broad area sweep.
 *
 * Persists only place_id + the fields above — no bulk-scraped "permanent
 * copy" of Google's database, per spec.
 */
export class GooglePlacesAdapter implements SourceAdapter {
  readonly key = 'google_places'
  readonly displayName = 'Google Places API (New)'

  constructor(private readonly config: Config) {}

  isConfigured(): boolean {
    return Boolean(this.config.GOOGLE_PLACES_API_KEY)
  }

  async discover(query: DiscoveryQuery, ctx: SourceAdapterContext): Promise<RawCandidate[]> {
    if (!this.isConfigured()) {
      throw new Error('google_places: GOOGLE_PLACES_API_KEY not configured')
    }

    const textQuery = buildTextQuery(query)
    if (!textQuery) {
      ctx.logger.debug('google_places: skipped — not enough query context to build a text search')
      return []
    }

    const body: Record<string, unknown> = {
      textQuery,
      maxResultCount: Math.min(query.maxCandidates ?? 10, 20),
      includedType: 'barber_shop',
    }
    if (query.latitude !== undefined && query.longitude !== undefined) {
      body['locationBias'] = {
        circle: {
          center: { latitude: query.latitude, longitude: query.longitude },
          radius: Math.min((query.radiusKm ?? 5) * 1000, 50_000),
        },
      }
    }

    const response = await fetchJson<GoogleSearchTextResponse>('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': this.config.GOOGLE_PLACES_API_KEY as string,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
      timeoutMs: 15_000,
    })

    return (response.places ?? []).map((p) => placeToCandidate(p))
  }
}

function buildTextQuery(query: DiscoveryQuery): string | undefined {
  const keyword = query.keywords?.[0] ?? 'barbershop'
  if (query.city) return `${keyword} in ${query.city}, ${query.country}`
  if (query.latitude !== undefined && query.longitude !== undefined) return keyword
  return undefined
}

function placeToCandidate(place: GooglePlace): RawCandidate {
  return {
    externalId: place.id,
    externalType: 'google_place_id',
    name: place.displayName?.text,
    category: place.primaryType,
    addressLine: place.formattedAddress,
    latitude: place.location?.latitude,
    longitude: place.location?.longitude,
    phone: place.internationalPhoneNumber,
    websiteUrl: place.websiteUri,
    // Google's own place match for a query built from an already-vetted
    // candidate name is high-confidence.
    confidence: 0.8,
    rawPayload: { place_id: place.id, primaryType: place.primaryType },
  }
}
