/**
 * OS-2 — la logique PURE des réglages de la file.
 *
 * Les trois seuils (`queue_capacity_per_barber`, `queue_call_grace_minutes`,
 * `queue_geofence_meters`) vivent dans `location_service_settings`. Ce module
 * ne connaît AUCUNE valeur par défaut : il ne sait que valider des bornes et
 * dire ce qui a changé. Les valeurs initiales viennent toujours de la base.
 *
 * Les bornes reproduisent EXACTEMENT la contrainte SQL
 * `location_service_settings_queue_thresholds_range` et les gardes de
 * `set_location_queue_thresholds`. Le client valide pour éviter un
 * aller-retour inutile ; le serveur reste la vérité (ses refus nommés
 * `fadeup_queue_refusal=…` sont affichés tels quels).
 */

export interface Thresholds {
  capacity: number
  grace: number
  geofence: number
}

/** Le formulaire manipule du TEXTE : « », « 12.5 » et « abc » sont des états réels. */
export interface ThresholdDraft {
  capacity: string
  grace: string
  geofence: string
}

export type ThresholdField = keyof Thresholds

export type ThresholdErrors = Partial<Record<ThresholdField, string>>

interface Bound {
  min: number
  max: number
  errorKey: string
}

export const THRESHOLD_BOUNDS: Record<ThresholdField, Bound> = {
  capacity: { min: 1, max: 200, errorKey: 'queue.settings.errors.capacityRange' },
  grace: { min: 0, max: 120, errorKey: 'queue.settings.errors.graceRange' },
  geofence: { min: 25, max: 2000, errorKey: 'queue.settings.errors.geofenceRange' },
}

const THRESHOLD_FIELDS: readonly ThresholdField[] = ['capacity', 'grace', 'geofence']

/**
 * Un entier, rien d'autre. `Number('')` vaut 0 et `Number(' 12 ')` vaut 12 :
 * les deux sont des pièges, on filtre sur la forme du texte AVANT de convertir.
 */
export function parseThreshold(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (!/^-?\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

/**
 * Les erreurs de bornes du brouillon, par champ. Objet vide = envoyable.
 * Un champ vide, décimal, négatif ou non numérique est une erreur de borne :
 * l'utilisateur doit corriger, pas deviner ce que le serveur fera.
 */
export function thresholdErrors(draft: ThresholdDraft): ThresholdErrors {
  const errors: ThresholdErrors = {}
  for (const field of THRESHOLD_FIELDS) {
    const bound = THRESHOLD_BOUNDS[field]
    const value = parseThreshold(draft[field])
    if (value === null || value < bound.min || value > bound.max) {
      errors[field] = bound.errorKey
    }
  }
  return errors
}

/**
 * Les SEULS champs modifiés, ou `null` si rien n'a bougé.
 *
 * C'est la garantie qu'on n'écrase pas un seuil qu'on n'a pas touché : la RPC
 * laisse en place tout paramètre absent, donc n'envoyer que le delta rend
 * impossible l'écrasement d'un réglage changé entre-temps par un collègue.
 * Un champ invalide n'est jamais compté comme un changement.
 */
export function changedThresholds(initial: Thresholds, draft: ThresholdDraft): Partial<Thresholds> | null {
  const changes: Partial<Thresholds> = {}
  for (const field of THRESHOLD_FIELDS) {
    const value = parseThreshold(draft[field])
    if (value === null || value === initial[field]) continue
    changes[field] = value
  }
  return Object.keys(changes).length === 0 ? null : changes
}

/** Le brouillon initial : le texte exact des valeurs lues en base. */
export function toThresholdDraft(initial: Thresholds): ThresholdDraft {
  return {
    capacity: String(initial.capacity),
    grace: String(initial.grace),
    geofence: String(initial.geofence),
  }
}

export type ProRole = 'owner' | 'manager' | 'receptionist' | 'barber'

/**
 * Miroir EXACT de la garde SQL de `set_location_queue_thresholds`,
 * `set_barber_queue_enabled` et `set_location_queue_grace_sweep` :
 * `has_org_role(org, ['owner','manager'])`.
 *
 * Le frontend CONDITIONNE (un rôle sans capacité ne voit pas le bloc du
 * tout — jamais un formulaire grisé), la base AUTORISE.
 */
export function canManageQueueSettings(role: ProRole | null | undefined): boolean {
  return role === 'owner' || role === 'manager'
}

/** Les refus nommés de `set_location_queue_thresholds` (migration OS-2). */
export const QUEUE_SETTINGS_REFUSAL_CODES = [
  'not_authorized',
  'no_change',
  'capacity_out_of_range',
  'grace_out_of_range',
  'geofence_out_of_range',
] as const

export type QueueSettingsRefusalCode = (typeof QUEUE_SETTINGS_REFUSAL_CODES)[number]

const REFUSAL_PATTERN = /fadeup_queue_refusal=([a-z_]+)/

/**
 * Extrait le motif nommé d'une erreur PostgREST. `null` quand ce n'est pas un
 * refus de réglage connu — la page retombe alors sur `errorMessageKey`.
 */
export function parseQueueSettingsRefusal(raw: unknown): QueueSettingsRefusalCode | null {
  if (typeof raw !== 'object' || raw === null) return null
  const details = (raw as { details?: unknown }).details
  if (typeof details !== 'string') return null
  const match = REFUSAL_PATTERN.exec(details)
  const code = match?.[1]
  if (!code) return null
  return (QUEUE_SETTINGS_REFUSAL_CODES as readonly string[]).includes(code)
    ? (code as QueueSettingsRefusalCode)
    : null
}

/**
 * Le refus serveur, ramené sur le champ fautif quand il en désigne un — la
 * borne s'affiche alors AU BON endroit, exactement comme la garde client.
 */
export function refusalTarget(code: QueueSettingsRefusalCode): { field: ThresholdField | null; messageKey: string } {
  switch (code) {
    case 'capacity_out_of_range':
      return { field: 'capacity', messageKey: THRESHOLD_BOUNDS.capacity.errorKey }
    case 'grace_out_of_range':
      return { field: 'grace', messageKey: THRESHOLD_BOUNDS.grace.errorKey }
    case 'geofence_out_of_range':
      return { field: 'geofence', messageKey: THRESHOLD_BOUNDS.geofence.errorKey }
    case 'no_change':
      return { field: null, messageKey: 'queue.settings.errors.noChange' }
    case 'not_authorized':
      return { field: null, messageKey: 'queue.settings.errors.notAuthorized' }
  }
}
