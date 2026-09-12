/**
 * OS-2 — les motifs de refus NOMMÉS du catalogue. La base les émet via
 * `DETAIL: fadeup_service_refusal=<motif>` (migration
 * `20260911110100_os2_service_catalog.sql`) et PostgREST les remonte dans
 * `error.details`. On branche sur le MOTIF, jamais sur le texte anglais du
 * message.
 *
 * Deux motifs n'ont pas de clé dédiée et retombent volontairement sur
 * `errorMessageKey(toAppError(...))` : `not_authorized` (42501 → « pas
 * d'accès », la formulation générique est la bonne) et les refus
 * structurels `category_foreign` / `barber_foreign` / `price_negative`, que
 * la saisie de l'écran rend inatteignables — les inventer en copie
 * reviendrait à promettre une explication qu'on n'a pas.
 */

export const SERVICE_REFUSAL_CODES = [
  'not_authorized',
  'price_forbidden_for_role',
  'name_required',
  'duration_required',
  'price_required',
  'price_negative',
  'category_foreign',
  'barber_foreign',
  'archived',
  'has_history',
] as const

export type ServiceRefusalCode = (typeof SERVICE_REFUSAL_CODES)[number]

const PATTERN = /fadeup_service_refusal=([a-z_]+)/

function readDetails(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const details = (raw as { details?: unknown }).details
  return typeof details === 'string' ? details : null
}

/** Le motif nommé porté par une erreur PostgREST, ou null. */
export function parseServiceRefusal(raw: unknown): ServiceRefusalCode | null {
  const details = readDetails(raw)
  if (!details) return null
  const code = PATTERN.exec(details)?.[1]
  if (code === undefined) return null
  return (SERVICE_REFUSAL_CODES as readonly string[]).includes(code) ? (code as ServiceRefusalCode) : null
}

/**
 * La clé i18n dédiée d'un motif, ou `null` quand il n'y en a pas — l'appelant
 * retombe alors sur `errorMessageKey(toAppError(error))`.
 */
export function serviceRefusalMessageKey(code: ServiceRefusalCode): string | null {
  switch (code) {
    case 'price_forbidden_for_role':
      return 'pro.catalog.errors.priceForbidden'
    case 'has_history':
      return 'pro.catalog.errors.hasHistory'
    case 'name_required':
      return 'pro.catalog.errors.nameRequired'
    case 'duration_required':
      return 'pro.catalog.errors.durationRequired'
    case 'price_required':
      return 'pro.catalog.errors.priceRequired'
    case 'archived':
      return 'pro.catalog.errors.archived'
    default:
      return null
  }
}
