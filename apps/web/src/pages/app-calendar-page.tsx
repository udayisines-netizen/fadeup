import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, WifiOff } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useCurrentOrg } from '@/lib/current-org-context'
import { useOrgLocations } from '@/lib/queries/locations'
import { useCalendarRange, type CalendarAppointment, type TimeBlock } from '@/lib/queries/calendar'
import { bookableProfessionals, useCalendarProfessionals } from '@/lib/calendar/professionals'
import {
  addDays,
  addMonths,
  rangeForDays,
  startOfMonth,
  startOfWeek,
  todayInZone,
  zonedDateKey,
} from '@/lib/calendar/time'
import { layoutDay, visibleWindow } from '@/lib/calendar/layout'
import { toEntries, CalendarEntryBlock, type CalendarEntry } from '@/components/calendar/calendar-entry'
import { TimeGrid, type TimeGridColumn } from '@/components/calendar/time-grid'
import { AgendaList } from '@/components/calendar/agenda-list'
import { MonthGrid } from '@/components/calendar/month-grid'
import { AppointmentSheet } from '@/components/calendar/appointment-sheet'
import { TimeBlockDialog, TimeBlockSheet } from '@/components/calendar/time-block-dialog'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/ui/select-field'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { MembershipRole } from '@/lib/types'
import { useTranslation } from 'react-i18next'

const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager', 'receptionist'])

type CalendarView = 'day' | 'week' | 'month'

/**
 * The professional calendar.
 *
 * Three views, one data path. Day and week share the time grid (a week IS a
 * day grid with date columns); month is a density overview because a month
 * cell cannot legibly hold a customer's name and pretending otherwise is how
 * scheduling software ends up full of "+3 more".
 *
 * On phones the grid is replaced — not shrunk — by a real agenda list. Column
 * widths below about 100px are useless for names, and a barber checking their
 * next appointment between cuts wants a list, not a scale drawing of the day.
 */
export function AppCalendarPage() {
  const { currentMembership } = useCurrentOrg()
  if (!currentMembership) return null
  return (
    <CalendarWorkspace
      organizationId={currentMembership.organizationId}
      role={currentMembership.role}
    />
  )
}

function CalendarWorkspace({ organizationId, role }: { organizationId: string; role: MembershipRole }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const canManage = MANAGING_ROLES.has(role)

  const locationsQuery = useOrgLocations(organizationId)
  const locations = locationsQuery.data ?? []
  const [locationId, setLocationId] = useState<string | null>(null)
  const activeLocation = locations.find((location) => location.id === locationId) ?? locations[0]
  const timeZone = activeLocation?.timezone ?? 'UTC'

  const { professionals, byBarberId } = useCalendarProfessionals(organizationId)
  const columnsSource = useMemo(() => {
    const bookable = bookableProfessionals(professionals)
    // A professional belongs to a location; showing every location's staff as
    // columns in one shop's day would be meaningless.
    if (!activeLocation) return bookable
    return bookable.filter(
      (professional) => professional.locationId === null || professional.locationId === activeLocation.id,
    )
  }, [professionals, activeLocation])

  const [view, setView] = useState<CalendarView>('day')
  const [anchor, setAnchor] = useState(() => todayInZone(timeZone))
  const [barberFilter, setBarberFilter] = useState<string | null>(null)

  const [selectedAppointment, setSelectedAppointment] = useState<CalendarAppointment | null>(null)
  const [selectedBlock, setSelectedBlock] = useState<TimeBlock | null>(null)
  const [blockDraft, setBlockDraft] = useState<{ barberId?: string; date: string; startMinute?: number } | null>(null)

  // The week the shop reads. Monday-first is the right default for the launch
  // markets; LOT E owns making this a real per-organization setting.
  const weekStartsOn = 1

  const rangeStart = useMemo(() => {
    if (view === 'day') return anchor
    if (view === 'week') return startOfWeek(anchor, weekStartsOn)
    return startOfWeek(startOfMonth(anchor), weekStartsOn)
  }, [view, anchor])

  const dayCount = view === 'day' ? 1 : view === 'week' ? 7 : 42

  const range = useMemo(
    () => rangeForDays(rangeStart, dayCount, timeZone),
    [rangeStart, dayCount, timeZone],
  )

  const calendar = useCalendarRange(organizationId, range, {
    locationId: activeLocation?.id ?? null,
    barberId: barberFilter,
  })

  const entries = useMemo(
    () => toEntries(calendar.appointments, calendar.timeBlocks),
    [calendar.appointments, calendar.timeBlocks],
  )

  const today = todayInZone(timeZone)

  function shift(direction: -1 | 1) {
    setAnchor((current) => {
      if (view === 'day') return addDays(current, direction)
      if (view === 'week') return addDays(current, direction * 7)
      return addMonths(current, direction)
    })
  }

  if (locationsQuery.isPending) {
    return (
      <Container size="xl" className="py-6">
        <Skeleton className="h-96 w-full" />
      </Container>
    )
  }

  if (locationsQuery.isError || locations.length === 0) {
    return (
      <Container size="xl" className="py-6">
        <ErrorState
          title={locations.length === 0 ? 'No locations yet' : "Couldn't load your locations"}
          description={
            locations.length === 0
              ? 'A calendar needs somewhere to be. Add a location first.'
              : 'The calendar needs a location to know its opening hours and timezone.'
          }
          action={
            <Button onClick={() => void locationsQuery.refetch()}>
              {locations.length === 0 ? 'Reload' : 'Try again'}
            </Button>
          }
        />
      </Container>
    )
  }

  return (
    <Container size="xl" className="py-6">
      <div className="flex flex-col gap-4">
        <Header
          view={view}
          onViewChange={setView}
          anchor={anchor}
          rangeStart={rangeStart}
          dayCount={dayCount}
          isToday={view === 'day' && anchor === today}
          onShift={shift}
          onToday={() => setAnchor(today)}
          realtimeStatus={calendar.realtimeStatus}
        />

        <div className="flex flex-wrap items-end gap-3">
          {locations.length > 1 ? (
            <SelectField
              label={t('common:entity.location')}
              value={activeLocation?.id ?? ''}
              options={locations.map((location) => ({ value: location.id, label: location.name }))}
              onChange={(event) => {
                setLocationId(event.target.value)
                setBarberFilter(null)
              }}
            />
          ) : null}

          {columnsSource.length > 1 ? (
            <SelectField
              label={t('common:entity.professional')}
              value={barberFilter ?? ''}
              options={[
                { value: '', label: 'Everyone' },
                ...columnsSource.map((professional) => ({
                  value: professional.barberId,
                  label: professional.displayName,
                })),
              ]}
              onChange={(event) => setBarberFilter(event.target.value || null)}
            />
          ) : null}

          <div className="ms-auto">
            <Button
              variant="secondary"
              onClick={() =>
                setBlockDraft({
                  barberId: barberFilter ?? columnsSource[0]?.barberId,
                  date: view === 'month' ? today : anchor,
                })
              }
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('app:calendar.blockTime')}
            </Button>
          </div>
        </div>

        {calendar.isError ? (
          <ErrorState
            title={t('app:calendar.couldntLoadTheCalendar')}
            description={t('app:calendar.theDayIsStillThere')}
            action={<Button onClick={calendar.refetch}>{t('common:action.tryAgain')}</Button>}
          />
        ) : calendar.isPending ? (
          <Skeleton className="h-[32rem] w-full" />
        ) : view === 'month' ? (
          <div className="rounded-md border border-border bg-paper-0">
            <MonthGrid
              monthAnchor={anchor}
              entries={entries}
              timeZone={timeZone}
              weekStartsOn={weekStartsOn}
              onSelectDay={(dateKey) => {
                setAnchor(dateKey)
                setView('day')
              }}
            />
          </div>
        ) : (
          <>
            {/* PHONE: a real agenda. Not the grid at a smaller scale. */}
            <div className="md:hidden">
              <AgendaList
                entries={entries}
                timeZone={timeZone}
                showDayHeadings={view === 'week'}
                onSelectAppointment={setSelectedAppointment}
                onSelectBlock={setSelectedBlock}
                emptyTitle={view === 'week' ? 'Nothing booked this week' : 'Nothing booked'}
                emptyDescription={t('app:calendar.bookingsAndBlockedTimeShow')}
              />
            </div>

            {/* TABLET AND UP: the time grid. */}
            <div className="hidden overflow-hidden rounded-md border border-border bg-paper-0 md:block">
              <GridView
                view={view}
                entries={entries}
                rangeStart={rangeStart}
                dayCount={dayCount}
                timeZone={timeZone}
                today={today}
                professionals={columnsSource}
                barberFilter={barberFilter}
                onSelectAppointment={setSelectedAppointment}
                onSelectBlock={setSelectedBlock}
                onBlockTime={
                  canManage || columnsSource.some((professional) => professional.userId === user?.id)
                    ? (columnKey, minute) => {
                        setBlockDraft(
                          view === 'day'
                            ? { barberId: columnKey, date: anchor, startMinute: minute }
                            : { barberId: barberFilter ?? columnsSource[0]?.barberId, date: columnKey, startMinute: minute },
                        )
                      }
                    : undefined
                }
              />
            </div>
          </>
        )}
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
          canManage ||
          (selectedBlock ? byBarberId.get(selectedBlock.barberId)?.userId === user?.id : false)
        }
      />

      {blockDraft ? (
        <TimeBlockDialog
          open
          onOpenChange={(open) => !open && setBlockDraft(null)}
          organizationId={organizationId}
          locationId={activeLocation?.id ?? null}
          timeZone={timeZone}
          professionals={columnsSource}
          defaultBarberId={blockDraft.barberId}
          defaultDate={blockDraft.date}
          defaultStartMinute={blockDraft.startMinute}
        />
      ) : null}
    </Container>
  )
}

function Header({
  view,
  onViewChange,
  anchor,
  rangeStart,
  dayCount,
  isToday,
  onShift,
  onToday,
  realtimeStatus,
}: {
  view: CalendarView
  onViewChange: (view: CalendarView) => void
  anchor: string
  rangeStart: string
  dayCount: number
  isToday: boolean
  onShift: (direction: -1 | 1) => void
  onToday: () => void
  realtimeStatus: 'connecting' | 'live' | 'offline'
}) {
  const { t } = useTranslation()
  const title = useMemo(() => {
    const asDate = (key: string) => new Date(`${key}T12:00:00Z`)
    if (view === 'day') {
      return asDate(anchor).toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      })
    }
    if (view === 'week') {
      const end = addDays(rangeStart, dayCount - 1)
      const from = asDate(rangeStart)
      const to = asDate(end)
      const sameMonth = rangeStart.slice(0, 7) === end.slice(0, 7)
      return `${from.toLocaleDateString(undefined, { day: 'numeric', month: sameMonth ? undefined : 'short', timeZone: 'UTC' })} – ${to.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`
    }
    return asDate(anchor).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  }, [view, anchor, rangeStart, dayCount])

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" aria-label={t('app:calendar.previous')} onClick={() => onShift(-1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="sm" aria-label={t('app:calendar.next')} onClick={() => onShift(1)}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-ink-950">{title}</h1>

      {!isToday ? (
        <Button variant="secondary" size="sm" onClick={onToday}>
          {t('app:calendar.today')}
        </Button>
      ) : null}

      {/* A screen that silently stopped updating looks exactly like a quiet
          one. On a calendar that difference costs a booking. */}
      {realtimeStatus !== 'live' ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
          <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
          {t('app:calendar.reconnecting')}
        </span>
      ) : null}

      <Tabs value={view} onValueChange={(value) => onViewChange(value as CalendarView)}>
        <TabsList>
          <TabsTrigger value="day">{t('common:field.day')}</TabsTrigger>
          <TabsTrigger value="week">{t('app:calendar.week')}</TabsTrigger>
          <TabsTrigger value="month">{t('app:calendar.month')}</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  )
}

/**
 * Builds the grid's columns.
 *
 * Day view columns are PROFESSIONALS; week view columns are DAYS. Both feed
 * the same TimeGrid, and in both cases the layout runs per column — so two
 * appointments at the same time on different barbers sit side by side in their
 * own columns rather than being treated as a clash.
 */
function GridView({
  view,
  entries,
  rangeStart,
  dayCount,
  timeZone,
  today,
  professionals,
  barberFilter,
  onSelectAppointment,
  onSelectBlock,
  onBlockTime,
}: {
  view: 'day' | 'week'
  entries: CalendarEntry[]
  rangeStart: string
  dayCount: number
  timeZone: string
  today: string
  professionals: ReturnType<typeof bookableProfessionals>
  barberFilter: string | null
  onSelectAppointment: (appointment: CalendarAppointment) => void
  onSelectBlock: (block: TimeBlock) => void
  onBlockTime?: (columnKey: string, minute: number) => void
}) {
  const { t } = useTranslation()
  const { columns, window } = useMemo(() => {
    const built: TimeGridColumn<CalendarEntry>[] = []

    if (view === 'day') {
      const visible = barberFilter
        ? professionals.filter((professional) => professional.barberId === barberFilter)
        : professionals

      // Anything not attached to a professional still has to be visible —
      // an unassigned booking that nobody can see is a missed customer.
      const byBarber = new Map<string, CalendarEntry[]>()
      const unassigned: CalendarEntry[] = []
      for (const entry of entries) {
        const barberId = entry.kind === 'appointment' ? entry.appointment.barberId : entry.block.barberId
        if (!barberId) {
          unassigned.push(entry)
          continue
        }
        const bucket = byBarber.get(barberId)
        if (bucket) bucket.push(entry)
        else byBarber.set(barberId, [entry])
      }

      for (const professional of visible) {
        built.push({
          key: professional.barberId,
          label: professional.displayName,
          emphasised: rangeStart === today,
          events: layoutDay(byBarber.get(professional.barberId) ?? [], rangeStart, timeZone),
        })
      }

      if (unassigned.length > 0 && !barberFilter) {
        built.push({
          key: 'unassigned',
          label: 'Unassigned',
          sublabel: 'No professional yet',
          events: layoutDay(unassigned, rangeStart, timeZone),
        })
      }
    } else {
      for (let index = 0; index < dayCount; index += 1) {
        const dayKey = addDays(rangeStart, index)
        const asDate = new Date(`${dayKey}T12:00:00Z`)
        built.push({
          key: dayKey,
          label: asDate.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
          sublabel: asDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
          emphasised: dayKey === today,
          events: layoutDay(
            entries.filter((entry) => zonedDateKey(entry.startsAt, timeZone) === dayKey),
            dayKey,
            timeZone,
          ),
        })
      }
    }

    // ONE window across every column, so 10:00 is the same height everywhere.
    // Computing it per column would stagger the whole grid.
    const segments = built.flatMap((column) =>
      column.events.map((positioned) => ({
        startMinute: positioned.startMinute,
        endMinute: positioned.endMinute,
      })),
    )

    return { columns: built, window: visibleWindow(segments) }
  }, [view, entries, rangeStart, dayCount, timeZone, today, professionals, barberFilter])

  if (columns.length === 0) {
    return (
      <div className="p-8">
        <ErrorState
          title={t('app:calendar.noProfessionalsYet')}
          description={t('app:calendar.addABookableProfessionalAnd')}
        />
      </div>
    )
  }

  return (
    <TimeGrid
      columns={columns}
      window={window}
      timeZone={timeZone}
      showNowIndicator={view === 'week' ? true : rangeStart === today}
      onEmptyClick={onBlockTime}
      emptyClickLabel="Block time here"
      renderEvent={(positioned) => (
        <CalendarEntryBlock
          positioned={positioned}
          timeZone={timeZone}
          compact={view === 'week'}
          onSelectAppointment={onSelectAppointment}
          onSelectBlock={onSelectBlock}
        />
      )}
    />
  )
}
