import { errorMessageKey, toAppError } from '@/shared/data/errors'

/**
 * OS-2 — les refus NOMMÉS de l'équipe. La base les émet en
 * `DETAIL: fadeup_team_refusal=<motif>` ; on branche sur le CODE, jamais sur
 * le texte anglais du message (V2_DATA_CONTRACT §V8).
 *
 * `has_future_appointments` porte en plus son compte
 * (`…=has_future_appointments count=3`) : le nombre vient de la base, il
 * n'est jamais estimé côté client.
 */

export const TEAM_REFUSAL_CODES = [
  'not_authorized',
  'anonymous',
  'role_required',
  'owner_role_forbidden',
  'email_invalid',
  'already_member',
  'location_foreign',
  'self_role',
  'self_removal',
  'last_owner',
  'has_future_appointments',
  'reassign_conflict',
  'target_invalid',
  'target_is_self',
] as const

export type TeamRefusalCode = (typeof TEAM_REFUSAL_CODES)[number]

export interface TeamRefusal {
  code: TeamRefusalCode
  /** Renseigné par `has_future_appointments` seulement. */
  count: number | null
}

const PATTERN = /fadeup_team_refusal=([a-z_]+)(?:\s+count=(\d+))?/

function detailsOf(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) return ''
  const error = raw as { details?: unknown; message?: unknown }
  const details = typeof error.details === 'string' ? error.details : ''
  const message = typeof error.message === 'string' ? error.message : ''
  return `${details} ${message}`
}

export function parseTeamRefusal(raw: unknown): TeamRefusal | null {
  const match = PATTERN.exec(detailsOf(raw))
  if (!match) return null
  const code = match[1] as TeamRefusalCode
  if (!(TEAM_REFUSAL_CODES as readonly string[]).includes(code)) return null
  const count = match[2] !== undefined ? Number.parseInt(match[2], 10) : null
  return { code, count }
}

const REFUSAL_KEYS: Record<TeamRefusalCode, string> = {
  /* Les trois refus d'autorisation ne décrivent jamais la policy : l'écran
     dit « pas d'accès », la base garde le détail. */
  not_authorized: 'errors.data.forbidden',
  anonymous: 'errors.data.auth',
  role_required: 'errors.data.validation',
  owner_role_forbidden: 'pro.team.errors.ownerForbidden',
  email_invalid: 'pro.team.errors.emailInvalid',
  already_member: 'pro.team.errors.alreadyMember',
  location_foreign: 'pro.team.errors.locationForeign',
  self_role: 'pro.team.errors.selfRole',
  self_removal: 'pro.team.errors.selfRemoval',
  last_owner: 'pro.team.errors.lastOwner',
  has_future_appointments: 'pro.team.errors.hasFutureAppointments',
  reassign_conflict: 'pro.team.errors.reassignConflict',
  target_invalid: 'pro.team.errors.targetInvalid',
  target_is_self: 'pro.team.errors.targetIsSelf',
}

/**
 * La clé i18n d'un échec d'action d'équipe : refus nommé d'abord, puis le
 * refus de CAPACITÉ du plan (`P0001` sans motif nommé — un siège barber de
 * plus dépasse le plan), enfin la traduction générique `toAppError`.
 */
export function teamErrorKey(raw: unknown): string {
  const refusal = parseTeamRefusal(raw)
  if (refusal) return REFUSAL_KEYS[refusal.code]
  const code = typeof raw === 'object' && raw !== null ? (raw as { code?: unknown }).code : undefined
  if (code === 'P0001') return 'pro.team.errors.capacity'
  return errorMessageKey(toAppError(raw))
}

/** Vrai quand la lecture a été refusée par la RLS (42501) — un barber qui force l'URL. */
export function isForbidden(raw: unknown): boolean {
  return toAppError(raw).kind === 'forbidden'
}
