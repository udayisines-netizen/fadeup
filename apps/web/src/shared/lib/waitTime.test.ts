import { describe, expect, it } from 'vitest'
import { elapsedWaitMinutes, formatEstimatedWait } from '@/shared/lib/waitTime'

describe('formatEstimatedWait — jamais un temps inventé', () => {
  it('null / undefined = RIEN à afficher (le cas « pas de temps fiable »)', () => {
    expect(formatEstimatedWait(null)).toBeNull()
    expect(formatEstimatedWait(undefined)).toBeNull()
  })

  it('rejette les valeurs non exploitables au lieu de les maquiller', () => {
    expect(formatEstimatedWait(Number.NaN)).toBeNull()
    expect(formatEstimatedWait(Number.POSITIVE_INFINITY)).toBeNull()
    expect(formatEstimatedWait(-3)).toBeNull()
  })

  it('arrondit au pas de CINQ minutes, vers le haut (F1b §3)', () => {
    expect(formatEstimatedWait(1)).toEqual({ minutes: 5 })
    expect(formatEstimatedWait(12.4)).toEqual({ minutes: 15 })
    expect(formatEstimatedWait(15)).toEqual({ minutes: 15 })
    expect(formatEstimatedWait(16)).toEqual({ minutes: 20 })
  })

  it('zéro reste zéro : une file vide est « sans attente », pas « 5 min »', () => {
    expect(formatEstimatedWait(0)).toEqual({ minutes: 0 })
  })
})

describe('elapsedWaitMinutes — une mesure, pas une estimation', () => {
  it('mesure les minutes écoulées depuis created_at', () => {
    const now = new Date('2026-09-07T12:30:00Z')
    expect(elapsedWaitMinutes('2026-09-07T12:00:00Z', now)).toBe(30)
    expect(elapsedWaitMinutes('2026-09-07T12:29:10Z', now)).toBe(0)
  })

  it('ne devient jamais négative (horloges désynchronisées)', () => {
    const now = new Date('2026-09-07T12:00:00Z')
    expect(elapsedWaitMinutes('2026-09-07T12:05:00Z', now)).toBe(0)
  })

  it('une date illisible vaut zéro, pas NaN', () => {
    expect(elapsedWaitMinutes('not-a-date')).toBe(0)
  })
})
