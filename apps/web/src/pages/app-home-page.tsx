import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Ban, CalendarDays, Check, Inbox, Phone, WifiOff } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useCurrentOrg } from '@/lib/current-org-context'
import { useOrgLocations } from '@/lib/queries/locations'
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
import { toEntries } from '@/components/calendar/calendar-entry'
import { AgendaList } from '@/components/calendar/agenda-list'
import { AppointmentSheet } from '@/components/calendar/appointment-sheet'
import { TimeBlockDialog, TimeBlockSheet } from '@/components/calendar/time-block-dialog'
import { AppointmentStatusBadge } from '@/components/calendar/appointment-status'
import { Container } from '@/components/ui/container'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import type { MembershipRole } from '@/lib/types'

const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager', 'receptionist'])

/**
 * Today — the professional's command center.
 *
 * This screen replaces a placeholder that said dashboards were coming in a
 * later lot. It answers, in order, the only questions someone standing in a
 * shop actually has:
 *
 *   1. Who is next, and are they here?
 *   2. Is anything waiting on me?
 *   3. What does the rest of the day look like?
 *
 * Everything else — analytics, revenue, charts — is deliberately absent. A
 * barber between two cuts does not need a bar chart, and a dashboard full of
 * decorative numbers is exactly the generic SaaS surface FadeUp must not be.
 *
 * WHOSE DAY IS IT? A barber sees their own chair, because that is the day they
 * are working. Front-of-house sees the whole shop, because that is the day
 * THEY are working. Same screen, different question, resolved from the role
 * and from whether the signed-in user is themselves a professional.
 */
export function AppHomePage() {
  const { currentMembership, membershipsQuery } = useCurrentOrg()

  if (membershipsQuery.isPending) {
    return (
      <Container size="lg" className="py-6">
        <Skeleton className="h-64 w-full" />
      </Container>
    )
  }

  if (!currentMembership) return null

  return <Today organizationId={currentMembership.organizationId} role={currentMembership.role} />
}

function Today({ organizationId, role }: { organizationId: string; role: MembershipRole }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const canManage = MANAGING_ROLES.has(role)

  const locationsQuery = useOrgLocations(organizationId)
  const locations = locationsQuery.data ?? []
  const location = locations[0]
  const timeZone = location?.timezone ?? 'UTC'

  const { professionals, byBarberId } = useCalendarProfessionals(organizationId)
  const columnsSource = useMemo(() => bookableProfessionals(professionals), [professionals])
  const ownProfessional = useMemo(
    () => columnsSource.find((professional) => professional.userId === user?.id),
    [columnsSource, user?.id],
  )

  // A barber who is also a professional gets their own chair. Anyone else —
  // including an owner who does not cut hair — gets the shop.
  const focusBarberId = !canManage && ownProfessional ? ownProfessional.barberId : null

  const today = todayInZone(timeZone)
  const range = useMemo(() => rangeForDays(today, 1, timeZone), [today, timeZone])

  const calendar = useCalendarRange(organizationId, range, {
    locationId: location?.id ?? null,
    barberId: focusBarberId,
  })

  const requestsQuery = useBookingRequests(canManage ? organizationId : undefined)
  const pendingCount = requestsQuery.data?.length ?? 0

  const completeAppointment = useCompleteAppointment(organizationId)

  const [selectedAppointment, setSelectedAppointment] = useState<CalendarAppointment | null>(null)
  const [selectedBlock, setSelectedBlock] = useState<TimeBlock | null>(null)
  const [blockOpen, setBlockOpen] = useState(false)

  // Ticks every minute so "next up" advances on its own. This page is small
  // and the whole point of it is to be current — unlike the calendar grid,
  // where a per-minute re-render would redraw hundreds of blocks and the
  // now-line is moved through a ref instead.
  const now = useMinuteClock()

  const { current, next, remaining, doneCount, noShowCount } = useMemo(() => {
    const live = calendar.appointments
    const nowMs = now
    let currentAppointment: CalendarAppointment | null = null
    let nextAppointment: CalendarAppointment | null = null
    let done = 0
    let noShows = 0
    const upcoming: CalendarAppointment[] = []

    // One pass: the day is short, but this runs every minute.
    for (const appointment of live) {
      if (appointment.status === 'completed') done += 1
      if (appointment.status === 'no_show') noShows += 1
      if (appointment.status !== 'confirmed' && appointment.status !== 'pending') continue

      const start = new Date(appointment.startsAt).getTime()
      const end = new Date(appointment.endsAt).getTime()

      if (appointment.status === 'confirmed' && start <= nowMs && end > nowMs) {
        if (!currentAppointment || start > new Date(currentAppointment.startsAt).getTime()) {
          currentAppointment = appointment
        }
      } else if (start > nowMs) {
        upcoming.push(appointment)
      }
    }

    upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    nextAppointment = upcoming.find((appointment) => appointment.status === 'confirmed') ?? upcoming[0] ?? null

    return {
      current: currentAppointment,
      next: nextAppointment,
      remaining: upcoming.length,
      doneCount: done,
      noShowCount: noShows,
    }
  }, [calendar.appointments, now])

  const entries = useMemo(
    () => toEntries(calendar.appointments, calendar.timeBlocks),
    [calendar.appointments, calendar.timeBlocks],
  )

  async function completeNow(appointment: CalendarAppointment) {
    try {
      await completeAppointment.mutateAsync(appointment.id)
      toast({ title: `${appointment.customerName} marked as done`, variant: 'success' })
    } catch (cause) {
      toast({ title: calendarErrorMessage(cause), variant: 'error' })
    }
  }

  if (locationsQuery.isPending || calendar.isPending) {
    return (
      <Container size="lg" className="py-6">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Container>
    )
  }

  if (locations.length === 0) {
    return (
      <Container size="lg" className="py-6">
        <ErrorState
          title="Finish setting up your shop"
          description="Add a location, your services and your hours, and this becomes your day."
          action={
            <Link to="/app/locations" className={buttonVariants()}>
              Add a location
            </Link>
          }
        />
      </Container>
    )
  }

  if (calendar.isError) {
    return (
      <Container size="lg" className="py-6">
        <ErrorState
          title="Couldn't load today"
          description="Your appointments are safe — we just couldn't fetch them."
          action={<Button onClick={calendar.refetch}>Try again</Button>}
        />
      </Container>
    )
  }

  const heading = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  })

  return (
    <Container size="lg" className="py-6">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold text-ink-950">Today</h1>
            <p className="truncate text-sm text-ink-500">
              {heading}
              {focusBarberId ? ' · your chair' : locations.length > 1 ? ` · ${location.name}` : ''}
            </p>
          </div>
          {calendar.realtimeStatus !== 'live' ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
              <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
              Reconnecting…
            </span>
          ) : null}
          <Link to="/app/calendar" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            Calendar
          </Link>
        </div>

        {/* 1. WHO IS NEXT. The largest thing on the page, because it is the
            only thing that matters while the shop is open. */}
        <NowNext
          current={current}
          next={next}
          timeZone={timeZone}
          onOpen={setSelectedAppointment}
          onComplete={completeNow}
          canComplete={canManage || Boolean(ownProfessional)}
          isCompleting={completeAppointment.isPending}
        />

        {/* 2. IS ANYTHING WAITING ON ME? */}
        {canManage && pendingCount > 0 ? (
          <Link
            to="/app/requests"
            className={cn(
              'flex min-h-16 items-center gap-3 rounded-md border border-warning-600 bg-warning-100 px-4 py-3',
              'transition-colors hover:bg-warning-100/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700',
            )}
          >
            <Inbox className="h-5 w-5 shrink-0 text-ink-950" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-ink-950">
                {pendingCount === 1 ? '1 booking request' : `${pendingCount} booking requests`} waiting
              </span>
              <span className="block text-sm text-ink-700">
                They hold a slot until you answer or they expire.
              </span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-ink-700" aria-hidden="true" />
          </Link>
        ) : null}

        <div className="grid grid-cols-3 gap-3">
          <Stat label="Still to come" value={remaining} />
          <Stat label="Done" value={doneCount} />
          <Stat label="No-shows" value={noShowCount} muted={noShowCount === 0} />
        </div>

        {/* 3. THE REST OF THE DAY. */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            {/* "The whole day", not "the rest of it": this list deliberately
                includes what is already finished and the appointment featured
                above. Seeing the shape of the full day is the point, and a
                list that silently omitted the next customer would read as a
                bug. */}
            <CardTitle className="text-sm">The whole day</CardTitle>
            <Button variant="secondary" size="sm" onClick={() => setBlockOpen(true)}>
              <Ban className="h-4 w-4" aria-hidden="true" />
              Block time
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            <AgendaList
              entries={entries}
              timeZone={timeZone}
              onSelectAppointment={setSelectedAppointment}
              onSelectBlock={setSelectedBlock}
              emptyTitle="Nothing booked today"
              emptyDescription={
                canManage
                  ? 'A quiet day. Bookings appear here the moment they come in.'
                  : 'Nothing in your chair today.'
              }
            />
          </CardContent>
        </Card>
      </div>

      <AppointmentSheet
        appointment={selectedAppointment}
        open={selectedAppointment !== null}
        onOpenChange={(open) => !open && setSelectedAppointment(null)}
        organizationId={organizationId}
        canManage={canManage}
        currentUserId={user?.id}
        professionals={columnsSource}
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

      {blockOpen ? (
        <TimeBlockDialog
          open
          onOpenChange={setBlockOpen}
          organizationId={organizationId}
          locationId={location?.id ?? null}
          timeZone={timeZone}
          professionals={columnsSource}
          defaultBarberId={ownProfessional?.barberId ?? columnsSource[0]?.barberId}
          defaultDate={today}
        />
      ) : null}
    </Container>
  )
}

/**
 * The hero.
 *
 * "In the chair now" outranks "next" when both exist, and the primary action
 * — Mark as done — is right there, because walking back to a computer to close
 * out a cut is the interaction this product exists to remove.
 */
function NowNext({
  current,
  next,
  timeZone,
  onOpen,
  onComplete,
  canComplete,
  isCompleting,
}: {
  current: CalendarAppointment | null
  next: CalendarAppointment | null
  timeZone: string
  onOpen: (appointment: CalendarAppointment) => void
  onComplete: (appointment: CalendarAppointment) => void
  canComplete: boolean
  isCompleting: boolean
}) {
  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone })

  if (!current && !next) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="font-medium text-ink-950">Nothing else booked today</p>
          <p className="mt-1 text-sm text-ink-500">Enjoy it.</p>
        </CardContent>
      </Card>
    )
  }

  const featured = current ?? next!
  const isInChair = current !== null

  return (
    <Card className={cn(isInChair && 'border-accent-600')}>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            {isInChair ? 'In the chair now' : 'Next up'}
          </span>
          <AppointmentStatusBadge status={featured.status} resolution={featured.resolution} />
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-semibold tabular-nums text-ink-950">
            {formatTime(featured.startsAt)}
          </span>
          <span className="text-lg font-medium text-ink-950">{featured.customerName}</span>
        </div>

        <p className="text-sm text-ink-500">
          {featured.serviceName ?? 'No service recorded'}
          {featured.barberDisplayName ? ` · ${featured.barberDisplayName}` : ''}
        </p>

        <div className="flex flex-wrap gap-2">
          {featured.status === 'confirmed' && canComplete ? (
            <Button onClick={() => onComplete(featured)} isLoading={isCompleting}>
              <Check className="h-4 w-4" aria-hidden="true" />
              Mark as done
            </Button>
          ) : null}
          {featured.customerPhone ? (
            <a
              href={`tel:${featured.customerPhone}`}
              className={buttonVariants({ variant: 'secondary' })}
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              Call
            </a>
          ) : null}
          <Button variant="ghost" onClick={() => onOpen(featured)}>
            Details
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-paper-0 px-3 py-2">
      <div className={cn('text-2xl font-semibold tabular-nums', muted ? 'text-ink-300' : 'text-ink-950')}>
        {value}
      </div>
      <div className="text-xs text-ink-500">{label}</div>
    </div>
  )
}

/** Milliseconds, refreshed on the minute boundary. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    // Aligned to the next whole minute so "next up" flips when the clock
    // does, rather than up to 59 seconds late.
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
