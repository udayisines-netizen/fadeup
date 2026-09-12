import { describe, expect, it } from 'vitest'

import { routeForNotification } from '@/features/notifications/lib/notificationRoute'

describe('routeForNotification', () => {
  it("mène au suivi de la file quand le slug est là", () => {
    expect(routeForNotification({ kind: 'queue_entry', slug: 'chez-karim' })).toBe('/q/chez-karim')
  })

  it('échappe le slug', () => {
    expect(routeForNotification({ kind: 'queue_entry', slug: 'chez karim/2' })).toBe(
      '/q/chez%20karim%2F2',
    )
  })

  it("n'invente pas d'URL sans slug", () => {
    expect(routeForNotification({ kind: 'queue_entry', entry_id: 'abc' })).toBeNull()
    expect(routeForNotification({ kind: 'queue_entry', slug: '' })).toBeNull()
  })

  it('mène à mes réservations pour un rendez-vous', () => {
    expect(routeForNotification({ kind: 'appointment', appointment_id: 'x' })).toBe('/bookings')
  })

  it('mène au fil pour un post', () => {
    expect(routeForNotification({ kind: 'post', post_id: 'x' })).toBe('/feed')
  })

  it('ne route rien sur une charge inconnue, vide ou malformée', () => {
    expect(routeForNotification(null)).toBeNull()
    expect(routeForNotification(undefined)).toBeNull()
    expect(routeForNotification({})).toBeNull()
    expect(routeForNotification({ kind: 'promo' })).toBeNull()
    expect(routeForNotification({ kind: 42 } as never)).toBeNull()
  })
})
