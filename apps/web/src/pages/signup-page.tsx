import { Navigate, useLocation } from 'react-router-dom'

/**
 * /signup is a compatibility redirect — the canonical URL is /pro/signup.
 * See login-page.tsx for the same reasoning.
 */
export function SignupPage() {
  const location = useLocation()
  return <Navigate to={`/pro/signup${location.search}`} replace />
}
