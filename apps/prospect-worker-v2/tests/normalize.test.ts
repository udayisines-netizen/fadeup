import { describe, expect, it } from 'vitest'
import { normalizeBusinessName } from '../src/normalize/name.js'
import { normalizePhoneE164 } from '../src/normalize/phone.js'
import { normalizeDomain, normalizeUrl } from '../src/normalize/domain.js'
import { normalizeEmail, normalizeSocialHandle } from '../src/normalize/email.js'
import { normalizeCity, normalizeCountryCode, normalizePostalCode } from '../src/normalize/address.js'

describe('normalizeBusinessName', () => {
  it('lowercases, strips accents, and collapses whitespace', () => {
    expect(normalizeBusinessName('Café  de  Paris')).toBe('cafe de paris')
  })

  it('strips common noise words', () => {
    expect(normalizeBusinessName('Le Barbershop Moderne')).toBe('moderne')
  })

  it('returns empty string for null/undefined', () => {
    expect(normalizeBusinessName(null)).toBe('')
    expect(normalizeBusinessName(undefined)).toBe('')
  })

  it('two names that are the same business under different noise words normalize identically', () => {
    expect(normalizeBusinessName('Le Barbier de Paris')).toBe(normalizeBusinessName('Barbier de Paris'))
  })
})

describe('normalizePhoneE164', () => {
  it('normalizes a French national number with a country hint', () => {
    expect(normalizePhoneE164('06 12 34 56 78', 'FR')).toBe('+33612345678')
  })

  it('passes through an already-E.164 number', () => {
    expect(normalizePhoneE164('+33612345678', 'FR')).toBe('+33612345678')
  })

  it('handles 00-prefixed international format', () => {
    expect(normalizePhoneE164('0033612345678', 'FR')).toBe('+33612345678')
  })

  it('returns null without a country hint for a national-format number', () => {
    expect(normalizePhoneE164('0612345678', null)).toBeNull()
  })

  it('returns null for empty/garbage input', () => {
    expect(normalizePhoneE164('', 'FR')).toBeNull()
    expect(normalizePhoneE164('abc', 'FR')).toBeNull()
    expect(normalizePhoneE164(null, 'FR')).toBeNull()
  })

  it('returns null for an unknown country hint', () => {
    expect(normalizePhoneE164('0612345678', 'ZZ')).toBeNull()
  })
})

describe('normalizeDomain', () => {
  it('extracts a lowercase host without www', () => {
    expect(normalizeDomain('https://WWW.Example.com/path?x=1')).toBe('example.com')
  })

  it('adds a scheme when missing', () => {
    expect(normalizeDomain('example.com')).toBe('example.com')
  })

  it('returns null for invalid input', () => {
    expect(normalizeDomain('')).toBeNull()
    expect(normalizeDomain(null)).toBeNull()
  })
})

describe('normalizeUrl', () => {
  it('lowercases the host and strips a bare trailing slash', () => {
    expect(normalizeUrl('https://Example.com/')).toBe('https://example.com')
  })

  it('preserves path and query', () => {
    expect(normalizeUrl('https://example.com/booking?ref=x')).toBe('https://example.com/booking?ref=x')
  })
})

describe('normalizeEmail', () => {
  it('lowercases and trims a valid email', () => {
    expect(normalizeEmail('  Contact@Example.COM ')).toBe('contact@example.com')
  })

  it('rejects malformed input', () => {
    expect(normalizeEmail('not-an-email')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
  })
})

describe('normalizeSocialHandle', () => {
  it('strips a leading @', () => {
    expect(normalizeSocialHandle('@MyBarbershop')).toBe('mybarbershop')
  })

  it('extracts a handle from a full instagram URL', () => {
    expect(normalizeSocialHandle('https://instagram.com/mybarbershop/')).toBe('mybarbershop')
  })

  it('extracts a handle from a full tiktok URL', () => {
    expect(normalizeSocialHandle('https://www.tiktok.com/@mybarbershop')).toBe('mybarbershop')
  })
})

describe('address normalization', () => {
  it('title-cases city names without touching accents', () => {
    expect(normalizeCity('paris')).toBe('Paris')
    expect(normalizeCity('saint-ouen')).toBe('Saint-Ouen')
  })

  it('rejects a country code that is not exactly 2 letters', () => {
    expect(normalizeCountryCode('France')).toBeNull()
    expect(normalizeCountryCode('fr')).toBe('FR')
  })

  it('normalizes postal code casing/whitespace', () => {
    expect(normalizePostalCode(' 75011 ')).toBe('75011')
  })
})
