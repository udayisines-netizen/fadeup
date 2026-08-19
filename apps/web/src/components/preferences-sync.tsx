import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth-context'
import { useOwnProfilePreferences } from '@/lib/queries/profile'
import { useTheme } from '@/lib/theme'
import { changeLocale } from '@/i18n'
import { detectLocale, getDetectedLocale, getExplicitLocale, normalizeLocale } from '@/lib/locale'

/**
 * Applies an authenticated user's stored locale/theme preference once it
 * loads. Renders nothing. Mounted once near the app root, inside both
 * AuthProvider and ThemeProvider.
 *
 * Priority this respects (see FADEUP master prompt, locale resolution):
 * explicit in-session selection > profile preference > geo/browser default.
 * Theme has no separate "explicit" flag — per spec, an authenticated
 * profile theme always wins once loaded, since there is no lower-priority
 * signal it could be overriding other than the anonymous localStorage
 * default.
 */
export function PreferencesSync() {
  const { user } = useAuth()
  const { data: preferences } = useOwnProfilePreferences(user?.id)
  const { theme, setTheme } = useTheme()
  const { i18n } = useTranslation()

  useEffect(() => {
    if (!preferences?.theme) return
    if (preferences.theme === theme) return
    if (preferences.theme === 'light' || preferences.theme === 'dark' || preferences.theme === 'system') {
      setTheme(preferences.theme)
    }
    // Only re-run when the fetched preference changes — applying `theme`
    // itself as a dependency would fight the user's own later toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences?.theme])

  useEffect(() => {
    const profileLocale = normalizeLocale(preferences?.locale)
    if (!profileLocale) return
    if (getExplicitLocale()) return
    if (profileLocale === i18n.language) return
    void changeLocale(profileLocale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences?.locale])

  /**
   * GeoIP, once, on a genuinely first visit.
   *
   * Runs only when nothing better exists: no explicit choice, no cached
   * detection from a previous visit, and no account preference. That makes it
   * at most one request in a device's lifetime per 24h cache window — the
   * detection endpoint was previously never called at all, so "GeoIP" was a
   * label on a browser-language read.
   *
   * The explicit check is repeated INSIDE the callback on purpose. The lookup
   * is a network round trip, and a visitor can reach for the language switcher
   * while it is in flight; applying a stale suggestion over a choice they just
   * made is the single most annoying thing an i18n system can do.
   */
  useEffect(() => {
    if (getExplicitLocale() || getDetectedLocale()) return
    if (normalizeLocale(preferences?.locale)) return

    let cancelled = false
    void detectLocale().then((locale) => {
      if (cancelled) return
      if (getExplicitLocale()) return
      if (locale === i18n.language) return
      void changeLocale(locale)
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences?.locale])

  return null
}
