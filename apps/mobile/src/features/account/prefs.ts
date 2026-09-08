/**
 * M1b — les préférences de notification, LOCALES à l'appareil.
 *
 * Honnêteté (l'écran le dit aussi) : le push n'existe pas encore côté
 * FadeUp. Ces interrupteurs n'activent RIEN aujourd'hui ; ils enregistrent
 * un choix qui s'appliquera quand le canal existera. Rien n'est envoyé au
 * serveur — aucun contrat de préférences n'existe en base (manque déclaré).
 *
 * Module PUR et testable : la validation ne connaît pas AsyncStorage, le
 * stockage est INJECTÉ (`KeyValueStore`). Le liant natif vit dans
 * `useNotifPrefs.ts`, hors de portée des tests Node.
 */

export const NOTIF_PREF_KEYS = ['queue', 'booking', 'social'] as const
export type NotifPrefKey = (typeof NOTIF_PREF_KEYS)[number]
export type NotifPrefs = Record<NotifPrefKey, boolean>

export const NOTIF_PREFS_STORAGE_KEY = 'fu.notifPrefs.v1'

/**
 * Défauts : les deux préférences TRANSACTIONNELLES (mon tour, réponse à ma
 * demande) sont attendues par qui les déclenche — elles arrivent activées.
 * L'activité sociale ne l'est pas : elle s'opte.
 */
export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  queue: true,
  booking: true,
  social: false,
}

function isNotifPrefKey(value: string): value is NotifPrefKey {
  return (NOTIF_PREF_KEYS as readonly string[]).includes(value)
}

/**
 * Tout ce qui n'est pas un booléen reconnu retombe sur le défaut : une
 * préférence illisible ne doit jamais bloquer l'écran ni inventer un état.
 */
export function parseNotifPrefs(raw: string | null | undefined): NotifPrefs {
  if (!raw) return { ...DEFAULT_NOTIF_PREFS }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_NOTIF_PREFS }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ...DEFAULT_NOTIF_PREFS }
  }
  const record = parsed as Record<string, unknown>
  const prefs: NotifPrefs = { ...DEFAULT_NOTIF_PREFS }
  for (const key of Object.keys(record)) {
    if (isNotifPrefKey(key) && typeof record[key] === 'boolean') {
      prefs[key] = record[key]
    }
  }
  return prefs
}

export function serializeNotifPrefs(prefs: NotifPrefs): string {
  // Écriture normalisée : seules les clés connues, dans l'ordre du contrat.
  const normalized: NotifPrefs = { ...DEFAULT_NOTIF_PREFS }
  for (const key of NOTIF_PREF_KEYS) normalized[key] = prefs[key]
  return JSON.stringify(normalized)
}

export function setNotifPref(prefs: NotifPrefs, key: NotifPrefKey, value: boolean): NotifPrefs {
  return { ...prefs, [key]: value }
}

/** Le contrat minimal d'un stockage clé/valeur — AsyncStorage le satisfait. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

/** Le stockage n'est JAMAIS bloquant : indisponible → les défauts. */
export async function readNotifPrefs(store: KeyValueStore): Promise<NotifPrefs> {
  try {
    return parseNotifPrefs(await store.getItem(NOTIF_PREFS_STORAGE_KEY))
  } catch {
    return { ...DEFAULT_NOTIF_PREFS }
  }
}

/** Renvoie `false` si l'écriture a échoué — l'appelant peut le dire. */
export async function writeNotifPrefs(store: KeyValueStore, prefs: NotifPrefs): Promise<boolean> {
  try {
    await store.setItem(NOTIF_PREFS_STORAGE_KEY, serializeNotifPrefs(prefs))
    return true
  } catch {
    return false
  }
}
