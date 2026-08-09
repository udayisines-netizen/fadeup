import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth-context'
import { PageSpinner } from '@/components/ui/spinner'

interface RequireAuthProps {
  children: ReactNode
}

/** Redirects to /login?redirect=<here> when there is no authenticated session. */
export function RequireAuth({ children }: RequireAuthProps) {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <PageSpinner label="Checking your session" />
  }

  if (!session) {
    const redirectTarget = `${location.pathname}${location.search}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirectTarget)}`} replace />
  }

  return <>{children}</>
}
