/**
 * Contrat des files publiques (`list_public_queues`, F1b) — déplacé vers
 * shared/ par F2 : le profil salon affiche les files via le même composant
 * que /q/:slug, et `features/X` n'importe jamais `features/Y` (lint
 * bloquant). Même motif que le déplacement F1 de waitTime/queueLink.
 */

/** Une file de l'établissement — `barber_id` null = « premier disponible ». */
export interface PublicQueueFile {
  barber_id: string | null
  display_name: string | null
  avatar_url: string | null
  waiting_count: number
  busy: boolean
  /** Estimation F1b, ou null = rien d'affichable (jamais une minute inventée). */
  estimated_wait_minutes: number | null
}
