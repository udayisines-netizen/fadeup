/**
 * OS-2 — la logique PURE des fiches clients (CRM). Tout ce qui décide d'un
 * libellé, d'un retard ou d'un rappel vit ici, testé sans rendu.
 *
 * Deux lois traversent ce fichier :
 *   · le SERVEUR fait foi — `is_lapsed`, `average_interval_days` et
 *     `days_since_last` sont LUS, jamais recalculés côté client ;
 *   · rien ne s'invente — sans rythme observé, aucune phrase de rythme ;
 *     `null` n'est pas `0`.
 */

/**
 * B5 — l'effacement de compte client. La fiche `customers` SURVIT anonymisée
 * (l'historique reste dû au salon pour sa comptabilité) et `customers.name`
 * porte alors le jeton LITTÉRAL `[deleted]` — la colonne est NOT NULL, d'où
 * un jeton plutôt qu'un `NULL`.
 *
 * Aucune correspondance approximative : le jeton est exactement `[deleted]`.
 * Un nom vide mène au même état — on n'affiche pas une identité vide.
 */
export const DELETED_CUSTOMER_TOKEN = '[deleted]'

export type CustomerNameDisplay = { deleted: true } | { deleted: false; name: string }

export function displayCustomerName(raw: string | null): CustomerNameDisplay {
  if (raw === null || raw.trim() === '') return { deleted: true }
  if (raw === DELETED_CUSTOMER_TOKEN) return { deleted: true }
  return { deleted: false, name: raw }
}

export const CUSTOMER_SEGMENTS = ['all', 'regular', 'lapsed', 'new', 'verified'] as const
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number]

export function isCustomerSegment(value: string): value is CustomerSegment {
  return (CUSTOMER_SEGMENTS as readonly string[]).includes(value)
}

/** Une clé i18n prête à passer à `t()` — la page traduit, la logique décide. */
export interface I18nPhrase {
  key: string
  params?: Record<string, string | number>
}

export interface FrequencyInput {
  /** Rythme observé côté serveur, en jours. `null` = pas encore de rythme. */
  averageIntervalDays: number | null
  /** Jours depuis la dernière prestation TERMINÉE. `null` = inconnu. */
  daysSinceLast: number | null
  completedCount: number
  /** `null` = aucune prestation terminée : « jamais venu », pas « 0 jour ». */
  lastCompletedAt: string | null
}

/**
 * Le sous-titre dense d'une rangée client, en morceaux i18n à joindre.
 *
 * Règles : jamais de rythme si le serveur n'en a pas observé un ; « jamais
 * venu » quand aucune prestation n'est terminée ; « venu aujourd'hui » à
 * zéro jour (et non « il y a 0 j »).
 */
export function frequencyLabel(input: FrequencyInput): I18nPhrase[] {
  const completed = Math.max(0, Math.trunc(input.completedCount))

  // Aucune prestation terminée : une seule phrase honnête. « 0 prestation ·
  // jamais venu » dirait deux fois la même chose.
  if (completed === 0 || input.lastCompletedAt === null) {
    return [{ key: 'pro.clients.row.never' }]
  }

  const parts: I18nPhrase[] = [{ key: 'pro.clients.row.visits', params: { count: completed } }]

  if (input.daysSinceLast !== null) {
    parts.push(
      input.daysSinceLast <= 0
        ? { key: 'pro.clients.row.lastVisitToday' }
        : { key: 'pro.clients.row.lastVisit', params: { days: Math.round(input.daysSinceLast) } },
    )
  }

  if (input.averageIntervalDays !== null) {
    const days = Math.round(input.averageIntervalDays)
    // Un rythme arrondi à zéro jour ne veut rien dire : on se tait.
    if (days > 0) parts.push({ key: 'pro.clients.row.cycle', params: { days } })
  }

  return parts
}

export interface OverdueInput {
  daysSinceLast: number | null
  averageIntervalDays: number | null
  /** `is_lapsed` du serveur — l'autorité. */
  isLapsed: boolean
}

/**
 * Les jours de retard sur le rythme observé, ou `null` quand la question n'a
 * pas de sens (pas en retard selon le serveur, pas de rythme, pas de
 * dernière visite, écart nul ou négatif).
 */
export function overdueDays(input: OverdueInput): number | null {
  if (!input.isLapsed) return null
  if (input.daysSinceLast === null || input.averageIntervalDays === null) return null
  const diff = Math.round(input.daysSinceLast - input.averageIntervalDays)
  return diff > 0 ? diff : null
}

export interface LapsedSummaryInput {
  /** Le segment actuellement affiché. */
  segment: CustomerSegment
  /**
   * `total_count` d'une requête bornée au segment `lapsed` — une donnée
   * SERVEUR. `null` tant qu'elle n'est pas arrivée : on ne devine pas.
   */
  lapsedTotal: number | null
}

/**
 * Le bloc d'appel « des réguliers ne sont pas revenus ». Il ne se rend pas
 * sur le segment `lapsed` (on y est déjà), ni à zéro, ni avant que le
 * compte serveur soit connu.
 */
export function lapsedSummary(input: LapsedSummaryInput): { visible: boolean; count: number } {
  const count = input.lapsedTotal === null ? 0 : Math.max(0, Math.trunc(input.lapsedTotal))
  return { visible: input.segment !== 'lapsed' && count > 0, count }
}

/** Nombre de pages pour un total serveur — au moins une, même à zéro client. */
export function totalPages(totalCount: number, pageSize: number): number {
  if (pageSize <= 0) return 1
  return Math.max(1, Math.ceil(Math.max(0, totalCount) / pageSize))
}

const HISTORY_STATUSES = [
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
  'waiting',
  'called',
  'in_service',
] as const

/** La clé d'état d'un passage, ou `null` si la base en renvoie un inconnu. */
export function historyStatusKey(status: string): string | null {
  return (HISTORY_STATUSES as readonly string[]).includes(status) ? `pro.clients.detail.status.${status}` : null
}

/** Rendez-vous ou file : deux origines distinctes, jamais confondues. */
export function historyKindKey(kind: string): string | null {
  if (kind === 'appointment') return 'pro.clients.detail.historyAppointment'
  if (kind === 'queue') return 'pro.clients.detail.historyQueue'
  return null
}

/* ── Refus nommés des RPC CRM ───────────────────────────────────────────
   La base les émet en `DETAIL: fadeup_<domaine>_refusal=<code>` ; on branche
   sur le CODE, jamais sur le texte du message. */

export const CRM_REFUSAL_CODES = ['not_authorized', 'unknown_segment'] as const
export type CrmRefusalCode = (typeof CRM_REFUSAL_CODES)[number]

export const NOTE_REFUSAL_CODES = ['not_authorized', 'empty_body', 'body_too_long', 'anonymous'] as const
export type NoteRefusalCode = (typeof NOTE_REFUSAL_CODES)[number]

const CRM_PATTERN = /fadeup_crm_refusal=([a-z_]+)/
const NOTE_PATTERN = /fadeup_customer_notes_refusal=([a-z_]+)/

function readDetails(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const details = (raw as { details?: unknown }).details
  return typeof details === 'string' ? details : null
}

export function parseCrmRefusal(raw: unknown): CrmRefusalCode | null {
  const details = readDetails(raw)
  if (!details) return null
  const match = CRM_PATTERN.exec(details)
  if (!match?.[1]) return null
  return (CRM_REFUSAL_CODES as readonly string[]).includes(match[1]) ? (match[1] as CrmRefusalCode) : null
}

export function parseNoteRefusal(raw: unknown): NoteRefusalCode | null {
  const details = readDetails(raw)
  if (!details) return null
  const match = NOTE_PATTERN.exec(details)
  if (!match?.[1]) return null
  return (NOTE_REFUSAL_CODES as readonly string[]).includes(match[1]) ? (match[1] as NoteRefusalCode) : null
}

/** Un message DISTINCT par refus de note — jamais le texte brut de l'API. */
export function noteRefusalMessageKey(code: NoteRefusalCode): string {
  switch (code) {
    case 'not_authorized':
      return 'pro.clients.errors.noteForbidden'
    case 'empty_body':
      return 'pro.clients.notes.required'
    case 'body_too_long':
      return 'pro.clients.notes.tooLong'
    case 'anonymous':
      return 'errors.data.auth'
  }
}

/**
 * Une fiche refusée (42501 / `not_authorized`) est indistinguable d'une
 * fiche inexistante — et c'est voulu : un salon n'apprend pas l'existence
 * d'un client d'un autre salon. Les deux mènent au même état vide.
 */
export function isMissingCustomer(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object') return false
  const code = (raw as { code?: unknown }).code
  if (code === '42501' || code === 'PGRST116') return true
  const status = (raw as { status?: unknown }).status
  if (status === 403 || status === 404) return true
  return parseCrmRefusal(raw) === 'not_authorized'
}
