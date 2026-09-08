/**
 * Loi produit (MASTER_SPEC §7, F1 §3, F1b §3) : le temps d'attente estimé ne
 * s'affiche QUE si la base en fournit un fiable. Depuis F1b, la base en
 * fournit un — l'estimateur « déclaré puis appris » de
 * `private.estimated_service_duration_minutes`, exposé par
 * `list_public_queues.estimated_wait_minutes` et
 * `get_queue_entry_tracking.estimated_wait_minutes`. `null` reste la réponse
 * honnête chaque fois que rien de fiable n'existe.
 *
 * Vit dans shared/lib : les faces client (features/queue) et pro
 * (features/pro-queue) partagent la même loi. Ce module est l'unique point de
 * vérité : tant que `estimatedMinutes` est `null`, RIEN n'est rendu — pas
 * d'« environ », pas d'estimation optimiste, pas de minute inventée.
 */

export interface WaitTimeDisplay {
  /** Minutes à afficher, déjà validées et arrondies au pas produit. */
  minutes: number
}

/**
 * Pas d'affichage : cinq minutes (F1b §3). Une précision à la minute qu'on
 * n'a pas est un mensonge poli. Arrondi VERS LE HAUT : promettre un peu plus
 * et servir plus tôt vaut mieux que l'inverse.
 */
const DISPLAY_STEP_MINUTES = 5

/**
 * `null` = ne rien afficher. Toute valeur absente, négative ou non finie est
 * traitée comme « pas de temps fiable ». Une estimation positive est arrondie
 * au multiple de cinq supérieur ; zéro reste zéro (file vide = sans attente,
 * pas « 5 min »).
 */
export function formatEstimatedWait(estimatedMinutes: number | null | undefined): WaitTimeDisplay | null {
  if (estimatedMinutes === null || estimatedMinutes === undefined) return null
  if (!Number.isFinite(estimatedMinutes) || estimatedMinutes < 0) return null
  if (estimatedMinutes === 0) return { minutes: 0 }
  return { minutes: Math.ceil(estimatedMinutes / DISPLAY_STEP_MINUTES) * DISPLAY_STEP_MINUTES }
}

/**
 * Durée d'attente ÉCOULÉE d'une entrée (depuis `created_at`) — une mesure,
 * pas une estimation : elle est toujours affichable. En minutes entières,
 * jamais négative (horloges client/serveur non synchrones).
 */
export function elapsedWaitMinutes(createdAt: string, now: Date = new Date()): number {
  const started = new Date(createdAt).getTime()
  if (!Number.isFinite(started)) return 0
  return Math.max(0, Math.floor((now.getTime() - started) / 60_000))
}
