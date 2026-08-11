import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig, resetConfigCache } from '../src/config.js'
import { OsmAdapter } from '../src/sources/osm.js'
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
                categories: ['commercial.hairdresser'],
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
