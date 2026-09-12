/**
 * M1c-a — le branchement racine du push. Il ne DEMANDE jamais rien : la
 * permission se demande après avoir rejoint une file, et nulle part ailleurs
 * (prompt §3). Ce composant se contente de :
 *
 *   1. dire comment une notification se présente quand l'app est au premier
 *      plan (une bannière, pas un silence : le client dans le salon doit voir
 *      « c'est votre tour » même s'il a l'app ouverte sur un autre écran) ;
 *   2. router le TOUCHER d'une notification, y compris celle qui a lancé
 *      l'application depuis un état tué ;
 *   3. rattacher l'appareil au compte à l'arrivée d'une session, et le retirer
 *      à la déconnexion. Sans cela, un jeton enregistré en anonyme resterait
 *      lié à une entrée de file morte, et le client ne recevrait plus rien.
 *
 * Aucun rendu : `null`. Il vit sous le fournisseur de session et le routeur.
 */
import { useEffect, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'

import { routeForNotification } from '@/features/notifications/lib/notificationRoute'
import { usePushDevice } from '@/features/notifications/usePushDevice'
import { useSession } from '@/shared/data/auth'
import { forgetPersonalData } from '@/shared/data/persistence'

// Le comportement au premier plan, posé UNE fois pour l'application.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

export function PushBridge() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { session, ready } = useSession()
  const { ensureRegistered } = usePushDevice()
  /** `undefined` = première observation ; ensuite l'identifiant, ou null. */
  const previousUserId = useRef<string | null | undefined>(undefined)

  /* M1b tenait les préférences de notification SUR L'APPAREIL ; M1c-a les a
     déplacées en base. La clé locale n'a plus de lecteur : on l'efface une
     fois plutôt que de laisser une orpheline que personne ne saura expliquer
     dans six mois. Rien n'est migré, et il n'y a rien à migrer — ces
     interrupteurs n'activaient aucun canal. */
  useEffect(() => {
    void AsyncStorage.removeItem('fu.notifPrefs.v1').catch(() => {})
  }, [])

  // 1 + 2. Le toucher d'une notification.
  useEffect(() => {
    const open = (data: unknown) => {
      const route = routeForNotification(data as Record<string, unknown> | null)
      // Route inconnue : on n'invente pas de destination — l'accueil, comme
      // pour un lien profond inconnu (M1b).
      router.push((route ?? '/') as never)
    }

    /* Celle qui a LANCÉ l'application : elle n'arrive par aucun écouteur.
       Et elle PERSISTE — Expo la garde jusqu'à ce qu'on l'efface, d'où
       l'effacement juste après. Sans lui, chaque démarrage à froid rejouerait
       la dernière notification touchée et détournerait la navigation vers un
       écran que le client n'a pas demandé.

       Sous try/catch ET hors du web : le module de notifications du rendu web
       n'expose qu'un talon, et `getLastNotificationResponse` y lève
       SYNCHRONEMENT — donc au montage de ce composant, à la racine. Le rendu
       web est le véhicule de QA du mobile : le casser, c'est perdre la seule
       vérification visuelle possible sans licence Apple. */
    if (Platform.OS !== 'web') {
      try {
        const last = Notifications.getLastNotificationResponse()
        if (last) {
          open(last.notification.request.content.data)
          void Notifications.clearLastNotificationResponseAsync().catch(() => {})
        }
      } catch {
        /* module indisponible : aucune notification n'a lancé l'application */
      }
    }

    let subscription: { remove: () => void } | null = null
    try {
      subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        open(response.notification.request.content.data)
      })
    } catch {
      /* idem : pas d'écouteur là où il n'y a pas de module natif */
    }
    return () => subscription?.remove()
  }, [router])

  // 3. Session → appareil.
  useEffect(() => {
    if (!ready) return
    const userId = session?.user.id ?? null
    const previous = previousUserId.current
    previousUserId.current = userId

    /*
     * LE CHANGEMENT DE COMPTE. Les réservations et les préférences sont
     * persistées au disque sous des clés qui ne portent PAS d'identifiant de
     * compte (`bookings/list`, `push/preferences`) : sans cette purge, B qui
     * se connecte après A voit, hors connexion, les rendez-vous de A — avec
     * le salon, le service et l'heure. Trouvé en revue ; c'est la persistance
     * ajoutée par ce lot qui crée la fuite, le cache mourait avec le
     * processus avant.
     *
     * `previous !== undefined` : au tout premier démarrage il n'y a rien à
     * purger, et purger effacerait le cache qu'on vient de restaurer.
     */
    if (previous !== undefined && previous !== userId) {
      void forgetPersonalData(queryClient)
    }

    if (userId) {
      // Rattache ce jeton au compte — silencieux, et seulement si la
      // permission existe déjà.
      void ensureRegistered(null)
    }
  }, [ready, session, ensureRegistered, queryClient])

  return null
}
