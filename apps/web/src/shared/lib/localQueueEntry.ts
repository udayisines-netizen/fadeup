/**
 * (Déplacé de features/queue par F3 : l'accueil montre la file active d'un
 * client anonyme — `features/X` n'importe jamais `features/Y`, même motif que
 * le déplacement F2 de publicQueue.)
 *
 * Mémoire locale de l'entrée en file d'un client ANONYME. `join_public_queue`
 * retourne l'id de l'entrée ; un client connecté la retrouve par
 * `get_my_queue_status`, un anonyme n'a que cet id — on le garde pour que
 * `/q/:slug` rouvre directement sur « votre place ». Rien de sensible : l'id
 * ne donne accès à rien d'autre que la position déjà publique.
 */

const STORAGE_KEY = 'fadeup.queueEntry'

export interface LocalQueueEntry {
  entryId: string
  slug: string
  locationId: string
  joinedAt: string
}

export function saveLocalQueueEntry(entry: LocalQueueEntry): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entry))
  } catch {
    // Stockage indisponible (navigation privée) : le suivi survit à l'onglet
    // courant via l'état React, pas au-delà. Aucun échec fonctionnel.
  }
}

export function readLocalQueueEntry(): LocalQueueEntry | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const candidate = parsed as Partial<LocalQueueEntry>
    if (
      typeof candidate.entryId !== 'string' ||
      typeof candidate.slug !== 'string' ||
      typeof candidate.locationId !== 'string' ||
      typeof candidate.joinedAt !== 'string'
    ) {
      return null
    }
    return candidate as LocalQueueEntry
  } catch {
    return null
  }
}

export function clearLocalQueueEntry(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Même repli silencieux que l'écriture.
  }
}
