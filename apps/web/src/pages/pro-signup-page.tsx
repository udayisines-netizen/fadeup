import { Navigate, useLocation } from 'react-router-dom'

/**
 * /pro/signup is a compatibility redirect to /pro/register. The rename is
 * deliberate: what happens there is an APPLICATION to join FadeUp, reviewed
 * by a human, not a self-serve signup that hands over a workspace.
 */
export function ProSignupPage() {
  const location = useLocation()
  return <Navigate to={`/pro/register${location.search}`} replace />
}
