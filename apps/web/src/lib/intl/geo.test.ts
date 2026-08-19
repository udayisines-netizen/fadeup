import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearGeoCache, fetchGeoSuggestion, UNKNOWN_GEO } from '@/lib/intl/geo'
import { getSupabaseClient } from '@/lib/supabase'
import { KNOWN_COUNTRIES, countryMeta } from '@/lib/intl/countries'

vi.mock('@/lib/supabase', () => ({ getSupabaseClient: vi.fn() }))

const mockClient = vi.mocked(getSupabaseClient)

function withResponse(data: unknown, error: unknown = null) {
  mockClient.mockReturnValue({ functions: { invoke: vi.fn().mockResolvedValue({ data, error }) } } as never)
}

describe('GeoIP client boundary', () => {
  beforeEach(() => {
    clearGeoCache()
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('resolves a country and its suggestions', () => {
    withResponse({
      countryCode: 'FR',
      suggestedLocale: 'fr',
      suggestedCurrency: 'EUR',
      suggestedTimezone: 'Europe/Paris',
      source: 'ip-lookup',
    })

    return fetchGeoSuggestion().then((result) => {
      expect(result).toMatchObject({
        countryCode: 'FR',
        suggestedLocale: 'fr',
        suggestedCurrency: 'EUR',
        suggestedTimezone: 'Europe/Paris',
        source: 'ip-lookup',
      })
    })
  })

  it('degrades to a usable object when the endpoint fails', async () => {
    withResponse(null, new Error('function unavailable'))

    // GeoIP must never be able to break FadeUp. There is no error state to
    // handle: callers get "nothing known" and carry on with browser language.
    await expect(fetchGeoSuggestion()).resolves.toEqual(UNKNOWN_GEO)
  })

  it('degrades when the network throws outright', async () => {
    mockClient.mockReturnValue({
      functions: { invoke: vi.fn().mockRejectedValue(new Error('offline')) },
    } as never)

    await expect(fetchGeoSuggestion()).resolves.toEqual(UNKNOWN_GEO)
  })

  it('REJECTS a malformed country code instead of passing it through', async () => {
    // A bad provider response must become "no answer", never a corrupt answer
    // that later reaches a currency lookup or a country picker.
    withResponse({ countryCode: 'FRANCE', suggestedLocale: 'fr', source: 'ip-lookup' })

    const result = await fetchGeoSuggestion()
    expect(result.countryCode).toBeNull()
  })

  it('rejects a currency that is not three letters', async () => {
    withResponse({ countryCode: 'FR', suggestedCurrency: 'Euro', source: 'ip-lookup' })

    const result = await fetchGeoSuggestion()
    expect(result.suggestedCurrency).toBeNull()
  })

  it('rejects a timezone the runtime cannot actually use', async () => {
    // Otherwise it would throw somewhere far away, inside a date formatter.
    withResponse({ countryCode: 'FR', suggestedTimezone: 'Mars/Olympus_Mons', source: 'ip-lookup' })

    const result = await fetchGeoSuggestion()
    expect(result.suggestedTimezone).toBeNull()
  })

  it('rejects an unsupported locale suggestion', async () => {
    withResponse({ countryCode: 'IS', suggestedLocale: 'is', source: 'ip-lookup' })

    const result = await fetchGeoSuggestion()
    expect(result.suggestedLocale).toBeNull()
  })

  it('caches, so a route change is not a lookup', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { countryCode: 'GB', suggestedLocale: 'en', suggestedCurrency: 'GBP', source: 'ip-lookup' },
      error: null,
    })
    mockClient.mockReturnValue({ functions: { invoke } } as never)

    await fetchGeoSuggestion()
    await fetchGeoSuggestion()
    await fetchGeoSuggestion()

    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent first calls', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { countryCode: 'GB', suggestedLocale: 'en', source: 'ip-lookup' },
      error: null,
    })
    mockClient.mockReturnValue({ functions: { invoke } } as never)

    // Several components mounting at once on a cold cache must not each fire
    // their own request.
    await Promise.all([fetchGeoSuggestion(), fetchGeoSuggestion(), fetchGeoSuggestion()])

    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('caches a FAILURE too, so a blocked request is not retried on every page', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('blocked by extension'))
    mockClient.mockReturnValue({ functions: { invoke } } as never)

    await fetchGeoSuggestion()
    await fetchGeoSuggestion()

    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('never persists anything resembling an IP address', async () => {
    withResponse({ countryCode: 'FR', suggestedLocale: 'fr', source: 'ip-lookup' })
    await fetchGeoSuggestion()

    const stored = JSON.stringify(localStorage)
    // Country-level personalization, not surveillance.
    expect(stored).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/)
    expect(stored.toLowerCase()).not.toContain('"ip"')
  })
})

/**
 * The Edge Function runs in Deno and cannot import the app's country table, so
 * it keeps its own copy. That duplication is unavoidable — but it must not be
 * SILENT, because a country added on one side and not the other produces a
 * shop defaulted to the wrong currency.
 *
 * This parses the function's source and fails the build if the two disagree.
 */
describe('country table parity with the locale-detect Edge Function', () => {
  const functionPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../../infra/supabase/volumes/functions/locale-detect/index.ts',
  )

  function edgeCountries(): Record<string, { locale: string; currency: string; timezone: string }> {
    const source = readFileSync(functionPath, 'utf8')
    const table: Record<string, { locale: string; currency: string; timezone: string }> = {}
    const pattern =
      /^\s{2}([A-Z]{2}):\s*\{\s*locale:\s*'([^']+)',\s*currency:\s*'([^']+)',\s*timezone:\s*'([^']+)'\s*\},?$/gm
    for (const match of source.matchAll(pattern)) {
      table[match[1]] = { locale: match[2], currency: match[3], timezone: match[4] }
    }
    return table
  }

  it('keeps the LEGACY country/locale fields in the response', () => {
    // infra/supabase/volumes/functions is bind-mounted into the running
    // container, so this file IS production the moment it is saved — there is
    // no build step between the two. The web bundle is not: it ships in an
    // image. So the function is routinely newer than its clients, and the
    // deployed marketing bundle reads `country`/`locale`.
    //
    // Renaming those to countryCode/suggestedLocale without keeping the old
    // pair silently broke regional pricing detection on the live site. This
    // asserts the compatibility shim is still there.
    const source = readFileSync(functionPath, 'utf8')
    expect(source).toMatch(/country:\s*body\.countryCode/)
    expect(source).toMatch(/locale:\s*body\.suggestedLocale/)
  })

  it('parses the edge table at all (guards against this test silently passing)', () => {
    expect(Object.keys(edgeCountries()).length).toBeGreaterThan(20)
  })

  it('covers exactly the same countries on both sides', () => {
    const edge = Object.keys(edgeCountries()).sort()
    const app = KNOWN_COUNTRIES.map((country) => country.code).sort()
    expect(edge).toEqual(app)
  })

  it('agrees on locale, currency and timezone for every country', () => {
    for (const [code, edgeEntry] of Object.entries(edgeCountries())) {
      const appEntry = countryMeta(code)
      expect(appEntry, `${code} missing from the app table`).not.toBeNull()
      expect({ code, ...edgeEntry }).toEqual({
        code,
        locale: appEntry!.locale,
        currency: appEntry!.currency,
        timezone: appEntry!.timezone,
      })
    }
  })
})
