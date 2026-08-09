import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { CurrentOrgProvider, useCurrentOrg } from '@/lib/current-org-context'
import { getSupabaseClient } from '@/lib/supabase'
import { PageSpinner } from '@/components/ui/spinner'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'

const MANAGING_ROLES = new Set(['owner', 'manager'])

function navLinkClassName({ isActive }: { isActive: boolean }): string {
  return cn(
    'rounded-md px-3 py-2 text-sm font-medium',
    isActive ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100',
  )
}

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
    return <PageSpinner label="Loading your organizations" />
  }

  if (membershipsQuery.isError) {
    return (
      <div className="flex min-h-svh items-center justify-center p-8">
        <div className="max-w-sm">
          <Alert variant="error">
            Couldn&apos;t load your organizations: {membershipsQuery.error.message}
          </Alert>
          <Button className="mt-4" onClick={() => void membershipsQuery.refetch()}>
            Try again
          </Button>
        </div>
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
    <div className="min-h-svh bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-6">
            <NavLink to="/app" end className="text-base font-semibold text-neutral-900">
              FadeUp
            </NavLink>
            <nav className="flex items-center gap-1">
              <NavLink to="/app" end className={navLinkClassName}>
                Home
              </NavLink>
              {canManageTeam ? (
                <NavLink to="/app/team" className={navLinkClassName}>
                  Team
                </NavLink>
              ) : null}
            </nav>
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            {currentMembership ? (
              <span className="truncate text-sm text-neutral-500">
                {currentMembership.organizationName}
              </span>
            ) : null}
            <Button variant="secondary" onClick={() => void handleSignOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
