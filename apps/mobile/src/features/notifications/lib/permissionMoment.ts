/**
 * M1c-a — QUAND demander la permission de notifier. Module PUR : il n'importe
 * ni React Native, ni Expo, ni le client Supabase, et le stockage lui est
 * INJECTÉ (même contrat `KeyValueStore` que M1b).
 *
 * LA RÈGLE, ET CE QU'ELLE COÛTE DE RATER
 *
 * Sur iOS, la question ne se pose QU'UNE FOIS. Un refus est définitif : le
 * système ne la reposera jamais, et l'application ne peut plus qu'envoyer le
 * client dans les Réglages. Demander à l'ouverture, avant que le client sache
 * ce que FadeUp fait, c'est donc échanger la valeur de tout le canal contre
 * rien.
 *
 * Le moment retenu (prompt M1c-a §3) : JUSTE APRÈS avoir rejoint une file.
 * À cet instant, la phrase « on te prévient quand c'est ton tour » décrit un
 * bénéfice que le client vient lui-même de demander. C'est le seul moment de
 * l'application où presque personne ne refuse.
 *
 * Et une seule fois : si le système a déjà tranché — accordé ou refusé —, on
 * ne redemande pas. Redemander après un refus définitif ne peut produire
 * qu'une feuille inutile.
 */

/** L'état système, tel qu'`expo-notifications` le rapporte. */
export type SystemPermissionStatus = 'undetermined' | 'granted' | 'denied'

export interface PermissionMomentState {
  /** Ce que le système répond aujourd'hui. */
  system: SystemPermissionStatus
  /** A-t-on DÉJÀ posé la question dans l'application ? (persisté) */
  alreadyAsked: boolean
  /** Le client vient-il de rejoindre une file ? */
  justJoinedQueue: boolean
}

export type PermissionDecision =
  /** Poser la question, avec l'argument de la file. */
  | { ask: true }
  | { ask: false; reason: 'not_the_moment' | 'already_asked' | 'already_granted' | 'system_denied' }

/**
 * LA décision. Jamais à l'ouverture : `justJoinedQueue` est la seule porte.
 * L'ordre des refus est celui de la vérité la plus forte : ce que le système
 * sait prime sur ce que l'application se rappelle.
 */
export function decidePermissionMoment(state: PermissionMomentState): PermissionDecision {
  if (state.system === 'granted') return { ask: false, reason: 'already_granted' }
  if (state.system === 'denied') return { ask: false, reason: 'system_denied' }
  if (!state.justJoinedQueue) return { ask: false, reason: 'not_the_moment' }
  if (state.alreadyAsked) return { ask: false, reason: 'already_asked' }
  return { ask: true }
}

export const PERMISSION_ASKED_STORAGE_KEY = 'fu.pushAsked.v1'

/** Le contrat minimal d'un stockage clé/valeur — AsyncStorage le satisfait. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

/** Le stockage n'est JAMAIS bloquant. Illisible = « jamais demandé ». */
export async function readAlreadyAsked(store: KeyValueStore): Promise<boolean> {
  try {
    return (await store.getItem(PERMISSION_ASKED_STORAGE_KEY)) === '1'
  } catch {
    return false
  }
}

/**
 * Marque la question comme posée. Renvoie `false` si l'écriture a échoué —
 * l'appelant peut alors savoir que la question POURRAIT être reposée une fois.
 * C'est le bon sens du compromis : mieux vaut une feuille de trop qu'un canal
 * perdu parce qu'un stockage saturé a fait croire à un refus.
 */
export async function markAlreadyAsked(store: KeyValueStore): Promise<boolean> {
  try {
    await store.setItem(PERMISSION_ASKED_STORAGE_KEY, '1')
    return true
  } catch {
    return false
  }
}
