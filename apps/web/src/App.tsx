import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { ErrorBoundary } from '@/components/error-boundary'
import { ToastProvider } from '@/components/ui/toast'
import { PreferencesSync } from '@/components/preferences-sync'
import { AuthProvider } from '@/lib/auth-context'
import { ThemeProvider } from '@/lib/theme'
import { PricingProvider } from '@/lib/commerce/pricing-context'
import { AnalyticsProvider } from '@/lib/analytics'
import { queryClient } from '@/lib/query-client'
import { router } from '@/routes/router'

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            {/*
              Commercial region is resolved once, app-wide, and deliberately
              separately from language — see lib/commerce/pricing-context.
            */}
            <PricingProvider>
              {/*
                Inside AuthProvider because the analytics origin follows the
                session (public_web vs customer_web), and outside the router so
                one client instance survives navigation — a per-route client
                would reset the throttle that stops a back-navigation
                re-reporting a view it already reported.
              */}
              <AnalyticsProvider>
                <ToastProvider>
                  <PreferencesSync />
                  <RouterProvider router={router} />
                </ToastProvider>
              </AnalyticsProvider>
            </PricingProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

export default App
