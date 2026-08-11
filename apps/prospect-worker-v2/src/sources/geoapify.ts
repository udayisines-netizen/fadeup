import type { Config } from '../config.js'
import { fetchJson } from '../http.js'
import type { DiscoveryQuery, RawCandidate, SourceAdapter, SourceAdapterContext } from './types.js'

interface GeoapifyFeature {
  properties: {
    place_id: string
    name?: string
    categories?: string[]
    address_line1?: string
    address_line2?: string
    city?: string
    postcode?: string
    state?: string
    country_code?: string
    lon?: number
    lat?: number
    website?: string
    contact?: { phone?: string; email?: string }
    datasource?: { raw?: Record<string, unknown> }
  }
}

interface GeoapifyResponse {
  features: GeoapifyFeature[]
}

/**
 * Geoapify Places — second in the waterfall (after free OSM, before
 * consuming Google quota). Requires GEOAPIFY_API_KEY; isConfigured()
 * returns false without one, and the job runner records that source as
 * skipped rather than failing the job (see spec: "a failed source must
 * not destroy the entire discovery job").
 *
 * Category: commercial.hairdresser is Geoapify's Places category for
 * barbershops/hair salons.
 */
export class GeoapifyAdapter implements SourceAdapter {
  readonly key = 'geoapify'
  readonly displayName = 'Geoapify Places'

  constructor(private readonly config: Config) {}

  isConfigured(): boolean {
    return Boolean(this.config.GEOAPIFY_API_KEY)
  }

  async discover(query: DiscoveryQuery, ctx: SourceAdapterContext): Promise<RawCandidate[]> {
    if (!this.isConfigured()) {
      throw new Error('geoapify: GEOAPIFY_API_KEY not configured')
    }
    if (query.latitude === undefined || query.longitude === undefined) {
      ctx.logger.debug('geoapify: skipped — no latitude/longitude in query')
      return []
    }

    const radiusMeters = Math.min((query.radiusKm ?? 5) * 1000, 50_000)
    const limit = Math.min(query.maxCandidates ?? 50, 100)

    const url = new URL('https://api.geoapify.com/v2/places')
    url.searchParams.set('categories', 'commercial.hairdresser')
    url.searchParams.set('filter', `circle:${query.longitude},${query.latitude},${radiusMeters}`)
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('apiKey', this.config.GEOAPIFY_API_KEY as string)

    const response = await fetchJson<GeoapifyResponse>(url.toString(), { timeoutMs: 15_000 })

    return response.features
      .filter((f) => Boolean(f.properties.name))
      .map((f) => featureToCandidate(f))
  }
}

function featureToCandidate(feature: GeoapifyFeature): RawCandidate {
  const p = feature.properties
  return {
    externalId: p.place_id,
    externalType: 'geoapify_place_id',
    name: p.name,
    category: p.categories?.[0],
    addressLine: [p.address_line1, p.address_line2].filter(Boolean).join(', ') || undefined,
    city: p.city,
    postalCode: p.postcode,
    region: p.state,
    country: p.country_code?.toUpperCase(),
    latitude: p.lat,
    longitude: p.lon,
    phone: p.contact?.phone,
    email: p.contact?.email,
    websiteUrl: p.website,
    confidence: 0.7,
    rawPayload: { place_id: p.place_id, categories: p.categories, datasource: p.datasource },
  }
}
