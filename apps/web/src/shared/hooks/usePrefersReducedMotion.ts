import { useEffect, useState } from 'react'

/**
 * D1 — lecture SYNCHRONE de `prefers-reduced-motion: reduce`.
 *
 * Le hook `useReducedMotion` de Framer démarre à `false` et ne lit la media
 * query que dans un effet : le premier cadre partirait en translation ou en
 * échelle — l'interdit exact de la règle (non négociable). Ici la valeur
 * initiale vient de `matchMedia` au premier rendu.
 */
export function usePrefersReducedMotion(): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setMatches(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return matches
}
