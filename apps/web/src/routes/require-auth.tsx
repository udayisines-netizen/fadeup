import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth-context'
import { PageSpinner } from '@/components/ui/spinner'

interface RequireAuthProps {
  children: ReactNode
  /**
   * Where to send an unauthenticated visitor. Defaults to /login, which is
   * the customer sign-in; pass /pro/login for professional routes and
   * /platform/login for platform staff so the form matches the context.
   */
  loginPath?: string
}

/** Redirects to loginPath?redirect=<here> when there is no authenticated session. */
export function RequireAuth({ children, loginPath = '/login' }: RequireAuthProps) {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <PageSpinner label="Checking your session" />
  }

  if (!session) {
    const redirectTarget = `${location.pathname}${location.search}`
    return <Navigate to={`${loginPath}?redirect=${encodeURIComponent(redirectTarget)}`} replace />
  }

  return <>{children}</>
}
