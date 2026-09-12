import { describe, expect, it } from 'vitest'
import { invitationExpiry } from '@/features/pro-team/lib/invitations'

const NOW = Date.parse('2026-09-11T12:00:00.000Z')
const inDays = (days: number) => new Date(NOW + days * 24 * 60 * 60 * 1000).toISOString()

describe('invitationExpiry — 0 jour n’est pas « expirée »', () => {
  it('compte les jours PLEINS restants', () => {
    expect(invitationExpiry(inDays(7), NOW)).toEqual({ expired: false, days: 7 })
    expect(invitationExpiry(inDays(6.5), NOW)).toEqual({ expired: false, days: 6 })
    expect(invitationExpiry(inDays(1), NOW)).toEqual({ expired: false, days: 1 })
  })

  it('moins de 24 h restantes : zéro jour, toujours valide', () => {
    const result = invitationExpiry(new Date(NOW + 3 * 60 * 60 * 1000), NOW)
    expect(result.expired).toBe(false)
    expect(result.days).toBe(0)
  })

  it('l’échéance atteinte ou passée est expirée', () => {
    expect(invitationExpiry(new Date(NOW), NOW)).toEqual({ expired: true, days: 0 })
    expect(invitationExpiry(inDays(-2), NOW)).toEqual({ expired: true, days: 0 })
  })

  it('une date absente ou illisible n’invente pas un état expiré', () => {
    expect(invitationExpiry(null, NOW)).toEqual({ expired: false, days: 0 })
    expect(invitationExpiry('pas-une-date', NOW)).toEqual({ expired: false, days: 0 })
  })

  it('accepte un Date comme horloge', () => {
    expect(invitationExpiry(inDays(3), new Date(NOW))).toEqual({ expired: false, days: 3 })
  })
})
