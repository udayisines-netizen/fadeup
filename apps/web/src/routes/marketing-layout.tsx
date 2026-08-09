import { Outlet } from 'react-router-dom'
import { MarketingHeader } from '@/components/marketing/marketing-header'
import { MarketingFooter } from '@/components/marketing/marketing-footer'

/**
 * Shared chrome for the public marketing site (`/`, `/features`, `/pricing`)
 * — kept as its own layout route (nested under `RootLayout`, alongside but
 * separate from the auth and `/app` routes) so this nav/footer never leaks
 * into `/login`, `/signup`, `/forgot-password`, `/reset-password`,
 * `/invite/:token` or anything under `/app`.
 */
export function MarketingLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-paper-0">
      <MarketingHeader />
      <Outlet />
      <MarketingFooter />
    </div>
  )
}
