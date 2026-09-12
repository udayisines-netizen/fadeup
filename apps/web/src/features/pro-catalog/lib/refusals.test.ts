import { describe, expect, it } from 'vitest'
import { parseServiceRefusal, serviceRefusalMessageKey } from './refusals'

describe('parseServiceRefusal', () => {
  it('lit le motif nommé dans `details`', () => {
    expect(parseServiceRefusal({ code: '42501', details: 'fadeup_service_refusal=price_forbidden_for_role' })).toBe(
      'price_forbidden_for_role',
    )
  })

  it('lit le motif même suivi de compteurs (has_history)', () => {
    expect(
      parseServiceRefusal({
        code: '23503',
        details: 'fadeup_service_refusal=has_history appointments=3 queue=0 samples=7 posts=1',
      }),
    ).toBe('has_history')
  })

  it('ignore un motif inconnu, un autre domaine, et une erreur sans details', () => {
    expect(parseServiceRefusal({ details: 'fadeup_service_refusal=teleportation' })).toBeNull()
    expect(parseServiceRefusal({ details: 'fadeup_booking_refusal=slot_conflict' })).toBeNull()
    expect(parseServiceRefusal({ code: '42501' })).toBeNull()
    expect(parseServiceRefusal(new TypeError('Failed to fetch'))).toBeNull()
    expect(parseServiceRefusal(null)).toBeNull()
  })
})

describe('serviceRefusalMessageKey', () => {
  it('donne une clé dédiée aux refus que le professionnel doit comprendre', () => {
    expect(serviceRefusalMessageKey('has_history')).toBe('pro.catalog.errors.hasHistory')
    expect(serviceRefusalMessageKey('price_forbidden_for_role')).toBe('pro.catalog.errors.priceForbidden')
    expect(serviceRefusalMessageKey('archived')).toBe('pro.catalog.errors.archived')
  })

  it('laisse retomber sur la traduction générique les motifs sans copie dédiée', () => {
    expect(serviceRefusalMessageKey('not_authorized')).toBeNull()
    expect(serviceRefusalMessageKey('category_foreign')).toBeNull()
    expect(serviceRefusalMessageKey('barber_foreign')).toBeNull()
    expect(serviceRefusalMessageKey('price_negative')).toBeNull()
  })
})
