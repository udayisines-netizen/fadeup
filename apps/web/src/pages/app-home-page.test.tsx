import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppHomePage } from '@/pages/app-home-page'
import { ToastProvider } from '@/components/ui/toast'
import { useAuth } from '@/lib/auth-context'
import { useCurrentOrg } from '@/lib/current-org-context'
import { useOrgLocations } from '@/lib/queries/locations'
import { useOrgBarbers } from '@/lib/queries/barbers'
import { useOrgStaffProfiles } from '@/lib/queries/staff-profiles'
import { useBookingRequests } from '@/lib/queries/booking-requests'
import { useCalendarRange, useCompleteAppointment, type CalendarAppointment } from '@/lib/queries/calendar'

vi.mock('@/lib/auth-context', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/current-org-context', () => ({ useCurrentOrg: vi.fn() }))
vi.mock('@/lib/queries/locations', () => ({ useOrgLocations: vi.fn() }))
vi.mock('@/lib/queries/barbers', () => ({ useOrgBarbers: vi.fn() }))
vi.mock('@/lib/queries/staff-profiles', () => ({ useOrgStaffProfiles: vi.fn() }))
vi.mock('@/lib/queries/booking-requests', () => ({
  useBookingRequests: vi.fn(),
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
    useCompleteAppointment: vi.fn(),
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
const mockRequests = vi.mocked(useBookingRequests)
const mockCalendar = vi.mocked(useCalendarRange)
const mockComplete = vi.mocked(useCompleteAppointment)

const completeMutate = vi.fn()

/** An instant N minutes from now, so "next up" logic is exercised against a real clock. */
function fromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

function appointment(overrides: Partial<CalendarAppointment> = {}): CalendarAppointment {
  return {
    id: 'appt-1',
    startsAt: fromNow(60),
    endsAt: fromNow(90),
    status: 'confirmed',
    resolution: null,
    expiresAt: null,
    locationId: 'loc-1',
    locationName: 'Bastille',
    locationTimezone: 'Europe/Paris',
    barberId: 'barber-1',
    barberDisplayName: 'Karim',
    serviceId: 'svc-1',
    serviceName: 'Fade',
    priceCents: 2500,
    currency: 'EUR',
    customerName: 'Alex Martin',
    customerPhone: '+33612345678',
    notes: null,
    createdAt: fromNow(-600),
    ...overrides,
  }
}

function withRole(role: string, userId = 'user-owner') {
  mockAuth.mockReturnValue({ user: { id: userId } } as never)
  mockOrg.mockReturnValue({
    currentMembership: { id: 'm-1', organizationId: 'org-1', role, organizationName: 'Shop', organizationSlug: 'shop' },
    memberships: [],
    membershipsQuery: { isPending: false } as never,
    setCurrentOrganizationId: vi.fn(),
  } as never)
}

function withCalendar(appointments: CalendarAppointment[], overrides: Record<string, unknown> = {}) {
  mockCalendar.mockReturnValue({
    appointments,
    timeBlocks: [],
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    realtimeStatus: 'live',
    ...overrides,
  } as never)
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AppHomePage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

/**
 * The screen that replaced a placeholder reading "dashboards land in later
 * lots". Its job is to answer three questions in order: who is next, is
 * anything waiting on me, what does the rest of the day look like.
 */
describe('AppHomePage — Today', () => {
  beforeEach(() => {
    completeMutate.mockReset().mockResolvedValue(undefined)
    withRole('owner')
    withCalendar([appointment()])
    mockLocations.mockReturnValue({
      data: [{ id: 'loc-1', name: 'Bastille', timezone: 'Europe/Paris' }],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as never)
    mockBarbers.mockReturnValue({
      data: [{ id: 'barber-1', organizationId: 'org-1', staffProfileId: 'sp-1', isBookable: true }],
      isPending: false,
      isError: false,
    } as never)
    mockStaff.mockReturnValue({
      data: [
        {
          id: 'sp-1',
          organizationId: 'org-1',
          userId: 'user-karim',
          locationId: 'loc-1',
          displayName: 'Karim',
          isPublic: true,
          isActive: true,
        },
      ],
      isPending: false,
      isError: false,
    } as never)
    mockRequests.mockReturnValue({ data: [], isPending: false, isError: false } as never)
    mockComplete.mockReturnValue({ mutateAsync: completeMutate, isPending: false } as never)
  })

  /** The hero card. Scoped, because the day list below deliberately shows the same appointment again. */
  function hero() {
    return screen.getByText(/Next up|In the chair now/).closest('div[class*="rounded-lg"]') as HTMLElement
  }

  it('leads with who is next', () => {
    renderPage()

    expect(screen.getByText('Next up')).toBeInTheDocument()
    expect(within(hero()).getByText('Alex Martin')).toBeInTheDocument()
  })

  it('prefers the person in the chair over the one after them', () => {
    // An appointment that started 10 minutes ago and has not finished outranks
    // whatever comes next — that is the one being worked on right now.
    withCalendar([
      appointment({ id: 'now', customerName: 'In Chair', startsAt: fromNow(-10), endsAt: fromNow(20) }),
      appointment({ id: 'later', customerName: 'Later Person', startsAt: fromNow(60), endsAt: fromNow(90) }),
    ])

    renderPage()

    expect(screen.getByText('In the chair now')).toBeInTheDocument()
    expect(within(hero()).getByText('In Chair')).toBeInTheDocument()
    // The later one is still on the day list, just not the headline.
    expect(within(hero()).queryByText('Later Person')).not.toBeInTheDocument()
  })

  it('completes from the hero in one tap, without opening anything', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /Mark as done/ }))

    await waitFor(() => expect(completeMutate).toHaveBeenCalledWith('appt-1'))
  })

  it('offers the customer as a tap-to-call link', () => {
    renderPage()

    const links = screen.getAllByRole('link', { name: /Call/ })
    expect(links[0]).toHaveAttribute('href', 'tel:+33612345678')
  })

  it('surfaces waiting requests, because nothing else would', () => {
    mockRequests.mockReturnValue({
      data: [{ id: 'r1' }, { id: 'r2' }],
      isPending: false,
      isError: false,
    } as never)

    renderPage()

    expect(screen.getByText('2 booking requests waiting')).toBeInTheDocument()
  })

  it('does not nag a barber about requests they cannot answer', () => {
    withRole('barber', 'user-karim')
    mockRequests.mockReturnValue({ data: [], isPending: false, isError: false } as never)

    renderPage()

    expect(screen.queryByText(/booking requests? waiting/)).not.toBeInTheDocument()
    // Mirrors private.can_manage_appointments: the query is never even made.
    expect(mockRequests).toHaveBeenCalledWith(undefined)
  })

  it('shows a barber THEIR chair, not the whole shop', () => {
    withRole('barber', 'user-karim')

    renderPage()

    expect(screen.getByText(/your chair/)).toBeInTheDocument()
    // The range query is scoped to that professional server-side.
    expect(mockCalendar).toHaveBeenCalledWith(
      'org-1',
      expect.anything(),
      expect.objectContaining({ barberId: 'barber-1' }),
    )
  })

  it('shows an owner the whole shop', () => {
    renderPage()

    expect(mockCalendar).toHaveBeenCalledWith(
      'org-1',
      expect.anything(),
      expect.objectContaining({ barberId: null }),
    )
  })

  it('counts the day honestly', () => {
    withCalendar([
      appointment({ id: 'a', status: 'completed' }),
      appointment({ id: 'b', status: 'no_show' }),
      appointment({ id: 'c', startsAt: fromNow(120), endsAt: fromNow(150) }),
    ])

    renderPage()

    // Scoped to the stats row: "Done" is also a status badge in the day list.
    const stat = (label: string) => screen.getByText(label).previousSibling
    expect(stat('Still to come')).toHaveTextContent('1')
    expect(screen.getAllByText('Done').map((node) => node.previousSibling).find((node) => node?.textContent === '1'))
      .toBeTruthy()
    expect(stat('No-shows')).toHaveTextContent('1')
  })

  it('says something human when the day is over', () => {
    withCalendar([appointment({ status: 'completed' })])

    renderPage()

    expect(screen.getByText('Nothing else booked today')).toBeInTheDocument()
  })

  it('admits when it is not actually live', () => {
    // A screen that silently stopped updating looks exactly like a quiet one.
    withCalendar([appointment()], { realtimeStatus: 'offline' })

    renderPage()

    expect(screen.getByText(/Reconnecting/)).toBeInTheDocument()
  })

  it('recovers from a load failure instead of dead-ending', () => {
    withCalendar([], { isError: true, error: new Error('nope') })

    renderPage()

    expect(screen.getByText("Couldn't load today")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('sends a shop with no location to set one up', () => {
    mockLocations.mockReturnValue({ data: [], isPending: false, isError: false, refetch: vi.fn() } as never)

    renderPage()

    expect(screen.getByText('Finish setting up your shop')).toBeInTheDocument()
  })
})
