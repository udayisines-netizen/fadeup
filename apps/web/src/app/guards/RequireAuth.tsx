import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useSession } from '@/shared/hooks/useSession'
import { Spinner } from '@/shared/ui/Spinner'

/**
 * Garde d'authentification V2. Pas de session → /auth/login, en mémorisant
 * la destination pour y revenir après connexion.
 */
export function RequireAuth() {
  const { session, loading } = useSession()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner size="lg" announce />
      </div>
    )
  }

  if (!session) {
    const redirect = `${location.pathname}${location.search}`
    return <Navigate to={`/auth/login?redirect=${encodeURIComponent(redirect)}`} replace />
  }

  return <Outlet />
}
