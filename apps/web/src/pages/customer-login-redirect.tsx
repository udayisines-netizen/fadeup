import { Navigate, useLocation } from 'react-router-dom'

/**
 * /customer/login and /customer/signup are compatibility redirects — the
 * canonical customer entry points are now /login and /register (the brief's
 * route architecture). Plenty of places already link to the old paths
 * (FavoriteButton's signed-out state, RequireAuth's loginPath, the customer
 * profile sign-out), and external bookmarks exist, so both keep working
 * rather than 404ing.
 */
export function CustomerLoginRedirect() {
  const location = useLocation()
  return <Navigate to={`/login${location.search}`} replace />
}

export function CustomerSignupRedirect() {
  const location = useLocation()
  return <Navigate to={`/register${location.search}`} replace />
}
