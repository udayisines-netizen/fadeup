import { describe, expect, it } from 'vitest'
import { accessKeys, bookingKeys, notificationKeys, queueKeys } from '@/shared/data/keys'

/** Une invalidation par préfixe atteint la clé ssi le préfixe est un début exact. */
function prefixMatches(prefix: readonly unknown[], key: readonly unknown[]): boolean {
  return prefix.every((part, index) => JSON.stringify(part) === JSON.stringify(key[index]))
}

describe('fabriques de clés', () => {
  it('les listes et détails descendent du préfixe racine', () => {
    expect(prefixMatches(bookingKeys.all, bookingKeys.lists())).toBe(true)
    expect(prefixMatches(bookingKeys.all, bookingKeys.list({ scope: 'upcoming' }))).toBe(true)
    expect(prefixMatches(bookingKeys.all, bookingKeys.detail('abc'))).toBe(true)
    expect(prefixMatches(bookingKeys.lists(), bookingKeys.list({ scope: 'past' }))).toBe(true)
  })

  it('un détail n’est pas balayé par le préfixe des listes', () => {
    expect(prefixMatches(bookingKeys.lists(), bookingKeys.detail('abc'))).toBe(false)
  })

  it('les domaines ne se recouvrent pas', () => {
    expect(prefixMatches(bookingKeys.all, queueKeys.mine())).toBe(false)
    expect(prefixMatches(notificationKeys.all, accessKeys.me())).toBe(false)
  })

  it('des filtres différents produisent des clés différentes', () => {
    expect(JSON.stringify(bookingKeys.list({ scope: 'upcoming' }))).not.toBe(
      JSON.stringify(bookingKeys.list({ scope: 'past' })),
    )
  })
})
