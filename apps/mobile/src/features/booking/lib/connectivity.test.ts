import { describe, expect, it } from 'vitest'

import {
  deriveBookingsConnectivity,
  lastUpdatedLabel,
} from '@/features/booking/lib/connectivity'

describe('deriveBookingsConnectivity', () => {
  it('en ligne : tout est affichable, aucune mention de fraîcheur', () => {
    expect(deriveBookingsConnectivity({ online: true, hasStableData: true })).toEqual({
      blocked: false,
      showStaleNotice: false,
      showQueue: true,
    })
  })

  it("réseau pas encore mesuré : on ne déclare pas « hors ligne »", () => {
    expect(deriveBookingsConnectivity({ online: null, hasStableData: false }).blocked).toBe(false)
    expect(deriveBookingsConnectivity({ online: null, hasStableData: false }).showQueue).toBe(true)
  })

  it('hors ligne avec des réservations : on les montre, en disant leur âge', () => {
    expect(deriveBookingsConnectivity({ online: false, hasStableData: true })).toEqual({
      blocked: false,
      showStaleNotice: true,
      showQueue: false,
    })
  })

  it("hors ligne sans rien de stable : l'état honnête plein écran", () => {
    expect(deriveBookingsConnectivity({ online: false, hasStableData: false })).toEqual({
      blocked: true,
      showStaleNotice: false,
      showQueue: false,
    })
  })

  it("LA garde du lot : la file n'est JAMAIS affichée hors ligne", () => {
    for (const hasStableData of [true, false]) {
      expect(deriveBookingsConnectivity({ online: false, hasStableData }).showQueue).toBe(false)
    }
  })
})

describe('lastUpdatedLabel', () => {
  it('rend une heure lisible', () => {
    const at = Date.UTC(2026, 8, 12, 10, 5)
    expect(lastUpdatedLabel(at, 'fr')).toMatch(/\d{2}:\d{2}/)
    expect(lastUpdatedLabel(at, 'en')).toMatch(/\d{2}:\d{2}/)
  })

  it("ne rend RIEN plutôt qu'une heure inventée", () => {
    expect(lastUpdatedLabel(null, 'fr')).toBeNull()
    expect(lastUpdatedLabel(undefined, 'fr')).toBeNull()
    expect(lastUpdatedLabel(0, 'fr')).toBeNull()
    expect(lastUpdatedLabel(Number.NaN, 'fr')).toBeNull()
  })
})
