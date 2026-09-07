/**
 * Les HUIT motifs de refus de `join_public_queue` (B1). La base les émet via
 * `DETAIL: fadeup_queue_refusal=<code>` — PostgREST le remonte dans
 * `error.details`. On branche sur le CODE, jamais sur le texte anglais du
 * message (V2_DATA_CONTRACT §V8).
 *
 * Chaque code a son message distinct et actionnable : « vous êtes trop
 * loin » n'est pas « le QR est invalide » n'est pas « la file est pleine ».
 * Aucun seuil n'est codé en dur dans les libellés — la géofence exacte est
 * un réglage par salon que le contrat public n'expose pas au client.
 */

export const QUEUE_REFUSAL_CODES = [
  'service_area_has_no_queue',
  'invalid_check_in_token',
  'location_not_geolocated',
  'position_required',
  'too_far',
  'queue_closed',
  'queue_full',
  'already_in_queue',
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
 * Clé i18n (namespace `v2`) du message associé à un code. Huit codes, huit
 * messages distincts — vérifié par test.
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
