import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { ErrorBoundary } from '@/components/error-boundary'
import { ToastProvider } from '@/components/ui/toast'
import { PreferencesSync } from '@/components/preferences-sync'
import { AuthProvider } from '@/lib/auth-context'
import { ThemeProvider } from '@/lib/theme'
import { queryClient } from '@/lib/query-client'
import { router } from '@/routes/router'

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <PreferencesSync />
              <RouterProvider router={router} />
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

export default App
