import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from '../src/http.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

async function captureErrorMessage(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
    expect.unreachable('expected fn() to throw')
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('fetchJson secret redaction', () => {
  it('never includes an apiKey query param in a thrown HttpError message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403, statusText: 'Forbidden' })))

    const message = await captureErrorMessage(() => fetchJson('https://api.geoapify.com/v2/places?apiKey=super-secret-value&categories=x'))
    expect(message).not.toContain('super-secret-value')
    expect(message).toContain('REDACTED')
  })

  it('never includes an access_token query param in a thrown HttpError message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401, statusText: 'Unauthorized' })))

    const message = await captureErrorMessage(() => fetchJson('https://graph.facebook.com/v21.0/123?access_token=very-secret-token'))
    expect(message).not.toContain('very-secret-token')
    expect(message).toContain('REDACTED')
  })

  it('redacts a secret even when fetch() itself throws (network failure), not just on non-2xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )

    const message = await captureErrorMessage(() => fetchJson('https://api.geoapify.com/v2/places?apiKey=super-secret-value'))
    expect(message).not.toContain('super-secret-value')
    expect(message).toContain('REDACTED')
  })

  it('preserves the original error name through the network-failure wrap so retry classification still works', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )

    try {
      await fetchJson('https://example.com/x?token=secret')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).name).toBe('TypeError')
    }
  })

  it('does not touch a URL with no secret-shaped query params', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500, statusText: 'Server Error' })))

    const message = await captureErrorMessage(() => fetchJson('https://example.com/api?city=Paris'))
    expect(message).toContain('city=Paris')
  })
})
