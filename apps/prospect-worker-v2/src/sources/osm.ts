import type { Config } from '../config.js'
import { fetchText } from '../http.js'
import type { DiscoveryQuery, RawCandidate, SourceAdapter, SourceAdapterContext } from './types.js'

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

interface OverpassResponse {
  elements: OverpassElement[]
}

/**
 * OpenStreetMap / Overpass — no API key required, first source in the
 * waterfall (see spec's source-waterfall section). Barbershops/hairdressers
 * are tagged `shop=hairdresser` in OSM (there is no separate "barber" shop
 * value in wide use); we also keep nodes tagged `shop=beauty` with a name
 * containing "barber" as a lower-confidence fallback for independent
 * barbers who list themselves loosely.
 *
 * Requires latitude/longitude + radiusKm — Overpass's `around` filter is a
 * point-radius search, not a free-text city search (that's Geoapify's
 * job in the waterfall). A query with only a city name and no coordinates
 * yields zero OSM candidates rather than guessing a geocode.
 */
export class OsmAdapter implements SourceAdapter {
  readonly key = 'osm'
  readonly displayName = 'OpenStreetMap / Overpass'

  constructor(private readonly config: Config) {}

  isConfigured(): boolean {
    return true
  }

  async discover(query: DiscoveryQuery, ctx: SourceAdapterContext): Promise<RawCandidate[]> {
    if (query.latitude === undefined || query.longitude === undefined) {
      ctx.logger.debug('osm: skipped — no latitude/longitude in query')
      return []
    }

    const radiusMeters = Math.min((query.radiusKm ?? 5) * 1000, 50_000)
    const ql = buildOverpassQuery(query.latitude, query.longitude, radiusMeters)

    const body = await fetchText(this.config.OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: ql,
      timeoutMs: 25_000,
    })

    const parsed = JSON.parse(body) as OverpassResponse
    const candidates = parsed.elements
      .map((el) => elementToCandidate(el))
      .filter((c): c is RawCandidate => c !== null)

    return query.maxCandidates ? candidates.slice(0, query.maxCandidates) : candidates
  }
}

function buildOverpassQuery(lat: number, lon: number, radiusMeters: number): string {
  return `
[out:json][timeout:20];
(
  node["shop"="hairdresser"](around:${radiusMeters},${lat},${lon});
  way["shop"="hairdresser"](around:${radiusMeters},${lat},${lon});
  node["shop"="beauty"]["name"~"barber",i](around:${radiusMeters},${lat},${lon});
);
out center tags;
`.trim()
}

function elementToCandidate(el: OverpassElement): RawCandidate | null {
  const tags = el.tags ?? {}
  const name = tags['name']
  if (!name) return null

  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon

  const addressParts = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean)

  return {
    externalId: `${el.type}/${el.id}`,
    externalType: `osm_${el.type}`,
    name,
    category: tags['shop'],
    addressLine: addressParts.length > 0 ? addressParts.join(' ') : undefined,
    city: tags['addr:city'],
    postalCode: tags['addr:postcode'],
    country: tags['addr:country'],
    latitude: lat,
    longitude: lon,
    phone: tags['phone'] ?? tags['contact:phone'],
    email: tags['email'] ?? tags['contact:email'],
    websiteUrl: tags['website'] ?? tags['contact:website'],
    instagramHandle: tags['contact:instagram'],
    facebookUrl: tags['contact:facebook'],
    // shop=hairdresser is a direct category match; the beauty+name-match
    // fallback is inherently less certain, so it gets a lower confidence.
    confidence: tags['shop'] === 'hairdresser' ? 0.75 : 0.4,
    rawPayload: { type: el.type, id: el.id, tags },
  }
}
