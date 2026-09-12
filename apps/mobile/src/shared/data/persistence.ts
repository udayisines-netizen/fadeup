/**
 * M1c-a — le hors-ligne, tel que le fondateur l'a tranché :
 *
 *   « L'application affiche un état hors connexion. AUCUNE donnée périmée.
 *     Ce qui reste consultable : les réservations à venir et l'historique.
 *     Ce qui ne l'est pas : la position dans la file. »
 *
 * POURQUOI UNE LISTE BLANCHE, ET PAS UN CACHE GÉNÉRAL
 *
 * Un cache général est exactement ce que la décision interdit. Une position de
 * file vieille de dix minutes envoie un client au salon alors qu'il a déjà été
 * appelé et manqué — c'est un rendez-vous perdu et une place rendue. Un nombre
 * de personnes en attente, un créneau disponible, un résultat de recherche
 * géolocalisé : mêmes dégâts, plus discrets.
 *
 * Seules les données STABLES sont donc persistées, et elles le sont par une
 * liste blanche EXPLICITE : ajouter une clé se décide, ne s'hérite pas. Tout
 * ce qui n'y figure pas disparaît à la fermeture de l'application.
 *
 * Module PUR (le prédicat est testable sous Node) ; le liant AsyncStorage vit
 * en bas de fichier, hors de portée des tests.
 */
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Query } from '@tanstack/react-query'

/**
 * LA liste blanche, par PRÉFIXE de clé de requête.
 *
 *   bookings/list             mes réservations à venir et mon historique
 *   bookings/interest-requests mes demandes d'intérêt (échéance affichée avec
 *                             son propre garde-fou d'expiration, côté écran)
 *   passport                  RÉSERVÉ : le Fade Passport est reporté, mais sa
 *                             place hors ligne est prévue — une carte que l'on
 *                             présente au comptoir n'a aucun intérêt si elle
 *                             exige du réseau (prompt §4).
 *
 * N'y figurent PAS, et ne doivent jamais y figurer : queue (position, file
 * publique, état de service), bookings/slots, bookings/barbers,
 * bookings/alternatives, discovery, search, feed.
 */
export const PERSISTED_KEY_PREFIXES: readonly (readonly string[])[] = [
  ['bookings', 'list'],
  ['bookings', 'interest-requests'],
  ['passport'],
]

/** La clé de requête commence-t-elle par ce préfixe ? */
function matchesPrefix(queryKey: readonly unknown[], prefix: readonly string[]): boolean {
  if (queryKey.length < prefix.length) return false
  return prefix.every((segment, index) => queryKey[index] === segment)
}

/**
 * Le prédicat de persistance. `false` par défaut : une requête nouvelle n'est
 * PAS persistée tant que personne ne l'a décidé — l'oubli va dans le sens de
 * la sûreté.
 *
 * Une requête en erreur n'est jamais persistée non plus : garder un échec au
 * disque ferait repartir l'écran sur une erreur périmée.
 */
export function shouldPersistQueryKey(queryKey: readonly unknown[]): boolean {
  return PERSISTED_KEY_PREFIXES.some((prefix) => matchesPrefix(queryKey, prefix))
}

export function shouldDehydrateQuery(query: Query): boolean {
  return query.state.status === 'success' && shouldPersistQueryKey(query.queryKey)
}

/**
 * Au-delà, le cache disque est jeté sans être lu. Sept jours : un historique
 * de réservations d'une semaine reste vrai (ce sont des faits passés), et une
 * réservation à venir plus ancienne que ça aura de toute façon été rafraîchie
 * — l'écran affiche l'heure de la dernière mise à jour, donc le client n'est
 * jamais laissé à deviner.
 */
export const PERSISTED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export const PERSISTED_CACHE_KEY = 'fu.queryCache.v1'

/** Le liant natif — la seule pièce de ce fichier qui connaît AsyncStorage. */
export function createQueryPersister() {
  return createAsyncStoragePersister({
    storage: AsyncStorage,
    key: PERSISTED_CACHE_KEY,
    // Une écriture par seconde au plus : la persistance ne doit pas peser sur
    // le fil principal à chaque rafraîchissement de liste.
    throttleTime: 1_000,
  })
}
