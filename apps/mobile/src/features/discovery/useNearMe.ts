import { useCallback, useState } from 'react'
import * as Location from 'expo-location'
import { roundCoordinate, type SearchPoint } from '@/features/discovery/searchState'

/**
 * « Autour de moi » — la géolocalisation ne se demande JAMAIS à l'ouverture
 * (loi produit M1a §3) : ce hook n'exécute rien tant que `locate()` n'est
 * pas appelé par le geste. Refus : une note calme, aucun blocage — la
 * recherche par ville est le même écran avec les mêmes capacités.
 */
export type NearMeStatus = 'idle' | 'locating' | 'granted' | 'denied' | 'error'

export function useNearMe(onPoint: (point: SearchPoint) => void): {
  status: NearMeStatus
  locate: () => Promise<void>
} {
  const [status, setStatus] = useState<NearMeStatus>('idle')

  const locate = useCallback(async () => {
    setStatus('locating')
    try {
      const permission = await Location.requestForegroundPermissionsAsync()
      if (!permission.granted) {
        setStatus('denied')
        return
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      })
      setStatus('granted')
      onPoint({
        latitude: roundCoordinate(position.coords.latitude),
        longitude: roundCoordinate(position.coords.longitude),
      })
    } catch {
      setStatus('error')
    }
  }, [onPoint])

  return { status, locate }
}
