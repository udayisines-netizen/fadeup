/**
 * Loi produit (MASTER_SPEC §7, F1 §3) : le temps d'attente estimé ne
 * s'affiche QUE si la base en fournit un fiable. Aujourd'hui, AUCUNE RPC
 * publique n'en fournit — ni `get_public_queue_status`, ni
 * `get_public_service_state`. Le modèle d'estimation est une décision
 * fondateur en attente (MASTER_SPEC §23.3).
 *
 * Vit dans shared/lib : les faces client (features/queue) et pro (features/pro-queue) partagent la même loi. Ce module est l'unique point de vérité : tant que `estimatedMinutes`
 * est `null`, RIEN n'est rendu — pas d'« environ », pas d'estimation
 * optimiste, pas de minute inventée. Le jour où la base livre une
 * estimation, elle passe ici et s'affiche.
 */

export interface WaitTimeDisplay {
  /** Minutes à afficher, déjà validées. */
  minutes: number
}

/**
 * `null` = ne rien afficher. Toute valeur absente, négative ou non finie est
 * traitée comme « pas de temps fiable ».
 */
export function formatEstimatedWait(estimatedMinutes: number | null | undefined): WaitTimeDisplay | null {
  if (estimatedMinutes === null || estimatedMinutes === undefined) return null
  if (!Number.isFinite(estimatedMinutes) || estimatedMinutes < 0) return null
  return { minutes: Math.round(estimatedMinutes) }
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
