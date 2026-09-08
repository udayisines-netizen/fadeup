import { useReducedMotion } from 'react-native-reanimated'

/**
 * Préférence système de réduction d'animations — l'équivalent natif de
 * `prefers-reduced-motion` (D1 : « Respecte-la »).
 *
 * `useReducedMotion` de Reanimated lit la valeur système de façon SYNCHRONE
 * au premier rendu (pas le piège du hook Framer côté web, qui démarrait à
 * `false` et laissait passer un cadre de translation — D1 §11).
 *
 * Contrat d'usage (identique au web) : sous réduction, AUCUNE translation ni
 * échelle — les apparitions deviennent des fondus < 100 ms, les feuilles
 * s'ouvrent en opacité.
 */
export function usePrefersReducedMotion(): boolean {
  return useReducedMotion()
}
