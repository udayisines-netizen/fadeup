import { Link, Navigate, Outlet, useNavigate } from 'react-router-dom'
import { CurrentOrgProvider, useCurrentOrg } from '@/lib/current-org-context'
import { getSupabaseClient } from '@/lib/supabase'
import { PageSpinner } from '@/components/ui/spinner'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { Navbar } from '@/components/ui/navbar'
import { AppNavLink } from '@/components/ui/nav-link'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { useBookingRequests } from '@/lib/queries/booking-requests'
import { cn } from '@/lib/cn'

const MANAGING_ROLES = new Set(['owner', 'manager'])
/** Front-of-house: the roles that may answer a booking request. Mirrors private.can_manage_appointments. */
const DECIDING_ROLES = new Set(['owner', 'manager', 'receptionist'])

/** Layout for everything under /app: current-org context, top nav, sign-out. */
export function AppLayout() {
  return (
    <CurrentOrgProvider>
      <AppShell />
    </CurrentOrgProvider>
  )
}

function AppShell() {
  const navigate = useNavigate()
  const { membershipsQuery, memberships, currentMembership } = useCurrentOrg()

  const canManageTeam = currentMembership ? MANAGING_ROLES.has(currentMembership.role) : false
  const canDecideBookings = currentMembership ? DECIDING_ROLES.has(currentMembership.role) : false

  // Subscribed at the LAYOUT, so a request arriving while staff are on the
  // queue or the services screen still lights the badge. This is the only
  // reason anyone would know to open the inbox.
  //
  // Called BEFORE the early returns below. It used to sit after them, which
  // meant React saw a different number of hooks once memberships finished
  // loading — the "rendered more hooks than during the previous render" crash,
  // reached on every cold load that actually showed the pending state.
  const requestsQuery = useBookingRequests(canDecideBookings ? currentMembership?.organizationId : undefined)
  const pendingCount = requestsQuery.data?.length ?? 0

  if (membershipsQuery.isPending) {
    return <PageSpinner label="Loading your organizations…" />
  }

  if (membershipsQuery.isError) {
    return (
      <div className="flex min-h-svh items-center justify-center p-8">
        <Container size="sm">
          <Alert variant="error">
            Couldn&apos;t load your organizations: {membershipsQuery.error.message}
          </Alert>
          <Button className="mt-4" onClick={() => void membershipsQuery.refetch()}>
            Try again
          </Button>
        </Container>
      </div>
    )
  }

  if (memberships.length === 0) {
    // /workspace re-resolves from scratch (platform role, signup intent for
    // a customer account, ...) instead of assuming "zero memberships" only
    // ever means "go create a shop" — see workspace-selector-page.tsx.
    return <Navigate to="/workspace" replace />
  }

  async function handleSignOut() {
    const supabase = getSupabaseClient()
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-svh bg-paper-50">
      <Navbar
        brand={
          <Link to="/app" className="text-base font-semibold text-ink-950">
            FadeUp
          </Link>
        }
        links={
          <>
            <AppNavLink to="/app" end>
              Home
            </AppNavLink>
            {canDecideBookings ? (
              <AppNavLink to="/app/requests">
                <span className="inline-flex items-center gap-1.5">
                  Requests
                  {pendingCount > 0 ? (
                    <span
                      className={cn(
                        'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5',
                        'bg-accent-600 text-xs font-semibold text-on-accent',
                      )}
                    >
                      {pendingCount > 9 ? '9+' : pendingCount}
                    </span>
                  ) : null}
                </span>
              </AppNavLink>
            ) : null}
            <AppNavLink to="/app/calendar">Calendar</AppNavLink>
            <AppNavLink to="/app/appointments">Schedule</AppNavLink>
            <AppNavLink to="/app/queue">Queue</AppNavLink>
            <AppNavLink to="/app/waitlist">Waitlist</AppNavLink>
            <AppNavLink to="/app/customers">Customers</AppNavLink>
            <AppNavLink to="/app/memberships">Memberships</AppNavLink>
            <AppNavLink to="/app/locations">Locations</AppNavLink>
            <AppNavLink to="/app/chairs">Chairs</AppNavLink>
            <AppNavLink to="/app/services">Services</AppNavLink>
            <AppNavLink to="/app/availability">Availability</AppNavLink>
            {canManageTeam ? <AppNavLink to="/app/team">Team</AppNavLink> : null}
          </>
        }
        actions={
          <>
            {currentMembership ? (
              <span className="min-w-0 truncate text-sm text-ink-500">
                {currentMembership.organizationName}
              </span>
            ) : null}
            <NotificationBell />
            <LanguageSwitcher />
            <ThemeToggle />
            <Button variant="secondary" onClick={() => void handleSignOut()}>
              Sign out
            </Button>
          </>
        }
      />
      <Outlet />
    </div>
  )
}
