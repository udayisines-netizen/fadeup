import { useCallback, useState } from 'react'

/**
 * F3 — géolocalisation À LA DEMANDE (MASTER_SPEC §8) : jamais déclenchée à
 * l'ouverture, uniquement au geste qui en dépend (« autour de moi »). Le
 * refus n'est pas une erreur : la recherche manuelle par ville reste le
 * chemin complet, pas un repli dégradé.
 */

export type GeolocationStatus = 'idle' | 'locating' | 'granted' | 'denied' | 'unavailable'

export interface GeolocationPoint {
  latitude: number
  longitude: number
}

export function useGeolocation(): {
  status: GeolocationStatus
  request: () => Promise<GeolocationPoint | null>
} {
  const [status, setStatus] = useState<GeolocationStatus>('idle')

  const request = useCallback(async (): Promise<GeolocationPoint | null> => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setStatus('unavailable')
      return null
    }
    setStatus('locating')
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setStatus('granted')
          resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude })
        },
        (error) => {
          setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable')
          resolve(null)
        },
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
      )
    })
  }, [])

  return { status, request }
}
