import { describe, expect, it } from 'vitest'
import frBooking from '@/shared/i18n/locales/fr/booking.json'
import enBooking from '@/shared/i18n/locales/en/booking.json'
import {
  BOOKING_REFUSAL_CODES,
  INTEREST_REFUSAL_CODES,
  bookingRefusalIsSlotRelated,
  bookingRefusalMessageKey,
  interestRefusalMessageKey,
  parseBookingRefusal,
  parseInterestRefusal,
} from '@/features/booking/lib/refusals'

describe('refusals — le motif est lu sur le CODE, jamais sur le texte', () => {
  it('extrait le code du DETAIL PostgREST (fadeup_booking_refusal=…)', () => {
    expect(parseBookingRefusal({ details: 'fadeup_booking_refusal=slot_conflict' })).toBe('slot_conflict')
    expect(parseBookingRefusal({ details: 'fadeup_booking_refusal=too_many_future_bookings' })).toBe(
      'too_many_future_bookings',
    )
  })

  it('un code inconnu ou une erreur sans details rend null (chemin toAppError)', () => {
    expect(parseBookingRefusal({ details: 'fadeup_booking_refusal=xyz' })).toBeNull()
    expect(parseBookingRefusal({ message: 'requested time is outside available hours' })).toBeNull()
    expect(parseBookingRefusal(null)).toBeNull()
    expect(parseBookingRefusal('texte')).toBeNull()
  })

  it('les deux refus SANS detail se lisent sur le SQLSTATE : 23P01 (exclusion) et 22023 (blocage de temps)', () => {
    expect(parseBookingRefusal({ code: '23P01', message: 'conflicting key value' })).toBe('slot_conflict')
    expect(parseBookingRefusal({ code: '22023', message: 'the professional is unavailable' })).toBe('slot_conflict')
    // …mais un 22023 QUI PORTE un detail nommé garde son code précis.
    expect(parseBookingRefusal({ code: '22023', details: 'fadeup_booking_refusal=outside_hours' })).toBe('outside_hours')
    // Un autre SQLSTATE n'est pas un refus de créneau.
    expect(parseBookingRefusal({ code: '42501', message: 'not authorized' })).toBeNull()
  })

  it('demande d’intérêt : fadeup_interest_refusal=… (B2)', () => {
    expect(parseInterestRefusal({ details: 'fadeup_interest_refusal=profile_withdrawn' })).toBe('profile_withdrawn')
    expect(parseInterestRefusal({ details: 'fadeup_booking_refusal=past_time' })).toBeNull()
  })

  it('chaque code a son message FR et EN, tous DISTINCTS et non vides', () => {
    for (const [codes, table] of [
      [BOOKING_REFUSAL_CODES, 'refusal'],
      [INTEREST_REFUSAL_CODES, 'interestRefusal'],
    ] as const) {
      for (const bundle of [frBooking, enBooking]) {
        const messages = codes.map((code) => (bundle as Record<string, Record<string, string>>)[table]?.[code])
        for (const message of messages) {
          expect(message).toBeTruthy()
        }
        expect(new Set(messages).size).toBe(codes.length)
      }
    }
  })

  it('les clés i18n suivent la convention v2', () => {
    expect(bookingRefusalMessageKey('slot_conflict')).toBe('booking.refusal.slot_conflict')
    expect(interestRefusalMessageKey('too_far_ahead')).toBe('booking.interestRefusal.too_far_ahead')
  })

  it('seuls les refus de créneau relancent la sélection', () => {
    expect(bookingRefusalIsSlotRelated('slot_conflict')).toBe(true)
    expect(bookingRefusalIsSlotRelated('outside_hours')).toBe(true)
    expect(bookingRefusalIsSlotRelated('too_many_future_bookings')).toBe(false)
    expect(bookingRefusalIsSlotRelated('service_mode_closed')).toBe(false)
  })
})
