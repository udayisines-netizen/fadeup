import { describe, expect, it } from 'vitest'
import { rankResults } from '@/features/discovery/lib/ranking'
import type { ProfessionalSearchRow, ResultAvailability } from '@/shared/data/discovery'

function row(locationId: string, distanceKm: number | null): ProfessionalSearchRow {
  return { location_id: locationId, distance_km: distanceKm, organization_name: locationId } as ProfessionalSearchRow
}

describe('rankResults — le classement client, modulaire et borné', () => {
  const availability: Record<string, ResultAvailability> = {
    a: 'closed',
    b: 'available-now',
    c: 'bookable',
    d: 'unknown',
  }

  it('sans point de recherche, en tri recommandé : la disponibilité réelle remonte, ordre serveur conservé au sein des groupes', () => {
    const ranked = rankResults([row('a', null), row('b', null), row('c', null), row('d', null)], availability, 'recommended', false)
    expect(ranked.map((r) => r.location_id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('avec un point de recherche : l’ordre serveur (distance) n’est JAMAIS réordonné', () => {
    const rows = [row('a', 0.4), row('b', 2.1), row('c', 5.0)]
    expect(rankResults(rows, availability, 'recommended', true)).toEqual(rows)
  })

  it('un tri explicite (prix, plus proche) n’est jamais réordonné', () => {
    const rows = [row('a', null), row('b', null)]
    expect(rankResults(rows, availability, 'price', false)).toEqual(rows)
    expect(rankResults(rows, availability, 'nearest', false)).toEqual(rows)
  })

  it('une rangée sans état connu se classe comme inconnue, jamais favorisée', () => {
    const ranked = rankResults([row('z', null), row('b', null)], availability, 'recommended', false)
    expect(ranked.map((r) => r.location_id)).toEqual(['b', 'z'])
  })
})
