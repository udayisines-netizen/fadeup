import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { isDemoEnabled } from '@/shared/lib/env'

/**
 * /demo n'existe que si `VITE_ENABLE_DEMO=true` (jamais en production), et
 * porte `noindex, nofollow` — la surface est réelle mais n'est référencée
 * nulle part.
 */
export function RequireDemo() {
  const enabled = isDemoEnabled()

  useEffect(() => {
    if (!enabled) return
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => {
      document.head.removeChild(meta)
    }
  }, [enabled])

  if (!enabled) return <Navigate to="/" replace />

  return <Outlet />
}
