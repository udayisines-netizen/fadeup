import { Navigate, useLocation } from 'react-router-dom'

/**
 * /login is a compatibility redirect, not a distinct entry point — the
 * canonical URL is /pro/login (CLAUDE.md section 15/16: customer, pro and
 * platform each get their own entry point). Kept so existing links/
 * bookmarks (and every other page in this app that links to "/login" as
 * the generic "sign in" destination — invite-page.tsx, marketing nav
 * before it's updated per-context, etc.) keep working.
 */
export function LoginPage() {
  const location = useLocation()
  return <Navigate to={`/pro/login${location.search}`} replace />
}
