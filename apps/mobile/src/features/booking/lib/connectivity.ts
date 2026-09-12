/**
 * M1c-a — ce que l'onglet Réservations montre HORS CONNEXION.
 *
 * La décision du fondateur a deux moitiés, et elles se contredisent si on les
 * lit vite :
 *
 *   « Aucune donnée périmée. »
 *   « Ce qui reste consultable : les réservations à venir et l'historique. »
 *
 * La lecture juste est celle de la NATURE des données. Une réservation à venir
 * et un historique sont des faits stables : les montrer hors ligne ne trompe
 * personne, à condition de DIRE de quand ils datent. Une position dans la file
 * change toutes les minutes : la montrer hors ligne envoie un client au salon
 * alors qu'il a peut-être déjà été appelé et manqué.
 *
 * Ce module tranche donc trois choses, et il le fait PURE (testable sous
 * Node, aucune dépendance à React Native) :
 *
 *   - bloquer ou afficher ;
 *   - afficher ou non l'âge de la donnée ;
 *   - montrer ou non la file — la réponse est NON, sans condition.
 */

export interface ConnectivityInput {
  /** `null` = pas encore mesuré : on ne déclare pas « hors ligne » sans savoir. */
  online: boolean | null
  /** Y a-t-il quelque chose de stable à montrer (cache persisté ou réponse) ? */
  hasStableData: boolean
}

export interface ConnectivityView {
  /** Rien à montrer et pas de réseau : l'état honnête plein écran. */
  blocked: boolean
  /** Une ligne discrète « hors connexion — dernière mise à jour à … ». */
  showStaleNotice: boolean
  /** La file est-elle affichable ? JAMAIS hors ligne. */
  showQueue: boolean
}

export function deriveBookingsConnectivity(input: ConnectivityInput): ConnectivityView {
  const offline = input.online === false
  if (!offline) {
    return { blocked: false, showStaleNotice: false, showQueue: true }
  }
  return {
    blocked: !input.hasStableData,
    showStaleNotice: input.hasStableData,
    // Le point dur du lot. Une position vieille de dix minutes n'est pas une
    // approximation, c'est une fausse information — et son coût retombe
    // entièrement sur le client, qui perd sa place.
    showQueue: false,
  }
}

/**
 * L'heure de dernière mise à jour, en `HH:MM` local, ou `null` si elle est
 * inconnue (jamais chargé, ou horodatage illisible). `null` = ne rien
 * afficher : « dernière mise à jour à --:-- » est pire que le silence.
 */
export function lastUpdatedLabel(updatedAt: number | null | undefined, locale: string): string | null {
  if (updatedAt === null || updatedAt === undefined || !Number.isFinite(updatedAt) || updatedAt <= 0) {
    return null
  }
  try {
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(updatedAt))
  } catch {
    return null
  }
}
