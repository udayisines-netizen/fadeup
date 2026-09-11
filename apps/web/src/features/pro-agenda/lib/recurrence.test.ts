import { describe, expect, it } from 'vitest'
import { MAX_SERIES_OCCURRENCES, expandWeekly } from './recurrence'

describe('OS-1 recurrence — série hebdomadaire matérialisée', () => {
  it('produit une occurrence par semaine jusqu’à la date incluse, à la même heure locale', () => {
    const out = expandWeekly({
      starts: new Date('2026-10-19T10:00:00Z'), // lundi 12:00 Paris (UTC+2)
      ends: new Date('2026-10-19T11:00:00Z'),
      timezone: 'Europe/Paris',
      untilDay: '2026-11-02',
    })
    expect(out.map((o) => o.starts_at)).toEqual([
      '2026-10-19T10:00:00.000Z',
      '2026-10-26T11:00:00.000Z', // heure d'hiver : toujours 12:00 local
      '2026-11-02T11:00:00.000Z',
    ])
    expect(out.every((o) => Date.parse(o.ends_at) - Date.parse(o.starts_at) === 3_600_000)).toBe(true)
  })

  it('une seule occurrence quand la date de fin est le jour même ; aucune pour une plage invalide', () => {
    expect(
      expandWeekly({ starts: new Date('2026-10-19T10:00:00Z'), ends: new Date('2026-10-19T11:00:00Z'), timezone: 'UTC', untilDay: '2026-10-19' }),
    ).toHaveLength(1)
    expect(
      expandWeekly({ starts: new Date('2026-10-19T11:00:00Z'), ends: new Date('2026-10-19T10:00:00Z'), timezone: 'UTC', untilDay: '2026-12-19' }),
    ).toHaveLength(0)
  })

  it('plafonne à 52 occurrences', () => {
    const out = expandWeekly({ starts: new Date('2026-01-05T09:00:00Z'), ends: new Date('2026-01-05T10:00:00Z'), timezone: 'UTC', untilDay: '2030-01-01' })
    expect(out).toHaveLength(MAX_SERIES_OCCURRENCES)
  })
})
