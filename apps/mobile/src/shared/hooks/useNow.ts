import { useEffect, useState } from 'react'

/**
 * Horloge partagée d'un écran : UN intervalle pour toutes les rangées, plutôt
 * qu'un timer par composant. Sert aux comptes à rebours réels (grâce pro,
 * échéance d'appel client) — jamais à inventer une donnée.
 */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
