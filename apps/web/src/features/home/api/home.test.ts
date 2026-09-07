import { describe, expect, it } from 'vitest'
import {
  activeQueueEntry,
  lastCompletedAppointment,
  nextAppointment,
  type MyAppointmentRow,
  type MyQueueStatusRow,
} from '@/features/home/api/home'

const NOW = new Date('2026-09-07T12:00:00Z')

function appointment(partial: Partial<MyAppointmentRow>): MyAppointmentRow {
  return { starts_at: '2026-09-08T10:00:00Z', status: 'confirmed', ...partial } as MyAppointmentRow
}

describe('nextAppointment — le prochain rendez-vous réel', () => {
  it('le plus proche dans le futur, confirmé ou en attente', () => {
    const next = nextAppointment(
      [
        appointment({ id: 'far', starts_at: '2026-09-10T10:00:00Z' }),
        appointment({ id: 'soon', starts_at: '2026-09-07T14:00:00Z', status: 'pending' }),
      ],
      NOW,
    )
    expect(next?.id).toBe('soon')
  })

  it('un rendez-vous passé, annulé ou honoré n’est jamais « prochain »', () => {
    expect(
      nextAppointment(
        [
          appointment({ starts_at: '2026-09-07T09:00:00Z' }),
          appointment({ status: 'cancelled' }),
          appointment({ status: 'completed', starts_at: '2026-09-09T10:00:00Z' }),
          appointment({ status: 'no_show', starts_at: '2026-09-09T10:00:00Z' }),
        ],
        NOW,
      ),
    ).toBeNull()
  })

  it('aucune donnée : null — la section ne se rend pas, rien d’inventé', () => {
    expect(nextAppointment(undefined, NOW)).toBeNull()
    expect(nextAppointment([], NOW)).toBeNull()
  })
})

describe('lastCompletedAppointment — la graine de « réserver à nouveau »', () => {
  it('le plus récent des rendez-vous HONORÉS uniquement', () => {
    const last = lastCompletedAppointment([
      appointment({ id: 'old', status: 'completed', starts_at: '2026-08-01T10:00:00Z' }),
      appointment({ id: 'recent', status: 'completed', starts_at: '2026-09-01T10:00:00Z' }),
      appointment({ id: 'noshow', status: 'no_show', starts_at: '2026-09-05T10:00:00Z' }),
    ])
    expect(last?.id).toBe('recent')
  })

  it('sans historique honoré : null', () => {
    expect(lastCompletedAppointment([appointment({ status: 'cancelled' })])).toBeNull()
    expect(lastCompletedAppointment(undefined)).toBeNull()
  })
})

describe('activeQueueEntry — la file active', () => {
  function entry(status: MyQueueStatusRow['status']): MyQueueStatusRow {
    return { status } as MyQueueStatusRow
  }

  it('waiting, called et in_service sont actifs ; les états terminaux non', () => {
    expect(activeQueueEntry([entry('completed'), entry('called')])?.status).toBe('called')
    expect(activeQueueEntry([entry('cancelled'), entry('no_show')])).toBeNull()
    expect(activeQueueEntry(undefined)).toBeNull()
  })
})
