import { useMemo, useState } from 'react'
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Home, ListOrdered, Plus, Users } from 'lucide-react'
import { CurrentOrgProvider, useCurrentOrg } from '@/lib/current-org-context'
import { useAuth } from '@/lib/auth-context'
import { useBookingRequests } from '@/lib/queries/booking-requests'
import { useOrgQueue } from '@/lib/queries/queue'
import { useOrgLocations } from '@/lib/queries/locations'
import { ProSidebar } from '@/components/pro/pro-sidebar'
import { ProTopbar } from '@/components/pro/pro-topbar'
import { CommandMenu } from '@/components/pro/command-menu'
import { QuickActionSheet } from '@/components/pro/quick-action-sheet'
import { TabBar, type TabItem } from '@/components/ui/tab-bar'
import { PageSpinner } from '@/components/ui/spinner'
import { ErrorState } from '@/components/ui/error-state'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { cn } from '@/lib/cn'

/**
 * The Professional application shell.
 *
 * TWO SHELLS, NOT ONE RESPONSIVE SHELL. Desktop gets a persistent sidebar and
 * a command bar; mobile gets a tab bar and a raised action. They are composed
 * from the same data but they are not the same layout squeezed — a sidebar
 * collapsed into a drawer on a phone means every navigation costs two taps,
 * and the reference is explicit that the phone should feel native.
 *
 * `data-fu-pro` is what turns the whole subtree dark. Every shared primitive
 * below it resolves its tokens to the Professional palette without knowing it
 * exists, which is why V2 needed no parallel component library.
 */
export function ProShell() {
  return (
    <CurrentOrgProvider>
      <ProShellInner />
    </CurrentOrgProvider>
  )
}

function ProShellInner() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { membershipsQuery, memberships, currentMembership, setCurrentOrganizationId } = useCurrentOrg()

  const [commandOpen, setCommandOpen] = useState(false)
  const [quickActionOpen, setQuickActionOpen] = useState(false)

  const organizationId = currentMembership?.organizationId
  const role = currentMembership?.role

  // Hooks before any early return — the shell renders a spinner and an error
  // state, and a conditional hook here was a real crash in a previous lot.
  const canDecide = role === 'owner' || role === 'manager' || role === 'receptionist'
  const requestsQuery = useBookingRequests(canDecide ? organizationId : undefined)
  const queueQuery = useOrgQueue(organizationId)
  const locationsQuery = useOrgLocations(organizationId)

  const pendingRequests = requestsQuery.data?.length ?? 0
  const queueWaiting = useMemo(
    () => (queueQuery.data ?? []).filter((entry) => entry.status === 'waiting').length,
    [queueQuery.data],
  )

  const locationLabel = useMemo(() => {
    const locations = locationsQuery.data ?? []
    if (locations.length === 0) return null
    if (locations.length === 1) return [locations[0].city, locations[0].country].filter(Boolean).join(', ') || null
    return t('app:nav.locationCount', { count: locations.length })
  }, [locationsQuery.data, t])

  const tabs: TabItem[] = useMemo(
    () => [
      { to: '/app', label: t('app:nav.home'), icon: Home, end: true },
      { to: '/app/calendar', label: t('app:nav.calendar'), icon: CalendarDays },
      { to: '/app/queue', label: t('app:nav.queue'), icon: ListOrdered, badge: queueWaiting },
      { to: '/app/customers', label: t('app:nav.customers'), icon: Users },
    ],
    [t, queueWaiting],
  )

  if (membershipsQuery.isPending) {
    return <PageSpinner label={t('common:nav.loadingYourOrganizations')} />
  }

  if (membershipsQuery.isError) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <Container size="sm">
          <ErrorState
            title={t('app:nav.couldntLoadOrganizations')}
            description={membershipsQuery.error.message}
            action={<Button onClick={() => void membershipsQuery.refetch()}>{t('common:action.tryAgain')}</Button>}
          />
        </Container>
      </div>
    )
  }

  // Zero memberships is not necessarily "go create a shop" — the user may hold
  // a platform role or have signed up as a customer. /workspace re-resolves.
  if (memberships.length === 0 || !currentMembership || !role) {
    return <Navigate to="/workspace" replace />
  }

  return (
    <div data-fu-pro className="min-h-svh bg-paper-50 text-ink-950">
      <div className="flex">
        {/* Desktop navigation. Sticky rather than fixed so the sidebar scrolls
            its own overflow without the content area inheriting the offset. */}
        <ProSidebar
          role={role}
          organizationName={currentMembership.organizationName}
          organizationSlug={currentMembership.organizationSlug}
          locationLabel={locationLabel}
          pendingRequests={pendingRequests}
          queueWaiting={queueWaiting}
          className="sticky top-0 hidden lg:flex"
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <ProTopbar
            memberships={memberships}
            currentMembership={currentMembership}
            onSelectOrganization={setCurrentOrganizationId}
            onOpenSearch={() => setCommandOpen(true)}
            userName={user?.email ?? currentMembership.organizationName}
          />

          {/*
            THE SHELL OWNS THE MEASURE.
            Every page used to wrap itself in its own Container at its own
            size — lg here, md there, xl on the calendar — which produced a
            different text column and a different left edge on every screen,
            plus doubled padding at 375px. That inconsistency is most of why
            V1 read as a set of screens rather than one application.

            The cap is generous rather than a reading measure: this is an
            operations console with tables and a calendar grid, and the pages
            that genuinely want a narrower column (Team, a barber's own
            workspace) constrain themselves inside it.

            Bottom padding clears the mobile tab bar; removed once the sidebar
            takes over at lg.
          */}
          <main className={cn('mx-auto w-full min-w-0 max-w-[100rem] flex-1 px-4 pb-24 pt-5 sm:px-6 lg:pb-8')}>
            <Outlet />
          </main>
        </div>
      </div>

      <TabBar
        ariaLabel={t('app:nav.primary')}
        items={tabs}
        className="lg:hidden"
        centerAction={
          <button
            type="button"
            onClick={() => setQuickActionOpen(true)}
            aria-label={t('app:nav.quickAction')}
            className={cn(
              'flex h-14 w-14 items-center justify-center rounded-full bg-accent-600 text-on-accent shadow-md',
              'ring-4 ring-paper-0 transition-transform duration-[--fu-duration-quick] active:scale-95',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 motion-reduce:transition-none',
            )}
          >
            <Plus className="h-6 w-6" aria-hidden="true" />
          </button>
        }
      />

      <CommandMenu
        open={commandOpen}
        onOpenChange={setCommandOpen}
        organizationId={organizationId}
        role={role}
        pendingRequests={pendingRequests}
      />

      <QuickActionSheet
        open={quickActionOpen}
        onOpenChange={setQuickActionOpen}
        onNavigate={(to) => {
          setQuickActionOpen(false)
          navigate(to)
        }}
      />
    </div>
  )
}
