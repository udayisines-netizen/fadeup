/**
 * M1b — la partition de « Mes réservations » et les règles de geste qui
 * l'accompagnent, en logique PURE (l'écran ne fait que rendre).
 *
 * La règle est celle du web (MyBookingsPage.tsx:48-71), reprise à
 * l'identique — pas « équivalente », identique :
 *
 *  - `pending` + `resolution` nulle → c'est une DEMANDE ;
 *      · avec `counter_proposed_at` non nul ET l'échéance non passée, elle
 *        attend MA réponse → contre-proposition, en tête (P1PRO) ;
 *      · sinon → demande en attente du salon. Une contre-proposition
 *        EXPIRÉE retombe donc dans les demandes : plus rien à répondre, la
 *        ligne dit simplement que l'échéance est passée ;
 *  - `confirmed` à venir → à venir ;
 *  - tout le reste → historique (y compris une demande résolue).
 *
 * `resolution` porte la vérité de l'historique : une demande expirée n'est
 * NI un no-show NI un refus (F4 §7).
 */

import { isExpired, isLateCancellation } from '@/shared/lib/deadline'
import type { MyAppointment } from '@/features/booking/api/booking'

/** Les seuls champs dont la partition a besoin — testable sans la RPC. */
export type PartitionableAppointment = Pick<
  MyAppointment,
  'status' | 'resolution' | 'starts_at' | 'expires_at' | 'counter_proposed_at'
>

export interface PartitionedBookings<T extends PartitionableAppointment> {
  counters: T[]
  requests: T[]
  upcoming: T[]
  history: T[]
}

export function partitionAppointments<T extends PartitionableAppointment>(
  rows: readonly T[],
  now: Date,
): PartitionedBookings<T> {
  const counters: T[] = []
  const requests: T[] = []
  const upcoming: T[] = []
  const history: T[] = []

  for (const row of rows) {
    const future = Date.parse(row.starts_at) > now.getTime()
    if (row.status === 'pending' && row.resolution === null) {
      if (row.counter_proposed_at !== null && !(row.expires_at !== null && isExpired(row.expires_at, now))) {
        counters.push(row)
      } else {
        requests.push(row)
      }
    } else if (row.status === 'confirmed' && future) upcoming.push(row)
    else history.push(row)
  }

  counters.sort((a, b) => (a.expires_at ?? a.starts_at).localeCompare(b.expires_at ?? b.starts_at))
  requests.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  upcoming.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  history.sort((a, b) => b.starts_at.localeCompare(a.starts_at))

  return { counters, requests, upcoming, history }
}

/**
 * Le libellé d'une ligne d'historique — lu sur `resolution` d'abord, sur le
 * statut ensuite. `null` = rien d'honnête à dire, on n'invente pas.
 */
export function resolutionLabelKey(
  row: Pick<MyAppointment, 'status' | 'resolution'>,
): string | null {
  switch (row.resolution) {
    case 'declined':
      return 'booking.bookings.resolutionDeclined'
    case 'expired':
      return 'booking.bookings.resolutionExpired'
    case 'cancelled_by_customer':
      return 'booking.bookings.resolutionCancelledByCustomer'
    case 'cancelled_by_business':
      return 'booking.bookings.resolutionCancelledByBusiness'
    case 'rescheduled':
      return 'booking.bookings.resolutionRescheduled'
    default:
      if (row.status === 'completed') return 'booking.bookings.statusCompleted'
      if (row.status === 'no_show') return 'booking.bookings.statusNoShow'
      return null
  }
}

/** Une ligne `pending` non résolue EST une demande — jamais un rendez-vous. */
export function isPendingRequest(row: Pick<MyAppointment, 'status' | 'resolution'>): boolean {
  return row.status === 'pending' && row.resolution === null
}

/** Annulable / reportable : rien n'est résolu et l'horaire est à venir. */
export function isActionable(
  row: Pick<MyAppointment, 'status' | 'resolution' | 'starts_at'>,
  now: Date,
): boolean {
  return (
    (row.status === 'pending' || row.status === 'confirmed') &&
    row.resolution === null &&
    Date.parse(row.starts_at) > now.getTime()
  )
}

/**
 * Le geste d'annulation, dit AVANT d'être fait (F4 §7) :
 *
 *  - une DEMANDE se « retire » (elle ne retenait rien) ; un RENDEZ-VOUS
 *    s'annule et le salon est prévenu ;
 *  - à moins de 12 h du rendez-vous, l'annulation reste PERMISE et sans
 *    frais — elle est simplement dite « tardive » avant le geste, jamais
 *    découverte après. Une demande n'a pas d'avertissement tardif : aucun
 *    créneau n'était tenu.
 */
export interface CancelPlan {
  isRequest: boolean
  actionKey: string
  titleKey: string
  bodyKey: string
  lateWarning: boolean
}

export function cancelPlan(
  row: Pick<MyAppointment, 'status' | 'resolution' | 'starts_at'>,
  now: Date,
): CancelPlan {
  const request = isPendingRequest(row)
  return {
    isRequest: request,
    actionKey: request ? 'booking.bookings.cancelRequest' : 'booking.bookings.cancel',
    titleKey: request ? 'booking.bookings.cancelRequestTitle' : 'booking.bookings.cancelTitle',
    bodyKey: request ? 'booking.bookings.cancelRequestBody' : 'booking.bookings.cancelBody',
    lateWarning: !request && isLateCancellation(row.starts_at, now),
  }
}
