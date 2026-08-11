export interface Coordinates {
  latitude: number
  longitude: number
}

/**
 * Wraps navigator.geolocation in a Promise. Callers must only invoke this
 * from an explicit user action (e.g. a "Use my location" button click) —
 * requesting it on page load without context is a bad-permission-prompt
 * pattern the marketplace search deliberately avoids.
 */
export function getCurrentPosition(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('geolocation-unavailable'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => reject(new Error('geolocation-denied')),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    )
  })
}
