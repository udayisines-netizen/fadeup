import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppCalendarPage } from '@/pages/app-calendar-page'
import { ToastProvider } from '@/components/ui/toast'
import { useAuth } from '@/lib/auth-context'
import { useCurrentOrg } from '@/lib/current-org-context'
import { useOrgLocations } from '@/lib/queries/locations'
import { useOrgBarbers } from '@/lib/queries/barbers'
import { useOrgStaffProfiles } from '@/lib/queries/staff-profiles'
import { useCalendarRange, type CalendarAppointment, type TimeBlock } from '@/lib/queries/calendar'
import { zonedTimeToInstant, todayInZone } from '@/lib/calendar/time'

vi.mock('@/lib/auth-context', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/current-org-context', () => ({ useCurrentOrg: vi.fn() }))
vi.mock('@/lib/queries/locations', () => ({ useOrgLocations: vi.fn() }))
vi.mock('@/lib/queries/barbers', () => ({ useOrgBarbers: vi.fn() }))
vi.mock('@/lib/queries/staff-profiles', () => ({ useOrgStaffProfiles: vi.fn() }))
vi.mock('@/lib/queries/appointments', () => ({ useAvailableSlots: () => ({ data: [], isPending: false }) }))
vi.mock('@/lib/queries/booking-requests', () => ({
  useConfirmBookingRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeclineBookingRequest: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelAppointmentAsBusiness: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRescheduleAppointment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/lib/queries/calendar', async () => {
  const actual = await vi.importActual<typeof import('@/lib/queries/calendar')>('@/lib/queries/calendar')
  return {
    ...actual,
    useCalendarRange: vi.fn(),
    useCompleteAppointment: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useMarkAppointmentNoShow: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useCreateTimeBlock: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteTimeBlock: () => ({ mutateAsync: vi.fn(), isPending: false }),
  }
})

const mockAuth = vi.mocked(useAuth)
const mockOrg = vi.mocked(useCurrentOrg)
const mockLocations = vi.mocked(useOrgLocations)
const mockBarbers = vi.mocked(useOrgBarbers)
const mockStaff = vi.mocked(useOrgStaffProfiles)
const mockCalendar = vi.mocked(useCalendarRange)

const PARIS = 'Europe/Paris'
const today = todayInZone(PARIS)

function at(hour: number, minute = 0): string {
  return zonedTimeToInstant(today, hour * 60 + minute, PARIS).toISOString()
}

function appointment(overrides: Partial<CalendarAppointment> = {}): CalendarAppointment {
  return {
    id: 'appt-1',
    startsAt: at(10),
    endsAt: at(10, 30),
    status: 'confirmed',
    resolution: null,
    expiresAt: null,
    locationId: 'loc-1',
    locationName: 'Bastille',
    locationTimezone: PARIS,
    barberId: 'barber-1',
    barberDisplayName: 'Karim',
    serviceId: 'svc-1',
    serviceName: 'Fade',
    priceCents: 2500,
    currency: 'EUR',
    customerName: 'Alex Martin',
    customerPhone: '+33612345678',
    notes: null,
    createdAt: at(8),
    ...overrides,
  }
}

function block(overrides: Partial<TimeBlock> = {}): TimeBlock {
  return {
    id: 'block-1',
    organizationId: 'org-1',
    locationId: 'loc-1',
    barberId: 'barber-1',
    startsAt: at(12),
    endsAt: at(13),
    reason: 'Lunch',
    ...overrides,
  }
}

function withCalendar(
  appointments: CalendarAppointment[],
  timeBlocks: TimeBlock[] = [],
  overrides: Record<string, unknown> = {},
) {
  mockCalendar.mockReturnValue({
    appointments,
    timeBlocks,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    realtimeStatus: 'live',
    ...overrides,
  } as never)
}

/**
 * Radix TabsTrigger selects on mousedown, not click — fireEvent.click alone
 * dispatches neither, so the view would silently never change.
 */
function selectView(name: 'Day' | 'Week' | 'Month') {
  const tab = screen.getByRole('tab', { name })
  fireEvent.mouseDown(tab)
  fireEvent.click(tab)
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AppCalendarPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('AppCalendarPage', () => {
  beforeEach(() => {
    mockAuth.mockReturnValue({ user: { id: 'user-owner' } } as never)
    mockOrg.mockReturnValue({
      currentMembership: {
        id: 'm-1',
        organizationId: 'org-1',
        role: 'owner',
        organizationName: 'Shop',
        organizationSlug: 'shop',
      },
      memberships: [],
      membershipsQuery: { isPending: false } as never,
      setCurrentOrganizationId: vi.fn(),
    } as never)
    mockLocations.mockReturnValue({
      data: [{ id: 'loc-1', name: 'Bastille', timezone: PARIS }],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as never)
    mockBarbers.mockReturnValue({
      data: [
        { id: 'barber-1', organizationId: 'org-1', staffProfileId: 'sp-1', isBookable: true },
        { id: 'barber-2', organizationId: 'org-1', staffProfileId: 'sp-2', isBookable: true },
      ],
      isPending: false,
      isError: false,
    } as never)
    mockStaff.mockReturnValue({
      data: [
        { id: 'sp-1', organizationId: 'org-1', userId: 'u1', locationId: 'loc-1', displayName: 'Karim', isPublic: true, isActive: true },
        { id: 'sp-2', organizationId: 'org-1', userId: 'u2', locationId: 'loc-1', displayName: 'Sofia', isPublic: true, isActive: true },
      ],
      isPending: false,
      isError: false,
    } as never)
    withCalendar([appointment()], [block()])
  })

  it('gives every professional their own column', () => {
    const { container } = renderPage()

    // Two people working means two columns — an appointment at 10:00 on each
    // is not a clash, and a single merged column would draw it as one.
    // Scoped to the grid: the agenda below also names the professional.
    const grid = container.querySelector('.hidden.md\\:block') as HTMLElement
    expect(within(grid).getByText('Karim')).toBeInTheDocument()
    expect(within(grid).getByText('Sofia')).toBeInTheDocument()
  })

  it('asks the server for exactly one local day by default', () => {
    renderPage()

    const [, range] = mockCalendar.mock.calls.at(-1)!
    expect(range.from).toBe(zonedTimeToInstant(today, 0, PARIS).toISOString())
    expect(new Date(range.to).getTime() - new Date(range.from).getTime()).toBeLessThanOrEqual(25 * 3_600_000)
  })

  it('widens the range to seven days for the week view', () => {
    renderPage()

    selectView('Week')

    const [, range] = mockCalendar.mock.calls.at(-1)!
    const days = (new Date(range.to).getTime() - new Date(range.from).getTime()) / 3_600_000 / 24
    // 7, or 6.958/7.042 across a DST boundary — still exactly seven local days.
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThan(7.1)
  })

  it('narrows to one professional server-side, not by hiding rows', () => {
    renderPage()

    fireEvent.change(screen.getByLabelText('Professional'), { target: { value: 'barber-2' } })

    const [, , filters] = mockCalendar.mock.calls.at(-1)!
    expect(filters).toMatchObject({ barberId: 'barber-2' })
  })

  it('renders a phone agenda AND a desktop grid, switched by CSS', () => {
    // Both exist in the DOM; the breakpoint decides which is painted. That is
    // deliberate — the mobile surface is a different component, not the grid
    // scaled down, and it must not depend on measuring the window.
    const { container } = renderPage()

    expect(container.querySelector('.md\\:hidden')).toBeTruthy()
    expect(container.querySelector('.hidden.md\\:block')).toBeTruthy()
  })

  it('shows blocked time as blocked, with its reason, to staff', () => {
    renderPage()

    expect(screen.getAllByText('Lunch').length).toBeGreaterThan(0)
  })

  it('opens an appointment from the agenda', () => {
    renderPage()

    const agenda = document.querySelector('.md\\:hidden') as HTMLElement
    fireEvent.click(within(agenda).getByRole('button', { name: /Alex Martin/ }))

    expect(screen.getByRole('dialog')).toHaveTextContent('Alex Martin')
  })

  it('switches to a density overview for the month', () => {
    renderPage()

    selectView('Month')

    // 42 cells: six whole weeks, always, so the page does not jump height
    // between a five-week month and a six-week one.
    // Pluralised: a cell with one booking says "1 appointment", not
    // "1 appointments". That label is all a screen-reader user hears for a
    // cell whose visible content is a bare number.
    const dayCells = screen.getAllByRole('button', { name: /\d+ appointments?/ })
    expect(dayCells).toHaveLength(42)
  })

  it('drills from a month cell into that day', () => {
    renderPage()
    selectView('Month')

    const busyDay = screen.getAllByRole('button', { name: /\b1 appointment\b/ })[0]
    fireEvent.click(busyDay)

    expect(screen.getByRole('tab', { name: 'Day', selected: true })).toBeInTheDocument()
  })

  it('moves through days and comes back', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    // Leaving today reveals the way back — it is hidden while already there.
    const todayButton = screen.getByRole('button', { name: 'Today' })
    fireEvent.click(todayButton)

    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument()
  })

  it('says so when it is not actually live', () => {
    withCalendar([appointment()], [], { realtimeStatus: 'offline' })

    renderPage()

    expect(screen.getByText(/Reconnecting/)).toBeInTheDocument()
  })

  it('recovers from a load failure instead of dead-ending', () => {
    withCalendar([], [], { isError: true, error: new Error('nope') })

    renderPage()

    expect(screen.getByText("Couldn't load the calendar")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('tells a shop with no location what to do first', () => {
    mockLocations.mockReturnValue({ data: [], isPending: false, isError: false, refetch: vi.fn() } as never)

    renderPage()

    expect(screen.getByText('No locations yet')).toBeInTheDocument()
  })
})
