import { describe, expect, it } from 'vitest'

import { bookingKeys, discoveryKeys, queueKeys } from '@/shared/data/keys'
import { shouldPersistQueryKey } from '@/shared/data/persistence'

/**
 * La décision du fondateur, éprouvée sur les VRAIES clés de requête du
 * produit — pas sur des chaînes inventées pour le test : si un lot renomme
 * une clé, ce fichier échoue, ce qui est exactement le service attendu.
 */
describe('liste blanche de persistance hors ligne', () => {
  it('persiste mes réservations et mon historique', () => {
    expect(shouldPersistQueryKey(bookingKeys.list({}))).toBe(true)
    expect(shouldPersistQueryKey(bookingKeys.lists())).toBe(true)
  })

  it("persiste mes demandes d'intérêt", () => {
    expect(shouldPersistQueryKey(bookingKeys.interestRequests())).toBe(true)
  })

  it('réserve sa place au Fade Passport', () => {
    expect(shouldPersistQueryKey(['passport', 'mine'])).toBe(true)
  })

  it('ne persiste JAMAIS quoi que ce soit de la file', () => {
    expect(shouldPersistQueryKey(queueKeys.mine())).toBe(false)
    expect(shouldPersistQueryKey(queueKeys.publicStatus('chez-karim', 'loc'))).toBe(false)
    expect(shouldPersistQueryKey(queueKeys.publicServiceState('chez-karim', 'loc'))).toBe(false)
    expect(shouldPersistQueryKey(queueKeys.all)).toBe(false)
  })

  it('ne persiste pas les créneaux, les barbers ni les alternatives', () => {
    expect(shouldPersistQueryKey(bookingKeys.slots('s', 'l', 'b', 'sv', '2026-09-12'))).toBe(false)
    expect(shouldPersistQueryKey(bookingKeys.barbers('s', 'l', 'sv'))).toBe(false)
    expect(shouldPersistQueryKey(bookingKeys.alternatives('org', 'coupe', null))).toBe(false)
  })

  it('ne persiste ni la découverte ni le fil', () => {
    expect(shouldPersistQueryKey(discoveryKeys.all)).toBe(false)
    // `feedKeys` vit dans features/feed/api (qui importe le client Supabase,
    // donc React Native) : on écrit la clé en clair plutôt que de tirer une
    // dépendance native dans un test Node.
    expect(shouldPersistQueryKey(['feed', 'list'])).toBe(false)
  })

  it("refuse par DÉFAUT : une clé inconnue n'est pas persistée", () => {
    expect(shouldPersistQueryKey(['quelque-chose-de-neuf'])).toBe(false)
    expect(shouldPersistQueryKey([])).toBe(false)
  })

  it("un préfixe partiel ne suffit pas", () => {
    // `bookings` seul couvrirait les créneaux : la liste blanche porte
    // `bookings/list`, pas `bookings`.
    expect(shouldPersistQueryKey(bookingKeys.all)).toBe(false)
  })
})
