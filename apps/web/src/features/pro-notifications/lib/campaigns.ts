/**
 * OS-3 §4 — la logique PURE des sollicitations par modèles.
 *
 * Elle est le MIROIR des gardes SQL, jamais leur remplacement : le serveur
 * refuse de toute façon (`private.assert_campaign_text`,
 * `send_notification_campaign`), et cette couche existe pour que le
 * professionnel voie le refus avant d'appuyer, pas pour l'autoriser.
 */

export const CAMPAIGN_KINDS = ['lapsed_customers', 'free_slots_tomorrow', 'promotion', 'loyalty_reminder'] as const
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number]

/** Bornes exactes de `private.assert_campaign_text` et de l'audience SQL. */
export const HEADLINE_MAX = 160
export const OFFER_MAX = 80
export const THRESHOLD_MIN_DAYS = 14
export const THRESHOLD_MAX_DAYS = 365
export const THRESHOLD_DEFAULT_DAYS = 60
export const PROMOTION_MAX_DAYS = 180

export type TextRefusal =
  | 'missing'
  | 'tooLong'
  | 'multiline'
  | 'link'
  | 'templateToken'

/**
 * Le même jugement que `private.assert_campaign_text`, dans le même ordre.
 *
 * L'interdiction des liens n'est pas une coquetterie : le seul lien d'une
 * sollicitation est celui du profil du salon, posé par le gabarit. Laisser
 * passer une URL libre ferait de FadeUp un relais d'hameçonnage sur la
 * réputation d'un domaine d'envoi partagé par tous les salons.
 */
export function validateCampaignText(value: string, max: number): TextRefusal | null {
  const trimmed = value.trim()
  if (trimmed === '') return 'missing'
  if (trimmed.length > max) return 'tooLong'
  if (/[\n\r\t]/.test(trimmed)) return 'multiline'
  if (/(https?:\/\/|www\.|[a-z0-9-]+\.(com|fr|net|org|io|co|be|ch)\b)/i.test(trimmed)) return 'link'
  if (trimmed.includes('{{') || trimmed.includes('}}')) return 'templateToken'
  return null
}

export interface Quota {
  used: number
  /** `null` = illimité. Jamais un grand nombre arbitraire. */
  monthly_allowance: number | null
  remaining: number | null
}

/** `null` = illimité : l'écran doit pouvoir écrire « illimité ». */
export function remainingSends(quota: Pick<Quota, 'used' | 'monthly_allowance'>): number | null {
  if (quota.monthly_allowance === null) return null
  return Math.max(0, quota.monthly_allowance - quota.used)
}

/** Au plafond, on n'empêche pas l'écran : on explique. */
export function atCap(quota: Pick<Quota, 'used' | 'monthly_allowance'> | null | undefined): boolean {
  if (!quota) return false
  if (quota.monthly_allowance === null) return false
  return quota.used >= quota.monthly_allowance
}

/**
 * Le motif de refus NOMMÉ que la base attache à ses exceptions
 * (`detail = 'fadeup_campaign_refusal=…'`). On lit le motif, jamais le
 * message : le message est du français destiné aux journaux, la clé est le
 * contrat.
 */
export function parseCampaignRefusal(error: unknown): string | null {
  const detail = (error as { details?: unknown; detail?: unknown } | null)?.details ?? (error as { detail?: unknown } | null)?.detail
  if (typeof detail !== 'string') return null
  const match = /fadeup_campaign_refusal=([a-z_]+)/.exec(detail)
  return match?.[1] ?? null
}

/** Le nombre de champs qu'un modèle demande — sert à l'ordre d'affichage. */
export function kindNeedsService(kind: CampaignKind): boolean {
  return kind === 'free_slots_tomorrow'
}

export function kindNeedsThreshold(kind: CampaignKind): boolean {
  return kind === 'lapsed_customers'
}

export function kindNeedsOffer(kind: CampaignKind): boolean {
  return kind === 'promotion'
}

export function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return THRESHOLD_DEFAULT_DAYS
  return Math.min(THRESHOLD_MAX_DAYS, Math.max(THRESHOLD_MIN_DAYS, Math.round(value)))
}

/**
 * La date de fin d'une promotion, telle que la base l'accepte : aujourd'hui
 * au plus tôt, 180 jours au plus tard.
 */
export function promotionBounds(today: Date): { min: string; max: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const max = new Date(today)
  max.setUTCDate(max.getUTCDate() + PROMOTION_MAX_DAYS)
  return { min: iso(today), max: iso(max) }
}

export interface Preview {
  eligible_count: number
  reachable_count: number
  no_email_count: number
  do_not_contact_count: number
  frequency_capped_count: number
  verified_count: number
  deferred: boolean
  scheduled_at: string
  slot_count: number | null
  slot_date: string | null
}

/**
 * Ce qu'il faut DIRE d'un aperçu, dans l'ordre d'importance. On ne rend une
 * ligne d'exclusion que si elle compte au moins un client : « 0 désabonné »
 * est du bruit.
 */
export function suppressionLines(preview: Preview): Array<{ reason: 'noEmail' | 'doNotContact' | 'frequency'; count: number }> {
  const lines: Array<{ reason: 'noEmail' | 'doNotContact' | 'frequency'; count: number }> = []
  if (preview.no_email_count > 0) lines.push({ reason: 'noEmail', count: preview.no_email_count })
  if (preview.do_not_contact_count > 0) lines.push({ reason: 'doNotContact', count: preview.do_not_contact_count })
  if (preview.frequency_capped_count > 0) lines.push({ reason: 'frequency', count: preview.frequency_capped_count })
  return lines
}

/** Un envoi est possible quand quelqu'un est joignable ET que le plafond reste. */
export function canSend(preview: Preview | null | undefined, quota: Quota | null | undefined): boolean {
  if (atCap(quota)) return false
  if (!preview) return false
  return preview.reachable_count > 0
}
