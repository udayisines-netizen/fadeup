import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProDashboardPage } from '@/pages/pro/dashboard-page'
import { ToastProvider } from '@/components/ui/toast'
import { useAuth } from '@/lib/auth-context'
import { useCurrentOrg } from '@/lib/current-org-context'
import { useOrgLocations } from '@/lib/queries/locations'
import { useOrgBarbers } from '@/lib/queries/barbers'
import { useOrgStaffProfiles } from '@/lib/queries/staff-profiles'
import { useOrgQueue } from '@/lib/queries/queue'
import { useBookingRequests } from '@/lib/queries/booking-requests'
import { useCalendarRange, useCompleteAppointment, type CalendarAppointment } from '@/lib/queries/calendar'

vi.mock('@/lib/auth-context', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/current-org-context', () => ({ useCurrentOrg: vi.fn() }))
vi.mock('@/lib/queries/locations', () => ({ useOrgLocations: vi.fn() }))
vi.mock('@/lib/queries/barbers', () => ({ useOrgBarbers: vi.fn() }))
vi.mock('@/lib/queries/staff-profiles', () => ({ useOrgStaffProfiles: vi.fn() }))
vi.mock('@/lib/queries/queue', () => ({ useOrgQueue: vi.fn() }))
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
vi.mock('@/lib/intl/use-intl', async () => {
  const actual = await vi.importActual<typeof import('@/lib/intl/use-intl')>('@/lib/intl/use-intl')
  return { ...actual, useOrganizationCurrency: () => 'EUR' }
})

const mockAuth = vi.mocked(useAuth)
const mockOrg = vi.mocked(useCurrentOrg)
const mockLocations = vi.mocked(useOrgLocations)
const mockBarbers = vi.mocked(useOrgBarbers)
const mockStaff = vi.mocked(useOrgStaffProfiles)
const mockQueue = vi.mocked(useOrgQueue)
const mockRequests = vi.mocked(useBookingRequests)
const mockCalendar = vi.mocked(useCalendarRange)
const mockComplete = vi.mocked(useCompleteAppointment)

const completeMutate = vi.fn()

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
  mockAuth.mockReturnValue({ user: { id: userId, email: 'alex@shop.test' } } as never)
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
        <ProDashboardPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

/**
 * The flagship screen. These tests are as much about what it must NOT show —
 * the reference is full of numbers FadeUp cannot compute, and the dashboard's
 * value depends on every figure on it being true.
 */
describe('ProDashboardPage', () => {
  beforeEach(() => {
    completeMutate.mockReset().mockResolvedValue(undefined)
    withRole('owner')
    withCalendar([appointment()])
    mockLocations.mockReturnValue({
      data: [{ id: 'loc-1', name: 'Bastille', timezone: 'Europe/Paris', city: 'Paris', country: 'FR' }],
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
    mockQueue.mockReturnValue({ data: [], isPending: false, isError: false } as never)
    mockRequests.mockReturnValue({ data: [], isPending: false, isError: false } as never)
    mockComplete.mockReturnValue({ mutateAsync: completeMutate, isPending: false } as never)
  })

  it('leads with who is next when nobody is in the chair', () => {
    renderPage()

    expect(screen.getByText('Up next')).toBeInTheDocument()
    expect(screen.getByText('Nobody in the chair')).toBeInTheDocument()
  })

  it('promotes the person in the chair over the one after them', () => {
    withCalendar([
      appointment({ id: 'now', customerName: 'In Chair', startsAt: fromNow(-10), endsAt: fromNow(20) }),
      appointment({ id: 'later', customerName: 'Later Person', startsAt: fromNow(60), endsAt: fromNow(90) }),
    ])

    renderPage()

    expect(screen.getByText('In progress')).toBeInTheDocument()
    // The NOW card is the dominant object; the next person is beside it, not in it.
    const now = screen.getByText('In progress').closest('section') as HTMLElement
    expect(within(now).getByText('In Chair')).toBeInTheDocument()
    expect(within(now).queryByText('Later Person')).not.toBeInTheDocument()
  })

  it('finishes the current appointment in one tap', async () => {
    withCalendar([appointment({ id: 'now', startsAt: fromNow(-10), endsAt: fromNow(20) })])

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Finish/ }))

    await waitFor(() => expect(completeMutate).toHaveBeenCalledWith('now'))
  })

  it('shows booked VALUE and labels it as not being payments', () => {
    // FadeUp takes no payments. The figure is real; calling it revenue is not.
    renderPage()

    expect(screen.getByText('Booked value')).toBeInTheDocument()
    expect(screen.getByText('Not payments')).toBeInTheDocument()
    expect(screen.queryByText(/Revenue/i)).not.toBeInTheDocument()
  })

  it('never invents a comparison against yesterday', () => {
    renderPage()

    // The reference shows "+18% vs hier" on every tile. Nothing queries
    // yesterday, so nothing may claim it.
    expect(screen.queryByText(/vs (hier|yesterday)/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/%\s*vs/i)).not.toBeInTheDocument()
  })

  it('shows a dash rather than 0% occupancy on an empty day', () => {
    withCalendar([])

    renderPage()

    const occupancy = screen.getByText('Occupancy').previousSibling
    expect(occupancy).toHaveTextContent('—')
  })

  it('keeps a zero no-show count quiet rather than alarming', () => {
    renderPage()

    const noShows = screen.getByText('No-shows').previousSibling
    expect(noShows).toHaveTextContent('0')
    expect(noShows).toHaveClass('text-ink-300')
  })

  it('surfaces waiting requests, because nothing else would', () => {
    mockRequests.mockReturnValue({ data: [{ id: 'r1' }, { id: 'r2' }], isPending: false, isError: false } as never)

    renderPage()

    expect(screen.getByText('2 booking requests waiting')).toBeInTheDocument()
  })

  it('does not nag a professional about requests they cannot answer', () => {
    withRole('barber', 'user-karim')

    renderPage()

    expect(screen.queryByText(/booking requests waiting/)).not.toBeInTheDocument()
    expect(mockRequests).toHaveBeenCalledWith(undefined)
  })

  it('scopes a professional to their own chair, server-side', () => {
    withRole('barber', 'user-karim')

    renderPage()

    expect(mockCalendar).toHaveBeenCalledWith(
      'org-1',
      expect.anything(),
      expect.objectContaining({ barberId: 'barber-1' }),
    )
  })

  it('gives front-of-house the whole floor', () => {
    renderPage()

    expect(mockCalendar).toHaveBeenCalledWith(
      'org-1',
      expect.anything(),
      expect.objectContaining({ barberId: null }),
    )
  })

  it('marks a usable gap between two appointments', () => {
    withCalendar([
      appointment({ id: 'a', startsAt: fromNow(60), endsAt: fromNow(90) }),
      appointment({ id: 'b', customerName: 'Second', startsAt: fromNow(150), endsAt: fromNow(180) }),
    ])

    renderPage()

    // 60 minutes between them — a real walk-in opportunity, and the most
    // valuable row on the timeline.
    expect(screen.getByText(/1 h free/)).toBeInTheDocument()
  })

  it('does not call a short turnaround an opportunity', () => {
    withCalendar([
      appointment({ id: 'a', startsAt: fromNow(60), endsAt: fromNow(90) }),
      appointment({ id: 'b', customerName: 'Second', startsAt: fromNow(100), endsAt: fromNow(130) }),
    ])

    renderPage()

    expect(screen.queryByText(/free/)).not.toBeInTheDocument()
  })

  it('says so when it is not actually live', () => {
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
