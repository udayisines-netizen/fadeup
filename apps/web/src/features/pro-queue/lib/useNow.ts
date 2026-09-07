import { useEffect, useState } from 'react'

/**
 * Horloge partagée d'un écran : re-rend à intervalle fixe pour les durées
 * qui défilent (attente écoulée, grâce). Un seul timer par usage, nettoyé
 * au démontage.
 */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}
