import { Link, NavLink, Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import { House, CalendarDays, Compass, IdCard, CircleUserRound } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { usePendingClaimRedemption } from '@/lib/use-pending-claim'

/**
 * Shell for the logged-in Customer App (/app/customer/*). Deliberately NOT
 * AppLayout's top horizontal nav bar — that reads as an operator dashboard
 * (spec: "Do not make it look or behave like the Owner dashboard... should
 * feel like a consumer mobile application"). A sticky bottom tab bar is the
 * primary navigation instead, the standard consumer-app pattern, with only
 * a slim identity/settings strip up top.
 *
 * Queue has no tab of its own: active queue state is contextual (Home
 * surfaces it prominently when real), a persistent tab would usually be
 * empty. Favorites lives inside Profile (spec: "whether as a dedicated view
 * or within Discover/Profile... do not create unnecessary navigation
 * items").
 */
export function CustomerAppLayout() {
  // Runs here rather than on any one page: a customer arriving from the
  // booking success screen may land on Home, Onboarding, or Appointments
  // depending on their redirect, and the appointment they just booked must
  // attach to their new account in all of those cases.
  usePendingClaimRedemption()

  return (
    <div className="flex min-h-svh flex-col bg-paper-50">
      <TopStrip />
      <main className="flex-1 pb-20">
        <Outlet />
      </main>
      <BottomTabs />
    </div>
  )
}

function TopStrip() {
  return (
    <header className="border-b border-border bg-paper-0">
      <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
        <Link to="/app/customer" className="text-sm font-semibold tracking-tight text-ink-950">
          FadeUp
        </Link>
        <div className="flex items-center gap-1.5">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

function BottomTabs() {
  return (
    <nav
      aria-label="Customer app navigation"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-paper-0/95 backdrop-blur supports-[backdrop-filter]:bg-paper-0/80"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around">
        <TabLink to="/app/customer" end icon={<House className="h-5 w-5" aria-hidden="true" />} label="Home" />
        <TabLink to="/app/customer/appointments" icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />} label="Appointments" />
        <TabLink to="/search" icon={<Compass className="h-5 w-5" aria-hidden="true" />} label="Discover" />
        <TabLink to="/app/customer/passport" icon={<IdCard className="h-5 w-5" aria-hidden="true" />} label="Passport" />
        <TabLink to="/app/customer/profile" icon={<CircleUserRound className="h-5 w-5" aria-hidden="true" />} label="Profile" />
      </div>
    </nav>
  )
}

function TabLink({ to, end, icon, label }: { to: string; end?: boolean; icon: ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex min-h-16 flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-medium transition-colors',
          isActive ? 'text-accent-700' : 'text-ink-500 hover:text-ink-800',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span aria-hidden="true">{icon}</span>
          <span>{label}</span>
          {isActive ? <span className="sr-only"> (current)</span> : null}
        </>
      )}
    </NavLink>
  )
}
