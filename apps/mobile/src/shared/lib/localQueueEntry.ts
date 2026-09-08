/**
 * ADAPTATION MOBILE DÉCLARÉE (M1b) de apps/web/src/shared/lib/localQueueEntry.ts —
 * même contrat (`fadeup.queueEntry`, mêmes champs, même validation), stockage
 * `AsyncStorage` asynchrone au lieu de `window.localStorage` synchrone. Même
 * motif que `recentProfiles.ts` (M1a). La garde de drift fige le sha de
 * l'original web : s'il bouge, re-passer cette adaptation.
 *
 * Mémoire locale de l'entrée en file d'un client ANONYME. `join_public_queue`
 * retourne l'id de l'entrée ; un client connecté la retrouve par
 * `get_my_queue_status`, un anonyme n'a que cet id — on le garde pour que
 * `/q/[slug]` rouvre directement sur « votre place ». Rien de sensible : l'id
 * ne donne accès à rien d'autre que la position déjà publique.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

const STORAGE_KEY = 'fadeup.queueEntry'

export interface LocalQueueEntry {
  entryId: string
  slug: string
  locationId: string
  joinedAt: string
}

export async function saveLocalQueueEntry(entry: LocalQueueEntry): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entry))
  } catch {
    // Stockage indisponible : le suivi survit à l'écran courant via l'état
    // React, pas au-delà. Aucun échec fonctionnel.
  }
}

export function parseLocalQueueEntry(raw: string | null): LocalQueueEntry | null {
  if (!raw) return null
  try {
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

export async function readLocalQueueEntry(): Promise<LocalQueueEntry | null> {
  try {
    return parseLocalQueueEntry(await AsyncStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

export async function clearLocalQueueEntry(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY)
  } catch {
    // Même repli silencieux que l'écriture.
  }
}
