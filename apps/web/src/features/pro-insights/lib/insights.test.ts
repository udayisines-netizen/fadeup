import { describe, expect, it } from 'vitest'
import {
  conversionRate,
  DURATION_SAMPLE_FLOOR,
  durationVerdict,
  hasMoney,
  hasNoHistory,
  trendFor,
  viewsArePartial,
  windowBounds,
} from '@/features/pro-insights/lib/insights'

describe('trendFor — une tendance n’existe que quand elle existe', () => {
  it('ne rend RIEN quand le serveur refuse la comparaison', () => {
    expect(trendFor(40, 10, false)).toBeNull()
  })

  it('ne rend rien sur deux zéros — « 0 contre 0 » n’est pas une tendance', () => {
    expect(trendFor(0, 0, true)).toBeNull()
  })

  it('ne rend rien quand une des deux valeurs est absente (null ≠ 0)', () => {
    expect(trendFor(null, 10, true)).toBeNull()
    expect(trendFor(10, null, true)).toBeNull()
  })

  it('rend la direction mais AUCUN pourcentage quand la base est nulle', () => {
    expect(trendFor(4, 0, true)).toEqual({ direction: 'up', percent: null, previous: 0 })
  })

  it('calcule la hausse et la baisse en points entiers', () => {
    expect(trendFor(12, 10, true)).toEqual({ direction: 'up', percent: 20, previous: 10 })
    expect(trendFor(8, 10, true)).toEqual({ direction: 'down', percent: 20, previous: 10 })
  })

  it('arrondit, et une valeur identique est « stable » à 0 %', () => {
    expect(trendFor(10, 3, true)).toEqual({ direction: 'up', percent: 233, previous: 3 })
    expect(trendFor(7, 7, true)).toEqual({ direction: 'flat', percent: 0, previous: 7 })
  })

  it('traite un revenu masqué (null) comme absent, pas comme une chute', () => {
    expect(trendFor(null, 250_00, true)).toBeNull()
  })
})

describe('conversionRate', () => {
  it('n’existe pas sans demande reçue', () => {
    expect(conversionRate(0, 0)).toBeNull()
    expect(conversionRate(3, 0)).toBeNull()
    expect(conversionRate(null, 5)).toBeNull()
  })

  it('rend un pourcentage entier', () => {
    expect(conversionRate(3, 4)).toBe(75)
    expect(conversionRate(1, 3)).toBe(33)
    expect(conversionRate(0, 4)).toBe(0)
  })
})

describe('durationVerdict — pas assez de données est un VERDICT', () => {
  it('refuse de comparer sous cinq mesures', () => {
    expect(DURATION_SAMPLE_FLOOR).toBe(5)
    expect(durationVerdict(30, 27, 4)).toEqual({ kind: 'not-enough', samples: 4 })
    expect(durationVerdict(30, 27, 0)).toEqual({ kind: 'not-enough', samples: 0 })
  })

  it('refuse de comparer sans durée observée ou sans durée annoncée', () => {
    expect(durationVerdict(30, null, 40)).toEqual({ kind: 'not-enough', samples: 40 })
    expect(durationVerdict(null, 27, 40)).toEqual({ kind: 'not-enough', samples: 40 })
  })

  it('dit « conforme » quand l’écart arrondi est nul', () => {
    expect(durationVerdict(30, 30.4, 34)).toEqual({ kind: 'aligned', declared: 30, observed: 30, samples: 34 })
  })

  it('dit l’écart, son sens et sa taille', () => {
    expect(durationVerdict(30, 27, 34)).toEqual({
      kind: 'gap',
      declared: 30,
      observed: 27,
      samples: 34,
      deltaMinutes: 3,
      over: false,
    })
    expect(durationVerdict(30, 36.6, 12)).toEqual({
      kind: 'gap',
      declared: 30,
      observed: 37,
      samples: 12,
      deltaMinutes: 7,
      over: true,
    })
  })
})

describe('hasMoney — un montant masqué n’est pas un zéro', () => {
  it('accepte zéro et refuse null/undefined', () => {
    expect(hasMoney(0)).toBe(true)
    expect(hasMoney(1250)).toBe(true)
    expect(hasMoney(null)).toBe(false)
    expect(hasMoney(undefined)).toBe(false)
  })
})

describe('hasNoHistory', () => {
  it('distingue « aucune activité connue » de « zéro cette période »', () => {
    expect(hasNoHistory(null)).toBe(true)
    expect(hasNoHistory('2026-01-01T00:00:00.000Z')).toBe(false)
  })
})

describe('viewsArePartial', () => {
  it('signale un sous-compte quand l’instrumentation commence dans la fenêtre', () => {
    expect(viewsArePartial('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')).toBe(true)
  })

  it('ne signale rien quand l’instrumentation précède la fenêtre', () => {
    expect(viewsArePartial('2026-03-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')).toBe(false)
  })

  it('ne signale rien quand aucun événement n’existe : il n’y a pas de sous-compte à annoncer', () => {
    expect(viewsArePartial('2026-03-01T00:00:00.000Z', null)).toBe(false)
  })
})

describe('windowBounds', () => {
  const now = new Date('2026-09-12T10:00:00.000Z')

  it('borne 30 jours, 90 jours et 12 mois', () => {
    expect(windowBounds('30d', now).from).toBe('2026-08-13T10:01:00.000Z')
    expect(windowBounds('90d', now).from).toBe('2026-06-14T10:01:00.000Z')
    expect(windowBounds('12m', now).from).toBe('2025-09-12T10:01:00.000Z')
  })

  it('pousse la borne haute d’une minute : le serveur exclut la borne', () => {
    expect(windowBounds('30d', now).to).toBe('2026-09-12T10:01:00.000Z')
  })
})
