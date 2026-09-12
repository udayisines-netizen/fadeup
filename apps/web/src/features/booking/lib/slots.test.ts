import { describe, expect, it } from 'vitest'
import {
  BOOKING_WINDOW_DAYS,
  bookableDays,
  dateInTimezone,
  firstPopulatedPart,
  mergeSlotsAcrossBarbers,
  minutesSinceMidnight,
  partOfDayFor,
} from '@/features/booking/lib/slots'

describe('slots — dérivés purs, dans le fuseau du LIEU', () => {
  it('le moment de la journée se juge dans le fuseau du lieu, pas de l’appareil', () => {
    // 23:00 UTC = 08:00 à Tokyo le lendemain — c'est le MATIN de Tokyo…
    expect(partOfDayFor('2026-09-07T23:00:00Z', 'Asia/Tokyo')).toBe('morning')
    // …et 01:00 à Paris (UTC+2 en septembre) : le matin aussi, pas le soir UTC.
    expect(partOfDayFor('2026-09-07T23:00:00Z', 'Europe/Paris')).toBe('morning')
    expect(partOfDayFor('2026-09-07T17:00:00Z', 'Europe/Paris')).toBe('evening')
    expect(minutesSinceMidnight('2026-09-07T10:30:00Z', 'UTC')).toBe(630)
  })

  it('midi et 17 h coupent matin / après-midi / soir', () => {
    expect(partOfDayFor('2026-09-07T11:59:00Z', 'UTC')).toBe('morning')
    expect(partOfDayFor('2026-09-07T12:00:00Z', 'UTC')).toBe('afternoon')
    expect(partOfDayFor('2026-09-07T17:00:00Z', 'UTC')).toBe('evening')
  })

  it('l’écran ne s’ouvre jamais sur un onglet vide', () => {
    const slots = [{ slot_start: '2026-09-07T18:00:00Z', slot_end: '2026-09-07T18:30:00Z' }]
    expect(firstPopulatedPart(slots, 'UTC')).toBe('evening')
    expect(firstPopulatedPart([], 'UTC')).toBe('morning')
  })

  it('« premier disponible » = UNION des créneaux réels, un horaire → le premier barber qui l’offre', () => {
    const merged = mergeSlotsAcrossBarbers([
      {
        barberId: 'amine',
        slots: [
          { slot_start: '2026-09-07T10:00:00Z', slot_end: '2026-09-07T10:30:00Z' },
          { slot_start: '2026-09-07T11:00:00Z', slot_end: '2026-09-07T11:30:00Z' },
        ],
      },
      {
        barberId: 'karim',
        slots: [
          { slot_start: '2026-09-07T10:00:00Z', slot_end: '2026-09-07T10:30:00Z' },
          { slot_start: '2026-09-07T09:00:00Z', slot_end: '2026-09-07T09:30:00Z' },
        ],
      },
    ])
    expect(merged.map((slot) => slot.slot_start)).toEqual([
      '2026-09-07T09:00:00Z',
      '2026-09-07T10:00:00Z',
      '2026-09-07T11:00:00Z',
    ])
    // 10:00 est offert par les deux : porté par le PREMIER de la liste.
    expect(merged[1]?.barber_id).toBe('amine')
    expect(merged[0]?.barber_id).toBe('karim')
  })

  it('rien n’est fabriqué : zéro entrée → zéro créneau', () => {
    expect(mergeSlotsAcrossBarbers([])).toEqual([])
    expect(mergeSlotsAcrossBarbers([{ barberId: 'a', slots: [] }])).toEqual([])
  })

  it('la fenêtre couvre aujourd’hui + 90 jours, en AAAA-MM-JJ du fuseau du lieu', () => {
    const now = new Date('2026-09-07T12:00:00Z')
    const days = bookableDays('Europe/Paris', now)
    expect(days).toHaveLength(BOOKING_WINDOW_DAYS + 1)
    expect(days[0]).toBe('2026-09-07')
    expect(days.at(-1)).toBe('2026-12-06')
    // À 23:30 UTC, Paris est déjà le lendemain — le « jour 0 » aussi.
    expect(dateInTimezone(new Date('2026-09-07T23:30:00Z'), 'Europe/Paris')).toBe('2026-09-08')
  })

  // PLAT-3 — la fenêtre vient du réglage plateforme, et le serveur REFUSE
  // au-delà (`fadeup_booking_refusal=beyond_booking_window`). Le sélecteur ne
  // doit donc jamais proposer plus loin que ce qu'on lui donne.
  it('la fenêtre suit le réglage plateforme quand il est fourni', () => {
    const now = new Date('2026-09-07T12:00:00Z')
    const days = bookableDays('Europe/Paris', now, 7)
    expect(days).toHaveLength(8)
    expect(days[0]).toBe('2026-09-07')
    expect(days.at(-1)).toBe('2026-09-14')
  })

  it('sans réglage, elle reste à 90 jours — le repli est le comportement d’avant', () => {
    const now = new Date('2026-09-07T12:00:00Z')
    expect(bookableDays('Europe/Paris', now)).toEqual(bookableDays('Europe/Paris', now, BOOKING_WINDOW_DAYS))
  })

  it('une fenêtre absurde ne casse rien : zéro jour rend le jour même', () => {
    const now = new Date('2026-09-07T12:00:00Z')
    expect(bookableDays('Europe/Paris', now, 0)).toEqual(['2026-09-07'])
    expect(bookableDays('Europe/Paris', now, -5)).toEqual(['2026-09-07'])
  })
})
