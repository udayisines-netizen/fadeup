import { describe, expect, it } from 'vitest'
import {
  formatWallTime,
  isOpenNow,
  orderedWeek,
  wallClockIn,
  type PublicLocationHoursRow,
} from '@/shared/lib/openingHours'

function day(dayOfWeek: number, overrides: Partial<PublicLocationHoursRow> = {}): PublicLocationHoursRow {
  return {
    day_of_week: dayOfWeek,
    is_closed: false,
    open_time: '10:00:00',
    close_time: '20:00:00',
    second_open_time: null,
    second_close_time: null,
    ...overrides,
  }
}

// Le mardi 8 septembre 2026 à 12:00 UTC = 14:00 à Paris (été, UTC+2).
const TUESDAY_NOON_UTC = new Date('2026-09-08T12:00:00Z')

describe('openingHours — l’état se calcule dans le fuseau du LIEU', () => {
  it('ouvert : 14:00 heure de Paris tombe dans 10:00–20:00 du mardi', () => {
    expect(isOpenNow([day(2)], 'Europe/Paris', TUESDAY_NOON_UTC)).toBe(true)
  })

  it('le fuseau du lieu prime sur l’instant UTC : fermé à Tokyo (21:00)', () => {
    expect(isOpenNow([day(2, { close_time: '20:00:00' })], 'Asia/Tokyo', TUESDAY_NOON_UTC)).toBe(false)
  })

  it('jour marqué fermé => fermé, quelles que soient les heures', () => {
    expect(isOpenNow([day(2, { is_closed: true })], 'Europe/Paris', TUESDAY_NOON_UTC)).toBe(false)
  })

  it('le second intervalle (coupure du midi) compte', () => {
    const split = day(2, {
      open_time: '09:00:00',
      close_time: '12:00:00',
      second_open_time: '14:00:00',
      second_close_time: '19:00:00',
    })
    expect(isOpenNow([split], 'Europe/Paris', TUESDAY_NOON_UTC)).toBe(true)
    expect(isOpenNow([split], 'Europe/Paris', new Date('2026-09-08T11:00:00Z'))).toBe(false)
  })

  it('aucune ligne pour ce jour => null : AUCUN état inventé', () => {
    expect(isOpenNow([day(3)], 'Europe/Paris', TUESDAY_NOON_UTC)).toBeNull()
    expect(isOpenNow([], 'Europe/Paris', TUESDAY_NOON_UTC)).toBeNull()
  })

  it('fuseau invalide => null, pas une devinette', () => {
    expect(isOpenNow([day(2)], 'Not/AZone', TUESDAY_NOON_UTC)).toBeNull()
  })

  it('wallClockIn rend le bon jour (0 = dimanche)', () => {
    expect(wallClockIn('Europe/Paris', TUESDAY_NOON_UTC)?.day).toBe(2)
    expect(wallClockIn('Europe/Paris', new Date('2026-09-06T12:00:00Z'))?.day).toBe(0)
  })

  it('formatWallTime localise sans inventer de secondes', () => {
    expect(formatWallTime('09:30:00', 'fr')).toMatch(/0?9[:h]30/)
    expect(formatWallTime('09:30:00', 'en')).toMatch(/9:30/)
  })

  it('orderedWeek commence lundi et finit dimanche', () => {
    const week = orderedWeek([0, 1, 2, 3, 4, 5, 6].map((d) => day(d)))
    expect(week.map((entry) => entry.day)).toEqual([1, 2, 3, 4, 5, 6, 0])
  })

  it('orderedWeek rend TOUJOURS 7 jours — un jour absent est null, pas « fermé »', () => {
    const week = orderedWeek([day(2), day(5)])
    expect(week).toHaveLength(7)
    expect(week.find((entry) => entry.day === 2)?.row).not.toBeNull()
    expect(week.find((entry) => entry.day === 3)?.row).toBeNull()
  })
})
