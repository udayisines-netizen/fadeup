import { useMediaQuery } from '@/shared/hooks/useMediaQuery'

/** True when the OS asks for reduced motion — translations and scales are then forbidden. */
export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}
