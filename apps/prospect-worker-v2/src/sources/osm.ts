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
  /**
   * Overpass reports SERVER-SIDE failures in this field, with HTTP 200 and an
   * empty `elements` array. See OverpassRuntimeError below for why that
   * matters more than it looks.
   */
  remark?: string
}

/**
 * Overpass said the query failed. HTTP 200, `elements: []`, and a `remark`.
 *
 * THIS IS THE MOST IMPORTANT TWELVE LINES IN THIS FILE.
 *
 * A public Overpass instance under load does not return 429 or 503. It returns
 * `200 OK` with `{"elements": [], "remark": "runtime error: Query timed out in
 * \"query\" at line 5 after 27 seconds."}`. Parsed naively that is an empty
 * result, and the discovery job faithfully records `candidates_found = 0,
 * status = completed, error = null` — which an operator reads as "we swept
 * Lyon and there are no barbershops there".
 *
 * That is exactly the failure acquisition-intelligence.md's first rule exists
 * to forbid: "A website crawl that timed out tells us NOTHING... Recording that
 * as FALSE would manufacture a signal out of an infrastructure failure." The
 * rule was written about feature tribools; it applies with equal force one
 * stage earlier, because a fabricated zero here propagates into the search
 * planner's saturation and yield-guard arithmetic, which decides whether a
 * geographic cell is worth subdividing. A timed-out cell would look exhausted.
 *
 * Observed live on 2026-08-28 against overpass-api.de: the three-clause query
 * below timed out server-side and the job recorded a clean zero.
 *
 * Extends Error with a retryable marker so src/retry.ts backs off and retries
 * rather than parking the job — a loaded public endpoint is the definition of
 * a transient failure.
 */
export class OverpassRuntimeError extends Error {
  readonly retryable = true

  constructor(remark: string) {
    super(`Overpass returned a runtime error rather than results: ${remark}`)
    this.name = 'OverpassRuntimeError'
  }
}

/**
 * Overpass uses `remark` for both hard runtime errors and soft advisories
 * ("...has been truncated..."), so the presence of the field is not by itself
 * a failure. Only refuse on the wording that means the query did not run.
 */
function assertNoRuntimeError(parsed: OverpassResponse): void {
  const remark = parsed.remark
  if (!remark) return
  if (/runtime error|timed out|out of memory|too many/i.test(remark)) {
    throw new OverpassRuntimeError(remark)
  }
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

    // TWO REQUESTS, NOT ONE UNION — and the split is a correctness decision.
    //
    // These clauses used to be a single Overpass union. The third one, a
    // case-insensitive regex over every shop=beauty node in the radius, is
    // dramatically more expensive than the first two, and on a loaded public
    // endpoint it is what exhausts the server-side budget. Because Overpass
    // evaluates a union as one statement, that speculative low-confidence
    // fallback took the high-confidence primary result down with it: the
    // observed failure returned zero barbershops for central Lyon, where OSM
    // actually holds 367.
    //
    // Split, the primary result survives on its own merits. A failure in the
    // fallback costs us the handful of loosely-tagged independents it might
    // have found, and is logged; it can no longer erase everything else.
    const primary = await this.run(
      buildPrimaryQuery(query.latitude, query.longitude, radiusMeters),
      45_000,
    )

    let fallback: RawCandidate[] = []
    try {
      fallback = await this.run(
        buildLooseBarberQuery(query.latitude, query.longitude, radiusMeters),
        45_000,
      )
    } catch (error) {
      // Deliberately swallowed, and deliberately NOT counted as zero: the
      // primary result is returned unchanged, so nothing downstream is told
      // that this area was searched exhaustively when it was not.
      ctx.logger.warn('osm: loose barber fallback failed, keeping primary results', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // Overpass can legitimately return the same node from both queries only if
    // a shop were tagged hairdresser AND beauty, which it cannot be — `shop` is
    // a single value. Dedupe anyway, because relying on that is relying on a
    // data-modelling convention holding forever in a crowd-sourced database.
    const seen = new Set<string>()
    const candidates: RawCandidate[] = []
    for (const candidate of [...primary, ...fallback]) {
      if (seen.has(candidate.externalId)) continue
      seen.add(candidate.externalId)
      candidates.push(candidate)
    }

    return query.maxCandidates ? candidates.slice(0, query.maxCandidates) : candidates
  }

  private async run(ql: string, timeoutMs: number): Promise<RawCandidate[]> {
    const body = await fetchText(this.config.OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: ql,
      timeoutMs,
    })

    const parsed = JSON.parse(body) as OverpassResponse
    assertNoRuntimeError(parsed)

    return (parsed.elements ?? [])
      .map((el) => elementToCandidate(el))
      .filter((c): c is RawCandidate => c !== null)
  }
}

// The server-side timeout is deliberately below the client timeout above, so
// Overpass gets the chance to answer "I could not do this" — which we can now
// distinguish from "there is nothing here" — instead of the client aborting
// first and turning a knowable failure into an ambiguous one.
const SERVER_TIMEOUT_SECONDS = 40

function buildPrimaryQuery(lat: number, lon: number, radiusMeters: number): string {
  return `
[out:json][timeout:${SERVER_TIMEOUT_SECONDS}];
(
  node["shop"="hairdresser"](around:${radiusMeters},${lat},${lon});
  way["shop"="hairdresser"](around:${radiusMeters},${lat},${lon});
);
out center tags;
`.trim()
}

function buildLooseBarberQuery(lat: number, lon: number, radiusMeters: number): string {
  return `
[out:json][timeout:${SERVER_TIMEOUT_SECONDS}];
(
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
