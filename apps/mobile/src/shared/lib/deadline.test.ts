import { describe, expect, it } from 'vitest'
import { isExpired, isLateCancellation, remainingMs, remainingParts } from '@/shared/lib/deadline'

const NOW = new Date('2026-09-07T12:00:00Z')

describe('deadline — l’échéance est lue, jamais recalculée, jamais négative', () => {
  it('le temps restant ne descend JAMAIS sous zéro', () => {
    expect(remainingMs('2026-09-07T11:00:00Z', NOW)).toBe(0)
    expect(remainingMs('2026-09-07T12:00:00Z', NOW)).toBe(0)
    expect(remainingMs('2026-09-07T13:00:00Z', NOW)).toBe(3_600_000)
  })

  it('une échéance passée rend null — l’écran dit « expiré », pas « -3 min »', () => {
    expect(remainingParts('2026-09-07T11:59:00Z', NOW)).toBeNull()
    expect(isExpired('2026-09-07T11:59:00Z', NOW)).toBe(true)
    expect(isExpired('2026-09-07T12:01:00Z', NOW)).toBe(false)
  })

  it('découpe en heures et minutes, arrondi à la minute SUPÉRIEURE (jamais « 0 min » restant)', () => {
    expect(remainingParts('2026-09-07T14:30:00Z', NOW)).toEqual({ hours: 2, minutes: 30 })
    expect(remainingParts('2026-09-07T12:00:30Z', NOW)).toEqual({ hours: 0, minutes: 1 })
    expect(remainingParts('2026-09-08T12:00:00Z', NOW)).toEqual({ hours: 24, minutes: 0 })
  })

  it('une valeur illisible vaut zéro, pas NaN', () => {
    expect(remainingMs('pas-une-date', NOW)).toBe(0)
    expect(remainingParts('pas-une-date', NOW)).toBeNull()
  })

  it('annulation libre jusqu’à 12 h avant ; plus près, elle est TARDIVE (pas interdite)', () => {
    expect(isLateCancellation('2026-09-08T01:00:00Z', NOW)).toBe(false) // 13 h avant
    expect(isLateCancellation('2026-09-07T23:59:00Z', NOW)).toBe(true) // 11 h 59 avant
    expect(isLateCancellation('2026-09-07T11:00:00Z', NOW)).toBe(true) // déjà passé
  })
})
