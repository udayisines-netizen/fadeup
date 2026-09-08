import { describe, expect, it } from 'vitest'

import {
  cancelPlan,
  isActionable,
  isPendingRequest,
  partitionAppointments,
  resolutionLabelKey,
} from '@/features/booking/lib/partition'
import type { MyAppointment } from '@/features/booking/api/booking'

/**
 * La partition de « Mes réservations » (F4 §7, P1PRO §5) et les règles de
 * geste qui l'accompagnent. La règle est celle du web — ces cas la figent.
 */

const NOW = new Date('2026-09-08T10:00:00.000Z')
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString()

function appointment(patch: Partial<MyAppointment>): MyAppointment {
  return {
    id: patch.id ?? 'a1',
    organization_id: 'org-1',
    organization_name: 'Salon Test',
    organization_slug: 'salon-test',
    location_id: 'loc-1',
    location_name: 'Rue Test',
    barber_id: 'barber-1',
    barber_display_name: 'Amine',
    service_id: 'svc-1',
    service_name: 'Coupe',
    starts_at: hours(30),
    ends_at: hours(31),
    status: 'pending',
    price_cents: 2500,
    currency: 'EUR',
    location_timezone: 'Europe/Paris',
    resolution: null,
    resolution_note: null,
    expires_at: null,
    created_at: hours(-2),
    counter_proposed_at: null,
    counter_original_starts_at: null,
    counter_note: null,
    ...patch,
  }
}

describe('partitionAppointments', () => {
  it('range chaque ligne dans SA section', () => {
    const pendingRequest = appointment({ id: 'req', expires_at: hours(6) })
    const counter = appointment({
      id: 'counter',
      expires_at: hours(4),
      counter_proposed_at: hours(-1),
      counter_original_starts_at: hours(28),
    })
    const upcoming = appointment({ id: 'up', status: 'confirmed', starts_at: hours(48) })
    const past = appointment({ id: 'past', status: 'completed', starts_at: hours(-48) })

    const result = partitionAppointments([past, upcoming, counter, pendingRequest], NOW)

    expect(result.counters.map((r) => r.id)).toEqual(['counter'])
    expect(result.requests.map((r) => r.id)).toEqual(['req'])
    expect(result.upcoming.map((r) => r.id)).toEqual(['up'])
    expect(result.history.map((r) => r.id)).toEqual(['past'])
  })

  it('une contre-proposition EXPIRÉE retombe dans les demandes — plus rien à répondre', () => {
    const expiredCounter = appointment({
      id: 'stale-counter',
      expires_at: hours(-1),
      counter_proposed_at: hours(-6),
      counter_original_starts_at: hours(28),
    })
    const result = partitionAppointments([expiredCounter], NOW)
    expect(result.counters).toEqual([])
    expect(result.requests.map((r) => r.id)).toEqual(['stale-counter'])
    expect(result.history).toEqual([])
  })

  it('une contre-proposition SANS échéance reste une contre-proposition', () => {
    const counter = appointment({ id: 'c', expires_at: null, counter_proposed_at: hours(-1) })
    expect(partitionAppointments([counter], NOW).counters.map((r) => r.id)).toEqual(['c'])
  })

  it('une demande RÉSOLUE quitte les demandes pour l’historique', () => {
    const expiredRequest = appointment({ id: 'gone', status: 'pending', resolution: 'expired', expires_at: hours(-3) })
    const result = partitionAppointments([expiredRequest], NOW)
    expect(result.requests).toEqual([])
    expect(result.history.map((r) => r.id)).toEqual(['gone'])
  })

  it('un rendez-vous confirmé PASSÉ n’est plus « à venir »', () => {
    const done = appointment({ id: 'yesterday', status: 'confirmed', starts_at: hours(-24) })
    const result = partitionAppointments([done], NOW)
    expect(result.upcoming).toEqual([])
    expect(result.history.map((r) => r.id)).toEqual(['yesterday'])
  })

  it('trie : échéance croissante, horaire croissant, historique décroissant', () => {
    const rows = [
      appointment({ id: 'c-late', expires_at: hours(8), counter_proposed_at: hours(-1) }),
      appointment({ id: 'c-soon', expires_at: hours(2), counter_proposed_at: hours(-1) }),
      appointment({ id: 'r-late', starts_at: hours(72), expires_at: hours(9) }),
      appointment({ id: 'r-soon', starts_at: hours(20), expires_at: hours(5) }),
      appointment({ id: 'u-late', status: 'confirmed', starts_at: hours(96) }),
      appointment({ id: 'u-soon', status: 'confirmed', starts_at: hours(12) }),
      appointment({ id: 'h-old', status: 'completed', starts_at: hours(-200) }),
      appointment({ id: 'h-recent', status: 'completed', starts_at: hours(-10) }),
    ]
    const result = partitionAppointments(rows, NOW)
    expect(result.counters.map((r) => r.id)).toEqual(['c-soon', 'c-late'])
    expect(result.requests.map((r) => r.id)).toEqual(['r-soon', 'r-late'])
    expect(result.upcoming.map((r) => r.id)).toEqual(['u-soon', 'u-late'])
    expect(result.history.map((r) => r.id)).toEqual(['h-recent', 'h-old'])
  })
})

describe('resolutionLabelKey — l’historique dit CE QUI s’est passé', () => {
  it.each([
    ['declined', 'booking.bookings.resolutionDeclined'],
    ['expired', 'booking.bookings.resolutionExpired'],
    ['cancelled_by_customer', 'booking.bookings.resolutionCancelledByCustomer'],
    ['cancelled_by_business', 'booking.bookings.resolutionCancelledByBusiness'],
    ['rescheduled', 'booking.bookings.resolutionRescheduled'],
  ] as const)('%s → %s', (resolution, key) => {
    expect(resolutionLabelKey({ status: 'cancelled', resolution })).toBe(key)
  })

  it('sans résolution, le statut parle — et se tait quand il n’a rien à dire', () => {
    expect(resolutionLabelKey({ status: 'completed', resolution: null })).toBe('booking.bookings.statusCompleted')
    expect(resolutionLabelKey({ status: 'no_show', resolution: null })).toBe('booking.bookings.statusNoShow')
    expect(resolutionLabelKey({ status: 'confirmed', resolution: null })).toBeNull()
  })

  it('une demande expirée n’est NI un no-show NI un refus', () => {
    const key = resolutionLabelKey({ status: 'pending', resolution: 'expired' })
    expect(key).toBe('booking.bookings.resolutionExpired')
    expect(key).not.toBe('booking.bookings.statusNoShow')
    expect(key).not.toBe('booking.bookings.resolutionDeclined')
  })
})

describe('cancelPlan — le geste est dit AVANT d’être fait', () => {
  it('une demande se RETIRE, sans avertissement tardif : aucun créneau n’était tenu', () => {
    const plan = cancelPlan({ status: 'pending', resolution: null, starts_at: hours(2) }, NOW)
    expect(plan).toEqual({
      isRequest: true,
      actionKey: 'booking.bookings.cancelRequest',
      titleKey: 'booking.bookings.cancelRequestTitle',
      bodyKey: 'booking.bookings.cancelRequestBody',
      lateWarning: false,
    })
  })

  it('un rendez-vous à plus de 12 h s’annule librement', () => {
    const plan = cancelPlan({ status: 'confirmed', resolution: null, starts_at: hours(13) }, NOW)
    expect(plan.isRequest).toBe(false)
    expect(plan.actionKey).toBe('booking.bookings.cancel')
    expect(plan.lateWarning).toBe(false)
  })

  it('à moins de 12 h, l’annulation reste PERMISE mais dite tardive', () => {
    expect(cancelPlan({ status: 'confirmed', resolution: null, starts_at: hours(11.5) }, NOW).lateWarning).toBe(true)
    expect(cancelPlan({ status: 'confirmed', resolution: null, starts_at: hours(0.5) }, NOW).lateWarning).toBe(true)
  })
})

describe('isPendingRequest / isActionable', () => {
  it('une ligne pending non résolue EST une demande', () => {
    expect(isPendingRequest({ status: 'pending', resolution: null })).toBe(true)
    expect(isPendingRequest({ status: 'pending', resolution: 'expired' })).toBe(false)
    expect(isPendingRequest({ status: 'confirmed', resolution: null })).toBe(false)
  })

  it('rien n’est actionnable une fois résolu ou passé', () => {
    expect(isActionable({ status: 'confirmed', resolution: null, starts_at: hours(3) }, NOW)).toBe(true)
    expect(isActionable({ status: 'pending', resolution: null, starts_at: hours(3) }, NOW)).toBe(true)
    expect(isActionable({ status: 'confirmed', resolution: null, starts_at: hours(-3) }, NOW)).toBe(false)
    expect(isActionable({ status: 'pending', resolution: 'expired', starts_at: hours(3) }, NOW)).toBe(false)
    expect(isActionable({ status: 'completed', resolution: null, starts_at: hours(3) }, NOW)).toBe(false)
  })
})
