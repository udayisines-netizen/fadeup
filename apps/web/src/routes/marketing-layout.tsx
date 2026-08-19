import { Outlet, useLocation } from 'react-router-dom'
import { MarketingHeader } from '@/components/marketing/marketing-header'
import { MarketingFooter } from '@/components/marketing/marketing-footer'

/**
 * Shared chrome for the public marketing site (`/`, `/search`, `/features`,
 * `/pricing`, `/for-business`) — kept as its own layout route (nested under
 * `RootLayout`, alongside but separate from the auth and `/app` routes) so this
 * nav/footer never leaks into `/login`, `/signup`, `/forgot-password`,
 * `/reset-password`, `/invite/:token` or anything under `/app`.
 *
 * `/for-business` runs in FadeUp's dark professional environment while every
 * other marketing route stays in the light consumer one. Rather than fork the
 * header and footer, the wrapper carries `data-pro-marketing` on that one
 * route: the scoped rules in index.css redefine what the product tokens mean
 * inside it, so the same header/footer markup renders dark here and light
 * everywhere else. Nothing about their links, routes or behaviour changes.
 */
export function MarketingLayout() {
  const { pathname } = useLocation()
  const professional = pathname === '/for-business'

  return (
    <div
      data-pro-marketing={professional ? '' : undefined}
      className="flex min-h-svh flex-col bg-paper-0"
    >
      <MarketingHeader />
      <Outlet />
      <MarketingFooter />
    </div>
  )
}
