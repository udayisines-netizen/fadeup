import { lazy, Suspense, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ErrorBoundary } from '@/components/error-boundary'
import { ToastProvider } from '@/components/ui/toast'
import { PreferencesSync } from '@/components/preferences-sync'
import { AuthProvider } from '@/lib/auth-context'
import { ThemeProvider as LegacyThemeProvider } from '@/lib/theme'
import { PricingProvider } from '@/lib/commerce/pricing-context'
import { AnalyticsProvider } from '@/lib/analytics'
import { queryClient } from '@/shared/data/queryClient'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'
import { RealtimeProvider } from '@/shared/realtime/RealtimeProvider'
import { V2ToastProvider } from '@/shared/ui/Toast'

/**
 * Composition racine (P1b §4) : Query → i18n (v2 bundles) → thèmes → auth →
 * toasts → realtime.
 *
 * Les providers legacy restent montés À DESSEIN : la console /platform en
 * production consomme auth-context, theme (light/dark sur <html>), pricing,
 * analytics et le toast legacy. Les providers V2 s'y superposent sans les
 * remplacer — un seul QueryClient (shared/data), un seul client Supabase,
 * deux systèmes de thème sur deux éléments distincts (<html> legacy,
 * <body> V2). Les bundles i18n v2 sont enregistrés par main.tsx, après
 * l'init i18next.
 */

// Le bouton flottant des devtools déborde du viewport mobile et polluerait
// les études /demo (captures QA, mesure de débordement) — il reste partout
// ailleurs en DEV.
const ReactQueryDevtools =
  import.meta.env.DEV && !window.location.pathname.startsWith('/demo')
    ? lazy(() =>
        import('@tanstack/react-query-devtools').then((mod) => ({ default: mod.ReactQueryDevtools })),
      )
    : null

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LegacyThemeProvider>
          <ThemeProvider>
            <AuthProvider>
              <PricingProvider>
                <AnalyticsProvider>
                  <ToastProvider>
                    <V2ToastProvider>
                      <RealtimeProvider>
                        <PreferencesSync />
                        {children}
                        {ReactQueryDevtools && (
                          <Suspense fallback={null}>
                            <ReactQueryDevtools initialIsOpen={false} />
                          </Suspense>
                        )}
                      </RealtimeProvider>
                    </V2ToastProvider>
                  </ToastProvider>
                </AnalyticsProvider>
              </PricingProvider>
            </AuthProvider>
          </ThemeProvider>
        </LegacyThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
