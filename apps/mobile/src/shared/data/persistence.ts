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
import type { Query, QueryClient } from '@tanstack/react-query'

import { bookingKeys } from '@/shared/data/keys'

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

/**
 * Les mutations en pause ne sont JAMAIS persistées.
 *
 * Le défaut de la librairie persiste `state.variables` de toute mutation en
 * pause. Concrètement : une coupure de réseau au moment de « Rejoindre la
 * file » écrivait au disque, pour sept jours, le nom du client, son téléphone,
 * ses coordonnées GPS et le jeton de pointage du salon. Trouvé en revue — la
 * liste blanche ci-dessus ne gouverne que les REQUÊTES, pas les mutations.
 *
 * Rien à récupérer en échange : une reprise de mutation après redémarrage
 * n'est ni implémentée ni souhaitable ici (rejoindre une file dix minutes plus
 * tard, ce n'est plus rejoindre la file).
 */
export function shouldDehydrateMutation(): boolean {
  return false
}

/**
 * Efface tout ce qui appartient à UNE personne — en mémoire et au disque.
 * Appelée à chaque changement de compte, déconnexion comprise.
 *
 * Les clés persistées ne portent pas d'identifiant de compte : c'est ce qui
 * rend cette purge nécessaire plutôt que polie. Ce qui n'est pas personnel
 * (un profil public, une recherche) n'a pas besoin d'être effacé, mais le
 * faire ne coûte rien et évite d'avoir à décider à chaque nouvelle clé.
 */
export async function forgetPersonalData(queryClient: QueryClient): Promise<void> {
  queryClient.removeQueries({ queryKey: bookingKeys.all })
  queryClient.removeQueries({ queryKey: ['push'] })
  queryClient.removeQueries({ queryKey: ['passport'] })
  try {
    await AsyncStorage.removeItem(PERSISTED_CACHE_KEY)
  } catch {
    /* stockage indisponible : rien à effacer, ou rien d'effaçable */
  }
}

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
