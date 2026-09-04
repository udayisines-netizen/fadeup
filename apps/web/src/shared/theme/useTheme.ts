import { useContext, useEffect } from 'react'
import { SurfaceThemeContext, type SurfaceTheme } from '@/shared/theme/ThemeProvider'

export function useTheme() {
  const ctx = useContext(SurfaceThemeContext)
  if (!ctx) throw new Error('useTheme must be used within the V2 ThemeProvider')
  return ctx
}

/**
 * Declares the surface theme of the mounting shell. On unmount the theme is
 * cleared, so a navigation into the legacy /platform tree (which has no V2
 * shell) leaves <body> attribute-free and the legacy tokens in charge.
 */
export function useApplySurfaceTheme(theme: SurfaceTheme): void {
  const { setSurface } = useTheme()
  useEffect(() => {
    setSurface(theme)
    return () => setSurface(null)
  }, [theme, setSurface])
}
