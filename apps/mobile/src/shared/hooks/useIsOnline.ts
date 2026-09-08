/**
 * M1b — l'état réseau de l'app, décision fondateur (prompt §3) : l'app
 * AFFICHE un état hors connexion, elle n'affiche AUCUNE donnée périmée.
 *
 * NetInfo alimente deux choses :
 *  - `onlineManager` de TanStack Query (les requêtes se suspendent et
 *    repartent au retour du réseau — `refetchOnReconnect: true` est déjà
 *    posé par M1a) ;
 *  - ce hook, pour que les écrans dépendant du réseau disent honnêtement
 *    qu'ils ne peuvent pas se mettre à jour.
 *
 * `null` = pas encore mesuré : on ne déclare pas « hors ligne » avant de
 * savoir (jamais de bandeau fugace au lancement).
 */
import NetInfo from '@react-native-community/netinfo'
import { onlineManager } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

export function wireOnlineManager(): () => void {
  return NetInfo.addEventListener((state) => {
    // `isInternetReachable` peut rester null un instant — seul un `false`
    // franc coupe ; un doute ne prive pas l'app de réseau.
    const online = state.isConnected !== false && state.isInternetReachable !== false
    onlineManager.setOnline(online)
  })
}

export function useIsOnline(): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null)
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false && state.isInternetReachable !== false)
    })
    return unsubscribe
  }, [])
  return online
}
