import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig, resetConfigCache } from '../src/config.js'
import { OsmAdapter, OverpassRuntimeError } from '../src/sources/osm.js'
import { classifyError } from '../src/retry.js'
import { GeoapifyAdapter } from '../src/sources/geoapify.js'
import { SireneAdapter } from '../src/sources/sirene.js'
import { GooglePlacesAdapter } from '../src/sources/google-places.js'
import { WebsiteAdapter } from '../src/sources/website.js'
import { InstagramAdapter } from '../src/sources/instagram.js'
import { logger } from '../src/logger.js'

function baseEnv(overrides: Record<string, string> = {}) {
  return {
    DB_HOST: 'localhost',
    DB_NAME: 'test',
    DB_USER: 'test',
    DB_PASSWORD: 'test',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: Partial<{ status: number }> = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

const ctx = { jobId: null, logger }

afterEach(() => {
  vi.unstubAllGlobals()
  resetConfigCache()
})

describe('OsmAdapter', () => {
  it('is always configured (no API key required)', () => {
    const config = loadConfig(baseEnv())
    expect(new OsmAdapter(config).isConfigured()).toBe(true)
  })

  it('returns [] when latitude/longitude are missing', async () => {
    const config = loadConfig(baseEnv())
    const adapter = new OsmAdapter(config)
    const result = await adapter.discover({ country: 'FR' }, ctx)
    expect(result).toEqual([])
  })

  it('maps a shop=hairdresser node to a high-confidence candidate', async () => {
    const config = loadConfig(baseEnv())
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          elements: [
            {
              type: 'node',
              id: 123,
              lat: 48.857,
              lon: 2.352,
              tags: { name: 'Le Barbier de Paris', shop: 'hairdresser', 'addr:city': 'Paris', phone: '+33612345678' },
            },
          ],
        }),
      ),
    )

    const adapter = new OsmAdapter(config)
    const result = await adapter.discover({ country: 'FR', latitude: 48.857, longitude: 2.352, radiusKm: 5 }, ctx)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ externalId: 'node/123', externalType: 'osm_node', name: 'Le Barbier de Paris', confidence: 0.75 })
  })

  it('skips elements with no name tag', async () => {
    const config = loadConfig(baseEnv())
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ elements: [{ type: 'node', id: 1, tags: { shop: 'hairdresser' } }] })))

    const adapter = new OsmAdapter(config)
    const result = await adapter.discover({ country: 'FR', latitude: 48.857, longitude: 2.352 }, ctx)
    expect(result).toEqual([])
  })

  // ---------------------------------------------------------------------
  // The silent-zero defect, observed live on 2026-08-28 against
  // overpass-api.de: a discovery job over central Lyon recorded
  // `candidates_found = 0, status = completed, error = null` while OSM
  // actually held 367 hairdressers there.
  //
  // Overpass reports server-side failure as HTTP 200 with an empty
  // `elements` array and a `remark`. Read naively that is indistinguishable
  // from "there is nothing here", which is the manufactured-signal failure
  // acquisition-intelligence.md's first rule forbids — and it propagates
  // into the search planner's saturation arithmetic, where a timed-out cell
  // looks exhausted.
  // ---------------------------------------------------------------------

  it('refuses to report a server-side timeout as zero results', async () => {
    const config = loadConfig(baseEnv())
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          elements: [],
          remark: 'runtime error: Query timed out in "query" at line 5 after 27 seconds.',
        }),
      ),
    )

    const adapter = new OsmAdapter(config)
    await expect(
      adapter.discover({ country: 'FR', latitude: 45.764, longitude: 4.8357, radiusKm: 2 }, ctx),
    ).rejects.toThrow(/runtime error/i)
  })

  it('classifies that failure as retryable, because a loaded endpoint is transient', async () => {
    const error = new OverpassRuntimeError('runtime error: Query timed out')
    expect(classifyError(error)).toEqual({
      retryable: true,
      reason: 'upstream query engine overloaded',
    })
  })

  it('tolerates a non-error remark rather than failing on the field existing', async () => {
    const config = loadConfig(baseEnv())
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          elements: [{ type: 'node', id: 7, lat: 1, lon: 2, tags: { name: 'Still Here', shop: 'hairdresser' } }],
          remark: 'The data included in this document is from www.openstreetmap.org.',
        }),
      ),
    )

    const adapter = new OsmAdapter(config)
    const result = await adapter.discover({ country: 'FR', latitude: 1, longitude: 2 }, ctx)
    expect(result).toHaveLength(1)
  })

  it('keeps the primary result when only the speculative fallback fails', async () => {
    const config = loadConfig(baseEnv())
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1
        // First request: the cheap hairdresser query, which succeeds.
        if (call === 1) {
          return jsonResponse({
            elements: [
              { type: 'node', id: 1, lat: 45.76, lon: 4.83, tags: { name: 'Fade Lyon', shop: 'hairdresser' } },
            ],
          })
        }
        // Second: the expensive name-regex fallback, which times out. Before
        // the split this was one union, so this failure erased the row above.
        return jsonResponse({ elements: [], remark: 'runtime error: Query timed out' })
      }),
    )

    const adapter = new OsmAdapter(config)
    const result = await adapter.discover({ country: 'FR', latitude: 45.76, longitude: 4.83, radiusKm: 2 }, ctx)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'Fade Lyon' })
  })

  it('fails the whole discovery when the PRIMARY query fails', async () => {
    const config = loadConfig(baseEnv())
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ elements: [], remark: 'runtime error: Query timed out' })),
    )

    const adapter = new OsmAdapter(config)
    // The inverse of the test above, and the reason the fallback's catch is
    // narrow: losing the loose-barber sweep is a partial result, losing the
    // hairdresser sweep is no result at all and must not be reported as one.
    await expect(
      adapter.discover({ country: 'FR', latitude: 45.76, longitude: 4.83 }, ctx),
    ).rejects.toThrow(OverpassRuntimeError)
  })

  it('merges both queries and de-duplicates by external id', async () => {
    const config = loadConfig(baseEnv())
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1
        return jsonResponse({
          elements: [
            call === 1
              ? { type: 'node', id: 1, lat: 1, lon: 2, tags: { name: 'Primary Cut', shop: 'hairdresser' } }
              : { type: 'node', id: 2, lat: 1, lon: 2, tags: { name: 'Barber Beauty', shop: 'beauty' } },
          ],
        })
      }),
    )

    const adapter = new OsmAdapter(config)
    const result = await adapter.discover({ country: 'FR', latitude: 1, longitude: 2 }, ctx)

    expect(result.map((c) => c.name)).toEqual(['Primary Cut', 'Barber Beauty'])
    // The loose match is deliberately lower confidence than a direct
    // shop=hairdresser tag.
    expect(result[1]?.confidence).toBe(0.4)
  })
})

describe('GeoapifyAdapter', () => {
  it('is not configured without an API key', () => {
    const config = loadConfig(baseEnv())
    expect(new GeoapifyAdapter(config).isConfigured()).toBe(false)
  })

  it('throws when called without a key rather than silently returning []', async () => {
    const config = loadConfig(baseEnv())
    const adapter = new GeoapifyAdapter(config)
    await expect(adapter.discover({ country: 'FR', latitude: 48.8, longitude: 2.3 }, ctx)).rejects.toThrow(/GEOAPIFY_API_KEY/)
  })

  it('maps a Geoapify feature to a candidate when configured', async () => {
    const config = loadConfig(baseEnv({ GEOAPIFY_API_KEY: 'test-key' }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          features: [
            {
              properties: {
                place_id: 'geo-1',
                name: 'Barbier Moderne',
                categories: ['service.beauty.hairdresser'],
                city: 'Lyon',
                country_code: 'fr',
                lat: 45.75,
                lon: 4.85,
              },
            },
          ],
        }),
      ),
    )

    const adapter = new GeoapifyAdapter(config)
    const result = await adapter.discover({ country: 'FR', latitude: 45.75, longitude: 4.85, radiusKm: 5 }, ctx)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ externalId: 'geo-1', name: 'Barbier Moderne', country: 'FR' })
  })
})

describe('SireneAdapter', () => {
  it('is France-only — returns [] for other countries even when configured', async () => {
    const config = loadConfig(baseEnv({ INSEE_API_KEY: 'test-token' }))
    const adapter = new SireneAdapter(config)
    const result = await adapter.discover({ country: 'US', city: 'New York' }, ctx)
    expect(result).toEqual([])
  })

  it('maps an etablissement to a high-confidence candidate with siret as external id', async () => {
    const config = loadConfig(baseEnv({ INSEE_API_KEY: 'test-token' }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          etablissements: [
            {
              siren: '123456789',
              siret: '12345678900012',
              adresseEtablissement: { libelleCommuneEtablissement: 'Paris', codePostalEtablissement: '75011' },
              uniteLegale: { denominationUniteLegale: 'BARBIER SARL' },
            },
          ],
        }),
      ),
    )

    const adapter = new SireneAdapter(config)
    const result = await adapter.discover({ country: 'FR', city: 'Paris' }, ctx)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ externalId: '12345678900012', externalType: 'siret', confidence: 0.85 })
  })
})

describe('GooglePlacesAdapter', () => {
  it('uses a minimal FieldMask header and never requests reviews/photos', async () => {
    const config = loadConfig(baseEnv({ GOOGLE_PLACES_API_KEY: 'test-key' }))
    const fetchMock = vi.fn(async () => jsonResponse({ places: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new GooglePlacesAdapter(config)
    await adapter.discover({ country: 'FR', city: 'Paris', keywords: ['Le Barbier de Paris'] }, ctx)

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const fieldMask = new Headers(init.headers).get('X-Goog-FieldMask')
    expect(fieldMask).not.toBeNull()
    expect(fieldMask).not.toMatch(/review/i)
    expect(fieldMask).not.toMatch(/photo/i)
  })
})

describe('WebsiteAdapter', () => {
  it('returns [] without a websiteUrl in the query', async () => {
    const config = loadConfig(baseEnv())
    const adapter = new WebsiteAdapter(config)
    const result = await adapter.discover({ country: 'FR' }, ctx)
    expect(result).toEqual([])
  })

  it('extracts email/phone/instagram/booking provider from homepage HTML', async () => {
    const config = loadConfig(baseEnv())
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          `<html><head><title>Le Barbier de Paris</title></head><body>
             <a href="mailto:contact@lebarbier.fr">Email us</a>
             <a href="tel:+33612345678">Call</a>
             <a href="https://instagram.com/lebarbierdeparis">Instagram</a>
             <script src="https://widget.fresha.com/embed.js"></script>
           </body></html>`,
          { status: 200, headers: { 'content-type': 'text/html' } },
        ),
      ),
    )

    const adapter = new WebsiteAdapter(config)
    const result = await adapter.discover({ country: 'FR', websiteUrl: 'https://lebarbier.fr' }, ctx)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      email: 'contact@lebarbier.fr',
      phone: '+33612345678',
      instagramHandle: 'lebarbierdeparis',
    })
    expect(result[0]?.rawPayload['bookingProvider']).toBe('fresha')
  })
})

describe('InstagramAdapter', () => {
  it('is not configured without META_ACCESS_TOKEN and META_INSTAGRAM_BUSINESS_ACCOUNT_ID', () => {
    const config = loadConfig(baseEnv())
    expect(new InstagramAdapter(config).isConfigured()).toBe(false)
  })

  it('throws (gracefully, a caught/classified error, not a crash) when called unconfigured', async () => {
    const config = loadConfig(baseEnv())
    const adapter = new InstagramAdapter(config)
    await expect(adapter.discover({ country: 'FR', instagramHandle: 'somebarber' }, ctx)).rejects.toThrow(/gracefully disabled/)
  })

  it('is configured once both Meta credentials are present', () => {
    const config = loadConfig(baseEnv({ META_ACCESS_TOKEN: 'token', META_INSTAGRAM_BUSINESS_ACCOUNT_ID: '12345' }))
    expect(new InstagramAdapter(config).isConfigured()).toBe(true)
  })
})
