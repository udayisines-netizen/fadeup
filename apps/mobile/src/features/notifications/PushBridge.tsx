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
import { useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'

import { routeForNotification } from '@/features/notifications/lib/notificationRoute'
import { revokeThisDevice, usePushDevice } from '@/features/notifications/usePushDevice'
import { useSession } from '@/shared/data/auth'

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
  const { session, ready } = useSession()
  const { ensureRegistered } = usePushDevice()
  /** `undefined` = première observation ; ensuite l'identifiant, ou null. */
  const previousUserId = useRef<string | null | undefined>(undefined)

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
       `clearLastNotificationResponseAsync` juste après. Sans cet effacement,
       chaque démarrage à froid rejouerait la dernière notification touchée et
       détournerait la navigation vers un écran que le client n'a pas demandé.
       (C'est la raison d'être de cette fonction dans l'API d'Expo.) */
    const last = Notifications.getLastNotificationResponse()
    if (last) {
      open(last.notification.request.content.data)
      void Notifications.clearLastNotificationResponseAsync()
    }

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response.notification.request.content.data)
    })
    return () => subscription.remove()
  }, [router])

  // 3. Session → appareil.
  useEffect(() => {
    if (!ready) return
    const userId = session?.user.id ?? null
    const previous = previousUserId.current
    previousUserId.current = userId

    if (userId) {
      // Rattache ce jeton au compte — silencieux, et seulement si la
      // permission existe déjà.
      void ensureRegistered(null)
      return
    }

    // Déconnexion CONSTATÉE (on avait un compte, on n'en a plus) : on retire
    // l'appareil. Au premier démarrage sans session, il n'y a rien à retirer.
    if (previous) void revokeThisDevice()
  }, [ready, session, ensureRegistered])

  return null
}
