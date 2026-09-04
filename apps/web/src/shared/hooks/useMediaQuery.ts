import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    const media = window.matchMedia(query)
    setMatches(media.matches)
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches)
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [query])

  return matches
}

/** Breakpoint helpers aligned on the responsive ruptures (MASTER_SPEC §19). */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)')
}

export function useIsWideDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)')
}
