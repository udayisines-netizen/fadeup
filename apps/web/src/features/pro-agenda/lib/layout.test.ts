import { describe, expect, it } from 'vitest'
import {
  assignLanes,
  blockedInterval,
  durationMinutes,
  findConflicts,
  positionInDay,
  visibleHourRange,
  type AgendaAppointment,
  type AgendaTimeBlock,
} from './layout'
import { zonedDayStart } from './time'

function appt(partial: Partial<AgendaAppointment> & Pick<AgendaAppointment, 'id' | 'starts_at' | 'ends_at'>): AgendaAppointment {
  return {
    status: 'confirmed',
    barber_id: 'b1',
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
    overlap_forced_at: null,
    ...partial,
  }
}

describe('OS-1 layout — positionnement', () => {
  const tz = 'Europe/Paris'
  const day = '2026-09-11'
  const dayStart = zonedDayStart(day, tz)

  it('place un rendez-vous à la bonne hauteur (96 px/h, fenêtre 8–20 h)', () => {
    const p = positionInDay(new Date('2026-09-11T08:00:00Z'), new Date('2026-09-11T08:30:00Z'), tz, 8, 20, 96, dayStart)
    // 10:00 local → 2 h après 8 h → 192 px ; 30 min → 48 px.
    expect(p).toEqual({ top: 192, height: 48 })
  })

  it('tronque aux bords de la fenêtre sans jamais devenir négatif', () => {
    const early = positionInDay(new Date('2026-09-11T04:00:00Z'), new Date('2026-09-11T06:30:00Z'), tz, 8, 20, 96, dayStart)
    expect(early).toEqual({ top: 0, height: 48 }) // 06:00–08:30 local → seule la demi-heure après 8 h
    const late = positionInDay(new Date('2026-09-11T17:30:00Z'), new Date('2026-09-11T19:00:00Z'), tz, 8, 20, 96, dayStart)
    expect(late).toEqual({ top: 11 * 96 + 48, height: 48 }) // 19:30–21:00 → jusqu'à 20 h
  })

  it('une plage commencée la veille se dessine depuis minuit', () => {
    const p = positionInDay(new Date('2026-09-10T20:00:00Z'), new Date('2026-09-11T07:00:00Z'), tz, 0, 24, 60, dayStart)
    expect(p).toEqual({ top: 0, height: 9 * 60 })
  })
})

describe('OS-1 layout — couloirs', () => {
  it('sépare les objets qui se chevauchent et laisse seuls ceux qui ne se touchent pas', () => {
    const items = [
      { id: 'a', start: 0, end: 30 },
      { id: 'b', start: 15, end: 45 }, // chevauche a
      { id: 'c', start: 45, end: 60 }, // touche b sans chevaucher
      { id: 'd', start: 120, end: 150 },
    ]
    const laned = assignLanes(items, (i) => i)
    const byId = Object.fromEntries(laned.map((l) => [l.item.id, l]))
    expect(byId.a).toMatchObject({ lane: 0, lanes: 2 })
    expect(byId.b).toMatchObject({ lane: 1, lanes: 2 })
    expect(byId.c).toMatchObject({ lane: 0, lanes: 1 })
    expect(byId.d).toMatchObject({ lane: 0, lanes: 1 })
  })

  it('trois chevauchements = trois couloirs', () => {
    const items = [
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 10, end: 50 },
      { id: 'c', start: 20, end: 40 },
    ]
    const laned = assignLanes(items, (i) => i)
    expect(new Set(laned.map((l) => l.lane)).size).toBe(3)
    expect(laned.every((l) => l.lanes === 3)).toBe(true)
  })
})

describe('OS-1 layout — détection de conflit (même règle que le serveur)', () => {
  const existing: AgendaAppointment[] = [
    appt({ id: 'k1', starts_at: '2026-09-11T08:00:00Z', ends_at: '2026-09-11T08:30:00Z' }),
    appt({ id: 'k2', starts_at: '2026-09-11T09:00:00Z', ends_at: '2026-09-11T09:30:00Z', status: 'completed' }),
    appt({ id: 'k3', starts_at: '2026-09-11T10:00:00Z', ends_at: '2026-09-11T10:30:00Z', status: 'cancelled' }),
    appt({ id: 'k4', starts_at: '2026-09-11T11:00:00Z', ends_at: '2026-09-11T11:30:00Z', status: 'no_show' }),
    appt({ id: 'k5', starts_at: '2026-09-11T12:00:00Z', ends_at: '2026-09-11T12:30:00Z', buffer_after_minutes: 15 }),
    appt({ id: 'other', starts_at: '2026-09-11T08:00:00Z', ends_at: '2026-09-11T08:30:00Z', barber_id: 'b2' }),
  ]
  const blocks: AgendaTimeBlock[] = [{ id: 't1', barber_id: 'b1', starts_at: '2026-09-11T13:00:00Z', ends_at: '2026-09-11T14:00:00Z' }]

  const candidate = (iso: string, minutes = 30, barberId = 'b1', excludeId?: string) => ({
    excludeId,
    barberId,
    starts: new Date(iso),
    ends: new Date(Date.parse(iso) + minutes * 60_000),
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
  })

  it('un chevauchement partiel avec un rendez-vous actif est un conflit', () => {
    const report = findConflicts(candidate('2026-09-11T08:15:00Z'), existing, blocks)
    expect(report.appointments.map((a) => a.id)).toEqual(['k1'])
    expect(report.any).toBe(true)
  })

  it('les bords qui se touchent ne sont pas un conflit', () => {
    expect(findConflicts(candidate('2026-09-11T08:30:00Z'), existing, blocks).any).toBe(false)
  })

  it('une prestation terminée RETIENT son créneau ; annulée ou absente le libère', () => {
    expect(findConflicts(candidate('2026-09-11T09:00:00Z'), existing, blocks).appointments.map((a) => a.id)).toEqual(['k2'])
    expect(findConflicts(candidate('2026-09-11T10:00:00Z'), existing, blocks).any).toBe(false)
    expect(findConflicts(candidate('2026-09-11T11:00:00Z'), existing, blocks).any).toBe(false)
  })

  it('les tampons comptent, comme la plage bloquée de la contrainte', () => {
    // k5 finit 12:30 + 15 min de tampon = 12:45 → 12:40 est en conflit, 12:45 non.
    expect(findConflicts(candidate('2026-09-11T12:40:00Z'), existing, blocks).appointments.map((a) => a.id)).toEqual(['k5'])
    // 12:45–13:15 ne touche plus k5 (mais croise le blocage t1 : testé plus bas).
    expect(findConflicts(candidate('2026-09-11T12:45:00Z'), existing, blocks).appointments).toEqual([])
    expect(blockedInterval(existing[4]!)).toEqual({
      start: Date.parse('2026-09-11T12:00:00Z'),
      end: Date.parse('2026-09-11T12:45:00Z'),
    })
  })

  it('un autre barber n’est jamais en conflit ; soi-même est exclu quand on se déplace', () => {
    expect(findConflicts(candidate('2026-09-11T08:00:00Z', 30, 'b3'), existing, blocks).any).toBe(false)
    expect(findConflicts(candidate('2026-09-11T08:00:00Z', 30, 'b1', 'k1'), existing, blocks).any).toBe(false)
  })

  it('un blocage de temps est un conflit distinct (sans tampons)', () => {
    const report = findConflicts(candidate('2026-09-11T13:30:00Z'), existing, blocks)
    expect(report.appointments).toEqual([])
    expect(report.blocks.map((b) => b.id)).toEqual(['t1'])
    expect(report.any).toBe(true)
  })
})

describe('OS-1 layout — fenêtre d’heures et durées', () => {
  it('garde 8–20 h par défaut et s’élargit à l’heure pleine pour englober', () => {
    expect(visibleHourRange([])).toEqual({ start: 8, end: 20 })
    expect(visibleHourRange([{ startMinutes: 7 * 60 + 30, endMinutes: 8 * 60 }])).toEqual({ start: 7, end: 20 })
    expect(visibleHourRange([{ startMinutes: 19 * 60, endMinutes: 21 * 60 + 15 }])).toEqual({ start: 8, end: 22 })
  })

  it('durationMinutes arrondit à la minute', () => {
    expect(durationMinutes('2026-09-11T08:00:00Z', '2026-09-11T08:45:00Z')).toBe(45)
  })
})
