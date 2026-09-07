/**
 * Les motifs de refus nommés du tunnel de réservation. La base les émet via
 * `DETAIL: fadeup_booking_refusal=<code>` (migration F4, sur le motif F1) et
 * `DETAIL: fadeup_interest_refusal=<code>` (B2, demande d'intérêt) —
 * PostgREST les remonte dans `error.details`. On branche sur le CODE, jamais
 * sur le texte anglais du message (F4 §4, V2_DATA_CONTRACT §V8).
 *
 * Deux refus n'ont PAS de detail nommé, à dessein, et se lisent sur leur
 * SQLSTATE (`error.code` chez PostgREST) :
 *   - `23P01` — la contrainte d'exclusion GiST : le créneau vient d'être pris
 *     par quelqu'un d'autre (l'arbitre de course, côté serveur) ;
 *   - `22023` sans detail — `check_appointment_time_blocks` (fonction
 *     `supabase_admin`, non redéfinie par F4) : le professionnel est
 *     indisponible sur ce créneau (blocage de temps).
 * Les deux disent la même chose au client : ce créneau n'est plus libre.
 */

export const BOOKING_REFUSAL_CODES = [
  'missing_name',
  'missing_contact',
  'missing_time',
  'past_time',
  'unknown_organization',
  'location_unavailable',
  'service_unavailable',
  'barber_unavailable',
  'outside_hours',
  'too_many_future_bookings',
  'service_mode_closed',
  'appointment_not_found',
  'no_longer_cancellable',
  'not_authorized',
  'no_longer_reschedulable',
  'slot_conflict',
] as const

export type BookingRefusalCode = (typeof BOOKING_REFUSAL_CODES)[number]

export const INTEREST_REFUSAL_CODES = [
  'no_contact_channel',
  'missing_time',
  'past_time',
  'too_far_ahead',
  'profile_not_public',
  'professional_is_claimed',
  'profile_withdrawn',
] as const

export type InterestRefusalCode = (typeof INTEREST_REFUSAL_CODES)[number]

const BOOKING_PATTERN = /fadeup_booking_refusal=([a-z_]+)/
const INTEREST_PATTERN = /fadeup_interest_refusal=([a-z_]+)/

function readDetails(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const details = (raw as { details?: unknown }).details
  return typeof details === 'string' ? details : null
}

function readSqlState(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const code = (raw as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function isBookingCode(value: string): value is BookingRefusalCode {
  return (BOOKING_REFUSAL_CODES as readonly string[]).includes(value)
}

function isInterestCode(value: string): value is InterestRefusalCode {
  return (INTEREST_REFUSAL_CODES as readonly string[]).includes(value)
}

/**
 * Extrait le code de refus d'une erreur PostgREST brute. `null` si l'erreur
 * n'est pas un refus de réservation nommé (elle suit alors le chemin
 * `toAppError` générique).
 */
export function parseBookingRefusal(raw: unknown): BookingRefusalCode | null {
  const details = readDetails(raw)
  if (details) {
    const match = BOOKING_PATTERN.exec(details)
    if (match?.[1]) return isBookingCode(match[1]) ? match[1] : null
  }
  // Les deux refus sans detail : conflit d'exclusion (23P01) et blocage de
  // temps (22023 nu). Le SQLSTATE est un code, pas un texte.
  const sqlstate = readSqlState(raw)
  if (sqlstate === '23P01' || sqlstate === '22023') return 'slot_conflict'
  return null
}

/** Idem pour la demande d'intérêt (`fadeup_interest_refusal=<code>`, B2). */
export function parseInterestRefusal(raw: unknown): InterestRefusalCode | null {
  const details = readDetails(raw)
  if (!details) return null
  const match = INTEREST_PATTERN.exec(details)
  if (!match?.[1]) return null
  return isInterestCode(match[1]) ? match[1] : null
}

/** Clé i18n (namespace `v2`) du message associé — un message DISTINCT par code. */
export function bookingRefusalMessageKey(code: BookingRefusalCode): string {
  return `booking.refusal.${code}`
}

export function interestRefusalMessageKey(code: InterestRefusalCode): string {
  return `booking.interestRefusal.${code}`
}

/**
 * Les refus après lesquels re-proposer immédiatement les créneaux du jour a
 * du sens (la situation peut avoir changé sous les doigts du client).
 */
export function bookingRefusalIsSlotRelated(code: BookingRefusalCode): boolean {
  return code === 'slot_conflict' || code === 'outside_hours'
}
