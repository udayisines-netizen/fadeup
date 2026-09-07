/**
 * Les motifs de refus nommés de la Live Queue. La base les émet via
 * `DETAIL: fadeup_queue_refusal=<code>` — PostgREST le remonte dans
 * `error.details`. On branche sur le CODE, jamais sur le texte anglais du
 * message (V2_DATA_CONTRACT §V8).
 *
 * B1 en a posé huit (join). F1b en ajoute sept :
 *   - `barber_queue_disabled` — join/changement vers un barber sans file ;
 *   - `entry_not_found`, `not_entry_owner`, `entry_already_closed`,
 *     `entry_in_service` — leave_public_queue / get_queue_entry_tracking ;
 *   - `entry_not_waiting`, `already_in_that_queue` — change_queue_entry_barber.
 *
 * Chaque code a son message distinct et actionnable. Aucun seuil n'est codé
 * en dur dans les libellés — la géofence comme la grâce sont des réglages
 * par salon que le contrat public n'expose pas au client.
 */

export const QUEUE_REFUSAL_CODES = [
  'service_area_has_no_queue',
  'invalid_check_in_token',
  'location_not_geolocated',
  'position_required',
  'too_far',
  'barber_queue_disabled',
  'queue_closed',
  'queue_full',
  'already_in_queue',
  'entry_not_found',
  'not_entry_owner',
  'entry_already_closed',
  'entry_in_service',
  'entry_not_waiting',
  'already_in_that_queue',
] as const

export type QueueRefusalCode = (typeof QUEUE_REFUSAL_CODES)[number]

const REFUSAL_PATTERN = /fadeup_queue_refusal=([a-z_]+)/

function isRefusalCode(value: string): value is QueueRefusalCode {
  return (QUEUE_REFUSAL_CODES as readonly string[]).includes(value)
}

/**
 * Extrait le code de refus d'une erreur PostgREST brute. `null` si l'erreur
 * n'est pas un refus de file nommé (elle suit alors le chemin `toAppError`
 * générique).
 */
export function parseQueueRefusal(raw: unknown): QueueRefusalCode | null {
  if (typeof raw !== 'object' || raw === null) return null
  const details = (raw as { details?: unknown }).details
  if (typeof details !== 'string') return null
  const match = REFUSAL_PATTERN.exec(details)
  if (!match?.[1]) return null
  return isRefusalCode(match[1]) ? match[1] : null
}

/**
 * Clé i18n (namespace `v2`) du message associé à un code. Quinze codes,
 * quinze messages distincts — vérifié par test.
 */
export function refusalMessageKey(code: QueueRefusalCode): string {
  return `queue.refusal.${code}`
}

/**
 * Les refus qui appellent une nouvelle tentative sur place (le client peut
 * corriger lui-même) — par opposition à ceux où l'état du salon décide.
 */
export function refusalIsRetryable(code: QueueRefusalCode): boolean {
  return code === 'position_required' || code === 'too_far' || code === 'invalid_check_in_token'
}
