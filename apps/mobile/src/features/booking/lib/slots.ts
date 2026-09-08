/**
 * Dérivés PURS de présentation des créneaux — aucun créneau n'est jamais
 * fabriqué ici : tout vient de `get_public_available_slots`, qui dit la
 * vérité (F4 §3). Ici on groupe, on fusionne, on nomme — c'est tout.
 */

import type { PublicSlot } from '@/features/booking/api/booking'

export type PartOfDay = 'morning' | 'afternoon' | 'evening'

/** Midi et 17 h — non configurable : un découpage inhabituel est pire qu'un découpage légèrement faux. */
const AFTERNOON_FROM = 12 * 60
const EVENING_FROM = 17 * 60

/**
 * Minutes écoulées depuis minuit DANS LE FUSEAU DU LIEU — un client qui
 * réserve depuis Paris chez un barber de Tokyo doit voir le matin de Tokyo.
 */
export function minutesSinceMidnight(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return hour * 60 + minute
}

export function partOfDayFor(slotStart: string, timeZone: string): PartOfDay {
  const minute = minutesSinceMidnight(slotStart, timeZone)
  if (minute < AFTERNOON_FROM) return 'morning'
  if (minute < EVENING_FROM) return 'afternoon'
  return 'evening'
}

/** Le premier moment de la journée qui a des créneaux — l'écran ne s'ouvre jamais sur un onglet vide. */
export function firstPopulatedPart(slots: readonly PublicSlot[], timeZone: string): PartOfDay {
  for (const key of ['morning', 'afternoon', 'evening'] as const) {
    if (slots.some((slot) => partOfDayFor(slot.slot_start, timeZone) === key)) return key
  }
  return 'morning'
}

export interface MergedSlot extends PublicSlot {
  /** Le barber qui offre RÉELLEMENT ce créneau (résolu, jamais inventé). */
  barber_id: string
}

/**
 * « Premier professionnel disponible » (F4 §4) : l'union des créneaux de
 * chaque barber apte. Un horaire offert par plusieurs est porté par le
 * premier de la liste (ordre stable de `list_public_barbers`) — le client
 * choisit un HORAIRE, la maison choisit qui le sert.
 */
export function mergeSlotsAcrossBarbers(
  perBarber: ReadonlyArray<{ barberId: string; slots: readonly PublicSlot[] }>,
): MergedSlot[] {
  const byStart = new Map<string, MergedSlot>()
  for (const { barberId, slots } of perBarber) {
    for (const slot of slots) {
      if (!byStart.has(slot.slot_start)) {
        byStart.set(slot.slot_start, { ...slot, barber_id: barberId })
      }
    }
  }
  return [...byStart.values()].sort((a, b) => a.slot_start.localeCompare(b.slot_start))
}

/** AAAA-MM-JJ d'un instant, dans le fuseau du LIEU. */
export function dateInTimezone(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
}

/** Fenêtre de réservation : aujourd'hui + 90 jours (MASTER_SPEC §6). */
export const BOOKING_WINDOW_DAYS = 90

/**
 * Les jours proposables, en AAAA-MM-JJ du fuseau du lieu. Des JOURS ne sont
 * pas des CRÉNEAUX : proposer un jour n'affirme aucune disponibilité — c'est
 * `get_public_available_slots` qui répond, jour par jour.
 */
export function bookableDays(timeZone: string, now: Date): string[] {
  const days: string[] = []
  for (let i = 0; i <= BOOKING_WINDOW_DAYS; i += 1) {
    days.push(dateInTimezone(new Date(now.getTime() + i * 86_400_000), timeZone))
  }
  return days
}
