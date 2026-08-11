import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUuid } from '@/lib/uuid'

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('createUuid', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses crypto.randomUUID() when it is available', () => {
    const randomUUID = vi.spyOn(crypto, 'randomUUID')
    const id = createUuid()

    expect(randomUUID).toHaveBeenCalledTimes(1)
    expect(id).toMatch(UUID_V4_PATTERN)
  })

  it('falls back to crypto.getRandomValues() when crypto.randomUUID is undefined', () => {
    // Reproduces the "crypto.randomUUID is not a function" browser error —
    // e.g. a non-secure context or an older browser without randomUUID.
    vi.stubGlobal('crypto', {
      randomUUID: undefined,
      getRandomValues: crypto.getRandomValues.bind(crypto),
    })

    const getRandomValues = vi.spyOn(crypto, 'getRandomValues')
    const id = createUuid()

    expect(getRandomValues).toHaveBeenCalledTimes(1)
    expect(id).toMatch(UUID_V4_PATTERN)
  })

  it('never falls back to Math.random()', () => {
    vi.stubGlobal('crypto', {
      randomUUID: undefined,
      getRandomValues: crypto.getRandomValues.bind(crypto),
    })
    const mathRandom = vi.spyOn(Math, 'random')

    createUuid()

    expect(mathRandom).not.toHaveBeenCalled()
  })

  it('produces unique-looking output across repeated calls in fallback mode', () => {
    vi.stubGlobal('crypto', {
      randomUUID: undefined,
      getRandomValues: crypto.getRandomValues.bind(crypto),
    })

    const ids = new Set(Array.from({ length: 50 }, () => createUuid()))
    expect(ids.size).toBe(50)
  })
})
