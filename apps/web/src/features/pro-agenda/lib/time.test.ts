import { describe, expect, it } from 'vitest'
import {
  addDays,
  dayKeyInZone,
  instantAt,
  minutesOfDayInZone,
  snapMinutes,
  weekOf,
  weekdayOf,
  zonedDayStart,
} from './time'

describe('OS-1 time — fuseau du lieu', () => {
  it('lit la clé de jour et les minutes locales dans le fuseau du lieu, pas de l’appareil', () => {
    // 2026-07-01T22:30Z = 2026-07-02 00:30 à Paris (UTC+2), 2026-07-01 22:30 à Londres (UTC+1 → 23:30).
    const instant = new Date('2026-07-01T22:30:00Z')
    expect(dayKeyInZone(instant, 'Europe/Paris')).toBe('2026-07-02')
    expect(minutesOfDayInZone(instant, 'Europe/Paris')).toBe(30)
    expect(dayKeyInZone(instant, 'UTC')).toBe('2026-07-01')
    expect(minutesOfDayInZone(instant, 'UTC')).toBe(22 * 60 + 30)
  })

  it('minuit local d’un jour est un instant exact, y compris en heure d’été', () => {
    expect(zonedDayStart('2026-07-02', 'Europe/Paris').toISOString()).toBe('2026-07-01T22:00:00.000Z')
    expect(zonedDayStart('2026-01-15', 'Europe/Paris').toISOString()).toBe('2026-01-14T23:00:00.000Z')
    expect(zonedDayStart('2026-01-15', 'UTC').toISOString()).toBe('2026-01-15T00:00:00.000Z')
  })

  it('instantAt reconstruit une heure locale', () => {
    expect(instantAt('2026-07-02', 10 * 60 + 15, 'Europe/Paris').toISOString()).toBe('2026-07-02T08:15:00.000Z')
    expect(minutesOfDayInZone(instantAt('2026-03-29', 9 * 60, 'Europe/Paris'), 'Europe/Paris')).toBe(9 * 60)
  })

  it('addDays et weekOf raisonnent en jours civils, lundi en tête', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(weekdayOf('2026-09-11')).toBe(5) // vendredi
    expect(weekOf('2026-09-11')).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ])
    expect(weekOf('2026-09-13')[0]).toBe('2026-09-07') // dimanche appartient à la semaine du lundi 7
  })

  it('snapMinutes arrondit au pas', () => {
    expect(snapMinutes(0)).toBe(0)
    expect(snapMinutes(12)).toBe(10)
    expect(snapMinutes(13)).toBe(15)
    expect(snapMinutes(37, 15)).toBe(30)
    expect(snapMinutes(38, 15)).toBe(45)
  })
})
