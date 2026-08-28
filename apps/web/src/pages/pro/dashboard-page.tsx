import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  CalendarCheck2,
  CalendarDays,
  Check,
  Inbox,
  LayoutGrid,
  PieChart,
  UserX,
  WifiOff,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useCurrentOrg } from '@/lib/current-org-context'
import { useOrgLocations } from '@/lib/queries/locations'
import { useOrgCustomers } from '@/lib/queries/customers'
import { useOrganizationAnalyticsSummary } from '@/lib/queries/analytics-summary'
import {
  canEditDashboardLayout,
  useDashboardLayout,
  useSaveDashboardLayout,
  type DashboardModule,
} from '@/lib/queries/dashboard-layout'
import { useOrgQueue } from '@/lib/queries/queue'
import { useBookingRequests } from '@/lib/queries/booking-requests'
import {
  calendarErrorMessage,
  useCalendarRange,
  useCompleteAppointment,
  type CalendarAppointment,
  type TimeBlock,
} from '@/lib/queries/calendar'
import { bookableProfessionals, useCalendarProfessionals } from '@/lib/calendar/professionals'
import { rangeForDays, todayInZone } from '@/lib/calendar/time'
import { NowCard } from '@/components/pro/now-card'
import { NextCard } from '@/components/pro/next-card'
import { TodayFlow } from '@/components/pro/today-flow'
import { QueuePanel } from '@/components/pro/queue-panel'
import { DashboardGrid } from '@/components/pro/dashboard-grid'
import { SocialPerformancePanel } from '@/components/pro/social-performance-panel'
import { CustomersPanel } from '@/components/pro/customers-panel'
import { AppointmentSheet } from '@/components/calendar/appointment-sheet'
import { TimeBlockSheet } from '@/components/calendar/time-block-dialog'
import { PageHeader, Panel } from '@/components/ui/page-header'
import { Metric, MetricStrip } from '@/components/ui/metric'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { useToast } from '@/components/ui/toast'
import { useDateTime, useMoney, useOrganizationCurrency } from '@/lib/intl/use-intl'
import { cn } from '@/lib/cn'
import type { MembershipRole } from '@/lib/types'

const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager', 'receptionist'])

/**
 * `/app` — the Professional command centre.
 *
 * The composition is asymmetric on purpose. Four equal cards in a grid is what
 * an admin panel looks like; a dominant NOW beside a narrower NEXT, over a
 * quiet metric strip, over two operational panels, is what a tool looks like.
 * The reference makes the same choice and it is the difference between the two
 * readings of this screen.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 *   Revenue, month-to-date goals, "+18% vs yesterday", and ML insights. All
 *   four are in the reference and none exists in FadeUp: there are no
 *   payments, no goal model, no comparison query and no analytics engine.
 *   Booked VALUE is real and is shown; calling it revenue would be a
 *   different and false claim.
 *
 * WHOSE DAY IS IT? A professional sees their own chair; front-of-house sees
 * the whole floor. Same screen, filtered server-side by `barberId` — not
 * hidden client-side, which would fetch data the viewer should not need.
 */
export function ProDashboardPage() {
  const { currentMembership, membershipsQuery } = useCurrentOrg()

  if (membershipsQuery.isPending) {
    return <DashboardSkeleton />
  }
  if (!currentMembership) return null

  return (
    <Dashboard organizationId={currentMembership.organizationId} role={currentMembership.role} />
  )
}

function Dashboard({ organizationId, role }: { organizationId: string; role: MembershipRole }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { toast } = useToast()
  const dt = useDateTime()
  const money = useMoney()
  const currency = useOrganizationCurrency(organizationId)
  const canManage = MANAGING_ROLES.has(role)

  const locationsQuery = useOrgLocations(organizationId)
  const location = (locationsQuery.data ?? [])[0]
  const timeZone = location?.timezone ?? 'UTC'

  const { professionals, byBarberId } = useCalendarProfessionals(organizationId)
  const bookable = useMemo(() => bookableProfessionals(professionals), [professionals])
  const ownProfessional = useMemo(
    () => bookable.find((professional) => professional.userId === user?.id),
    [bookable, user?.id],
  )
  const focusBarberId = !canManage && ownProfessional ? ownProfessional.barberId : null

  const today = todayInZone(timeZone)
  const range = useMemo(() => rangeForDays(today, 1, timeZone), [today, timeZone])
  const calendar = useCalendarRange(organizationId, range, {
    locationId: location?.id ?? null,
    barberId: focusBarberId,
  })

  const queueQuery = useOrgQueue(organizationId)
  const requestsQuery = useBookingRequests(canManage ? organizationId : undefined)
  const completeAppointment = useCompleteAppointment(organizationId)

  const [selectedAppointment, setSelectedAppointment] = useState<CalendarAppointment | null>(null)
  const [selectedBlock, setSelectedBlock] = useState<TimeBlock | null>(null)

  const now = useMinuteClock()

  /**
   * One pass over the day producing everything the header and strip need.
   * Recomputed once a minute rather than on every render — the day is small,
   * but this also decides which appointment is "now", which must not lag.
   */
  const day = useMemo(() => {
    let current: CalendarAppointment | null = null
    let next: CalendarAppointment | null = null
    let completed = 0
    let noShows = 0
    let bookedMinutes = 0
    let bookedValueCents = 0
    let liveCount = 0
    const upcoming: CalendarAppointment[] = []

    for (const appointment of calendar.appointments) {
      if (appointment.status === 'completed') completed += 1
      if (appointment.status === 'no_show') noShows += 1

      const isLive = appointment.status === 'confirmed' || appointment.status === 'pending'
      const isDone = appointment.status === 'completed'

      if (isLive || isDone) {
        liveCount += 1
        bookedMinutes += Math.round(
          (new Date(appointment.endsAt).getTime() - new Date(appointment.startsAt).getTime()) / 60000,
        )
        bookedValueCents += appointment.priceCents ?? 0
      }

      if (!isLive) continue

      const start = new Date(appointment.startsAt).getTime()
      const end = new Date(appointment.endsAt).getTime()

      if (appointment.status === 'confirmed' && start <= now && end > now) {
        if (!current || start > new Date(current.startsAt).getTime()) current = appointment
      } else if (start > now) {
        upcoming.push(appointment)
      }
    }

    upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    next = upcoming.find((appointment) => appointment.status === 'confirmed') ?? upcoming[0] ?? null

    return { current, next, completed, noShows, bookedMinutes, bookedValueCents, liveCount, remaining: upcoming.length }
  }, [calendar.appointments, now])

  /**
   * Occupancy = booked minutes over the minutes the shop is actually open.
   *
   * Derived from the working window the day itself reveals, not from a
   * hardcoded eight hours: a shop open 09:00-19:00 with a lunch closure has a
   * different denominator from one open 10:00-16:00, and a percentage against
   * the wrong denominator is worse than no percentage.
   *
   * Returns null when the day has nothing in it — 0% occupancy on an empty
   * Monday is technically true and reads as a failure.
   */
  const occupancy = useMemo(() => {
    if (day.liveCount === 0) return null
    const professionalCount = focusBarberId ? 1 : Math.max(1, bookable.length)
    const instants = calendar.appointments.flatMap((appointment) => [
      new Date(appointment.startsAt).getTime(),
      new Date(appointment.endsAt).getTime(),
    ])
    if (instants.length === 0) return null
    const spanMinutes = Math.round((Math.max(...instants) - Math.min(...instants)) / 60000)
    if (spanMinutes <= 0) return null
    return Math.min(100, Math.round((day.bookedMinutes / (spanMinutes * professionalCount)) * 100))
  }, [calendar.appointments, day.bookedMinutes, day.liveCount, focusBarberId, bookable.length])

  const waiting = useMemo(
    () => (queueQuery.data ?? []).filter((entry) => entry.status === 'waiting'),
    [queueQuery.data],
  )
  const pendingRequests = requestsQuery.data?.length ?? 0

  const customersQuery = useOrgCustomers(canManage ? organizationId : undefined)

  /**
   * The analytics summary is owner/manager only — the RPC re-derives that in
   * its own body and refuses anyone else with 42501. `enabled` here is a UX
   * decision (do not fire a request that will be refused), never the boundary.
   */
  const analyticsQuery = useOrganizationAnalyticsSummary(organizationId, { enabled: canManage })

  /**
   * THE LAYOUT BELONGS TO THE SHOP (§24).
   *
   * `draftOrder` exists because rearranging is a MODE, not a stream of writes:
   * a drag or a keyboard move updates the draft, and leaving the mode saves it
   * once. Six writes for six nudges would be six chances of a failure the
   * person cannot connect to anything they did.
   */
  const layoutQuery = useDashboardLayout(organizationId)
  const saveLayout = useSaveDashboardLayout(organizationId)
  const canEditLayout = canEditDashboardLayout(role)
  const [editingLayout, setEditingLayout] = useState(false)
  const [draftOrder, setDraftOrder] = useState<DashboardModule[] | null>(null)
  const order = draftOrder ?? layoutQuery.data ?? []

  async function saveAndExitLayout() {
    const next = draftOrder
    setEditingLayout(false)
    setDraftOrder(null)
    if (!next) return
    try {
      await saveLayout.mutateAsync(next)
      toast({ title: t('app:dashboard.layoutSaved'), variant: 'success' })
    } catch {
      // The shop's arrangement did not change, so the honest thing is to say
      // so and let the query's own data win on the next render — NOT to keep
      // showing a draft the database refused.
      toast({ title: t('app:dashboard.layoutSaveFailed'), variant: 'error' })
      void layoutQuery.refetch()
    }
  }

  async function completeNow(appointment: CalendarAppointment) {
    try {
      await completeAppointment.mutateAsync(appointment.id)
      toast({ title: t('app:today.markedDone', { name: appointment.customerName }), variant: 'success' })
    } catch (cause) {
      toast({ title: calendarErrorMessage(cause), variant: 'error' })
    }
  }

  if (locationsQuery.isPending || calendar.isPending) return <DashboardSkeleton />

  if ((locationsQuery.data ?? []).length === 0) {
    return (
      <ErrorState
        title={t('app:today.finishSettingUpYourShop')}
        description={t('app:today.addALocationYourServices')}
        action={
          <Link to="/app/locations" className={buttonVariants()}>
            {t('app:today.addALocation')}
          </Link>
        }
      />
    )
  }

  if (calendar.isError) {
    return (
      <ErrorState
        title={t('app:today.couldntLoadToday')}
        description={t('app:today.yourAppointmentsAreSafeWe')}
        action={<Button onClick={calendar.refetch}>{t('common:action.tryAgain')}</Button>}
      />
    )
  }

  const greetingName = ownProfessional?.displayName ?? user?.email?.split('@')[0] ?? ''

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <PageHeader
        title={greetingName ? t('app:today.greeting', { name: greetingName }) : t('app:today.greetingPlain')}
        subtitle={
          <span className="inline-flex items-center gap-2">
            {dt.longDate(new Date(), timeZone)}
            {calendar.realtimeStatus !== 'live' ? (
              <span className="inline-flex items-center gap-1 text-ink-300">
                <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                {t('app:today.reconnecting')}
              </span>
            ) : null}
          </span>
        }
        actions={
          <>
            {/* Only rendered for a member who can actually save. This is a UI
                affordance, not the gate: RLS restricts the write to owner and
                manager, so a barber who reaches the mutation another way
                updates zero rows. */}
            {canEditLayout ? (
              editingLayout ? (
                <Button variant="secondary" onClick={() => void saveAndExitLayout()} isLoading={saveLayout.isPending}>
                  <Check className="h-4 w-4" aria-hidden="true" />
                  {t('app:dashboard.layoutDone')}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraftOrder(order as DashboardModule[])
                    setEditingLayout(true)
                  }}
                >
                  <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                  {t('app:dashboard.layoutEdit')}
                </Button>
              )
            ) : null}

            <Link to="/app/calendar?action=book" className={buttonVariants()}>
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              {t('app:quickAction.newBooking')}
            </Link>
          </>
        }
      />

      {/*
        ============================================================================
        SIX MODULES OVER ONE GRID
        ============================================================================

        §23 names the categories the first viewport must surface: Revenue,
        Appointments, Queue, Customers, Social performance. They are built
        here, passed to `DashboardGrid` as items, and ordered by whatever this
        SHOP saved — §24, not per staff member.

        The composition that used to be hardcoded (a dominant NOW beside a
        narrower NEXT, over a metric strip, over two panels) survives inside
        the `focus` and `metrics` modules. What changed is that their ORDER is
        no longer a decision this file makes on every shop's behalf.
      */}
      <DashboardGrid
        items={[
          {
            key: 'focus',
            label: t('app:dashboard.moduleFocus'),
            wide: true,
            content: (
              <div className="flex flex-col gap-4">
                {/* Asymmetric by design: NOW earns roughly two thirds. */}
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
                  {day.current ? (
                    <NowCard
                      appointment={day.current}
                      timeZone={timeZone}
                      onComplete={() => void completeNow(day.current!)}
                      onOpen={() => setSelectedAppointment(day.current)}
                      isCompleting={completeAppointment.isPending}
                      canComplete={canManage || Boolean(ownProfessional)}
                    />
                  ) : (
                    <IdleCard
                      title={day.next ? t('app:today.nobodyInChair') : t('app:today.nothingElseToday')}
                      description={day.next ? t('app:today.nextIsComing') : t('app:today.enjoyIt')}
                    />
                  )}

                  {day.next ? (
                    <NextCard
                      appointment={day.next}
                      timeZone={timeZone}
                      onOpen={() => setSelectedAppointment(day.next)}
                    />
                  ) : (
                    <IdleCard title={t('app:today.noNext')} description={t('app:today.noNextBody')} muted />
                  )}
                </div>

                {canManage && pendingRequests > 0 ? (
                  <Link
                    to="/app/requests"
                    data-fu-enter
                    className={cn(
                      'flex min-h-14 items-center gap-3 rounded-lg border border-warning-600/40 bg-warning-100 px-4 py-3',
                      'transition-colors hover:bg-warning-100/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700',
                    )}
                  >
                    <Inbox className="h-5 w-5 shrink-0 text-warning-700" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink-950">
                        {t('app:today.requestsWaiting', { count: pendingRequests })}
                      </span>
                      <span className="block text-xs text-ink-700">{t('app:today.theyHoldASlotUntil')}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-ink-700 rtl:rotate-180" aria-hidden="true" />
                  </Link>
                ) : null}
              </div>
            ),
          },
          {
            key: 'metrics',
            label: t('app:dashboard.moduleMetrics'),
            wide: true,
            content: (
              <MetricStrip>
                <Metric
                  icon={<CalendarCheck2 className="h-4 w-4" />}
                  value={day.liveCount}
                  label={t('app:today.kpiAppointments')}
                  context={day.remaining > 0 ? t('app:today.kpiRemaining', { count: day.remaining }) : undefined}
                />
                <Metric
                  icon={<PieChart className="h-4 w-4" />}
                  value={occupancy === null ? '—' : `${occupancy}%`}
                  label={t('app:today.kpiOccupancy')}
                  tone={occupancy === null ? 'quiet' : 'neutral'}
                />
                {/*
                  BOOKED VALUE, never "revenue". There are no payments in this
                  schema, so the sum of today's appointment prices is what was
                  agreed and not what was taken. Calling it revenue would be a
                  different and false claim on the one number an owner is most
                  likely to repeat out loud.
                */}
                <Metric
                  value={money(day.bookedValueCents, currency)}
                  label={t('app:today.kpiBookedValue')}
                  context={t('app:today.kpiBookedValueHint')}
                />
                <Metric
                  icon={<UserX className="h-4 w-4" />}
                  value={day.noShows}
                  label={t('app:today.kpiNoShows')}
                  tone={day.noShows === 0 ? 'quiet' : 'danger'}
                />
              </MetricStrip>
            ),
          },
          {
            key: 'today',
            label: t('app:dashboard.moduleToday'),
            content: (
              <Panel
                title={t('app:today.theWholeDay')}
                meta={t('app:today.flowMeta', { count: day.liveCount })}
                bodyClassName="p-2 sm:p-3"
                footer={
                  <Link to="/app/calendar" className={buttonVariants({ variant: 'secondary' }, 'w-full')}>
                    <CalendarDays className="h-4 w-4" aria-hidden="true" />
                    {t('app:today.openCalendar')}
                  </Link>
                }
              >
                <TodayFlow
                  appointments={calendar.appointments}
                  timeBlocks={calendar.timeBlocks}
                  timeZone={timeZone}
                  activeAppointmentId={day.current?.id ?? null}
                  onSelectAppointment={setSelectedAppointment}
                  onSelectBlock={setSelectedBlock}
                />
              </Panel>
            ),
          },
          {
            key: 'queue',
            label: t('app:dashboard.moduleQueue'),
            content: <QueuePanel entries={waiting} isPending={queueQuery.isPending} professionalsById={byBarberId} />,
          },
          {
            key: 'customers',
            label: t('app:dashboard.moduleCustomers'),
            content: (
              <CustomersPanel
                totalCustomers={customersQuery.data?.length}
                isPending={customersQuery.isPending}
                summary={analyticsQuery.data}
              />
            ),
          },
          {
            key: 'social',
            label: t('app:dashboard.moduleSocial'),
            content: (
              <SocialPerformancePanel
                summary={analyticsQuery.data}
                isPending={analyticsQuery.isPending}
                isError={analyticsQuery.isError}
              />
            ),
          },
        ]}
        order={order}
        editing={editingLayout}
        onReorder={(next) => setDraftOrder(next as DashboardModule[])}
      />

      <AppointmentSheet
        appointment={selectedAppointment}
        open={selectedAppointment !== null}
        onOpenChange={(open) => !open && setSelectedAppointment(null)}
        organizationId={organizationId}
        canManage={canManage}
        currentUserId={user?.id}
        professionals={bookable}
      />

      <TimeBlockSheet
        block={selectedBlock}
        open={selectedBlock !== null}
        onOpenChange={(open) => !open && setSelectedBlock(null)}
        organizationId={organizationId}
        timeZone={timeZone}
        professionalName={selectedBlock ? byBarberId.get(selectedBlock.barberId)?.displayName : undefined}
        canRemove={
          canManage || (selectedBlock ? byBarberId.get(selectedBlock.barberId)?.userId === user?.id : false)
        }
      />
    </div>
  )
}

/** The quiet counterpart to NOW/NEXT — a real state, not an error. */
function IdleCard({
  title,
  description,
  muted,
}: {
  title: string
  description: string
  muted?: boolean
}) {
  return (
    <section
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border px-5 py-10 text-center',
        muted ? 'bg-transparent' : 'bg-paper-0',
      )}
    >
      <p className="text-balance font-medium text-ink-950">{title}</p>
      <p className="text-pretty text-sm text-ink-500">{description}</p>
    </section>
  )
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <Skeleton className="h-12 w-72" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Skeleton className="h-80 w-full rounded-lg" />
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    </div>
  )
}

/** Milliseconds, refreshed on the minute boundary. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined
    const timeout = setTimeout(() => {
      setNow(Date.now())
      interval = setInterval(() => setNow(Date.now()), 60_000)
    }, 60_000 - (Date.now() % 60_000))
    return () => {
      clearTimeout(timeout)
      if (interval) clearInterval(interval)
    }
  }, [])
  return now
}
