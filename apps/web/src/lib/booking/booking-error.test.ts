import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bookingErrorKey, isSlotUnavailable } from '@/lib/booking/booking-error'

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'locales')

function englishBooking(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(LOCALES_DIR, 'en', 'booking.json'), 'utf8'))
}

function lookup(tree: Record<string, unknown>, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[part]
    return undefined
  }, tree)
}

describe('bookingErrorKey', () => {
  it('maps the exclusion-constraint race to "someone took that slot"', () => {
    // The literal message Postgres raises when two people book the same slot
    // in the same instant — the one failure this flow is guaranteed to hit.
    expect(
      bookingErrorKey('conflicting key value violates exclusion constraint "appointments_no_overlap"'),
    ).toBe('errors.slotTaken')
    expect(bookingErrorKey('duplicate key value violates unique constraint')).toBe('errors.slotTaken')
  })

  it('maps each guard raised by book_public_appointment', () => {
    expect(bookingErrorKey('starts_at must be in the future')).toBe('errors.slotPast')
    expect(bookingErrorKey('requested slot is outside available hours')).toBe('errors.outsideHours')
    expect(bookingErrorKey('barber is unavailable on the requested date')).toBe('errors.barberUnavailable')
    expect(bookingErrorKey('at least one of customer_phone or customer_email is required')).toBe(
      'validation.contactRequired',
    )
    expect(bookingErrorKey('customer_name is required')).toBe('validation.nameRequired')
    expect(bookingErrorKey('location is not available for booking')).toBe('errors.locationUnavailable')
    expect(bookingErrorKey('service is not available for booking')).toBe('errors.serviceUnavailable')
    expect(bookingErrorKey('barber is not available for this service')).toBe('errors.barberServiceMismatch')
  })

  it('is case-insensitive, because the raised text is not a contract', () => {
    expect(bookingErrorKey('CUSTOMER_NAME IS REQUIRED')).toBe('validation.nameRequired')
  })

  it('falls back to a generic message rather than leaking database internals', () => {
    expect(bookingErrorKey('null value in column "barber_id" violates not-null constraint')).toBe('errors.generic')
    expect(bookingErrorKey('')).toBe('errors.generic')
  })

  it('every key it can return actually exists in the booking namespace', () => {
    // The whole point of returning keys instead of sentences is translation;
    // a key with no entry would render as the raw key on screen.
    const tree = englishBooking()
    const samples = [
      'conflicting key value',
      'starts_at must be in the future',
      'outside available hours',
      'unavailable on the requested date',
      'at least one of customer_phone or customer_email',
      'customer_name is required',
      'location is not available for booking',
      'service is not available for booking',
      'barber is not available for this service',
      'something nobody anticipated',
    ]
    for (const sample of samples) {
      const key = bookingErrorKey(sample)
      expect(typeof lookup(tree, key), `booking:${key} is missing`).toBe('string')
    }
  })
})

describe('isSlotUnavailable', () => {
  it('is true exactly for the failures that make the chosen time unusable', () => {
    // These send the customer back to a fresh list of times. Anything else
    // is fixable in the form they are already looking at.
    expect(isSlotUnavailable('errors.slotTaken')).toBe(true)
    expect(isSlotUnavailable('errors.slotPast')).toBe(true)
    expect(isSlotUnavailable('errors.outsideHours')).toBe(true)
    expect(isSlotUnavailable('errors.barberUnavailable')).toBe(true)

    expect(isSlotUnavailable('validation.nameRequired')).toBe(false)
    expect(isSlotUnavailable('validation.contactRequired')).toBe(false)
    expect(isSlotUnavailable('errors.generic')).toBe(false)
  })
})
