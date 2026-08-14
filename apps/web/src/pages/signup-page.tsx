import { Navigate, useLocation } from 'react-router-dom'

/**
 * /signup is a compatibility redirect. It used to point at /pro/signup, back
 * when /login was the professional entrance; now that /login and /register
 * are the customer routes, the generic "sign up" URL belongs with them.
 */
export function SignupPage() {
  const location = useLocation()
  return <Navigate to={`/register${location.search}`} replace />
}
