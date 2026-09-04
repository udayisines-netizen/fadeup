import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * The three V2 surface themes (P1b §5). Values map 1:1 to the
 * `[data-theme="…"]` selectors in src/styles/tokens-*.css.
 *
 * The attribute lives on <body>, deliberately NOT on <html>: the retained
 * /platform surface keeps its own light/dark `data-theme` on <html>
 * (src/lib/theme.tsx + the index.html bootstrap), and the two systems must
 * never fight over one attribute. Radix portals mount into <body>, so a
 * body-level attribute still themes every overlay.
 */
export type SurfaceTheme = 'consumer' | 'pro' | 'editorial'

interface SurfaceThemeContextValue {
  surface: SurfaceTheme | null
  /** Used by shells (via useApplySurfaceTheme) and by /dev/ui's switcher. */
  setSurface: (surface: SurfaceTheme | null) => void
}

export const SurfaceThemeContext = createContext<SurfaceThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [surface, setSurfaceState] = useState<SurfaceTheme | null>(null)

  const setSurface = useCallback((next: SurfaceTheme | null) => {
    setSurfaceState(next)
  }, [])

  useEffect(() => {
    if (surface) {
      document.body.setAttribute('data-theme', surface)
    } else {
      document.body.removeAttribute('data-theme')
    }
  }, [surface])

  const value = useMemo(() => ({ surface, setSurface }), [surface, setSurface])

  return <SurfaceThemeContext.Provider value={value}>{children}</SurfaceThemeContext.Provider>
}
