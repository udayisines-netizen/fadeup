import { Link, Navigate, Outlet, useNavigate } from 'react-router-dom'
import { CurrentOrgProvider, useCurrentOrg } from '@/lib/current-org-context'
import { getSupabaseClient } from '@/lib/supabase'
import { PageSpinner } from '@/components/ui/spinner'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { Navbar } from '@/components/ui/navbar'
import { AppNavLink } from '@/components/ui/nav-link'

const MANAGING_ROLES = new Set(['owner', 'manager'])

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
    return <Navigate to="/onboarding" replace />
  }

  async function handleSignOut() {
    const supabase = getSupabaseClient()
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  const canManageTeam = currentMembership ? MANAGING_ROLES.has(currentMembership.role) : false

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
