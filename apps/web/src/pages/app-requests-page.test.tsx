import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRequestsPage } from '@/pages/app-requests-page'
import { ToastProvider } from '@/components/ui/toast'
import { useCurrentOrg } from '@/lib/current-org-context'
import { useOrgLocations } from '@/lib/queries/locations'
import {
  useBookingRequests,
  useConfirmBookingRequest,
  useDeclineBookingRequest,
  type BookingRequest,
} from '@/lib/queries/booking-requests'

vi.mock('@/lib/current-org-context', () => ({ useCurrentOrg: vi.fn() }))
vi.mock('@/lib/queries/locations', () => ({ useOrgLocations: vi.fn() }))
vi.mock('@/lib/queries/booking-requests', async () => {
  const actual = await vi.importActual<typeof import('@/lib/queries/booking-requests')>(
    '@/lib/queries/booking-requests',
  )
  return {
    ...actual,
    useBookingRequests: vi.fn(),
    useConfirmBookingRequest: vi.fn(),
    useDeclineBookingRequest: vi.fn(),
  }
})

const mockUseCurrentOrg = vi.mocked(useCurrentOrg)
const mockUseLocations = vi.mocked(useOrgLocations)
const mockUseRequests = vi.mocked(useBookingRequests)
const mockUseConfirm = vi.mocked(useConfirmBookingRequest)
const mockUseDecline = vi.mocked(useDeclineBookingRequest)

const confirmMutate = vi.fn()
const declineMutate = vi.fn()

function request(overrides: Partial<BookingRequest> = {}): BookingRequest {
  return {
    id: 'req-1',
    locationId: 'loc-1',
    locationName: 'Bastille',
    barberId: 'barber-1',
    barberDisplayName: 'Karim',
    serviceId: 'svc-1',
    serviceName: 'Fade',
    durationMinutes: 30,
    priceCents: 2500,
    customerName: 'Alex Martin',
    customerPhone: '+33612345678',
    customerEmail: 'alex@example.test',
    notes: 'Short on the sides please',
    startsAt: '2099-06-01T09:00:00Z',
    endsAt: '2099-06-01T09:30:00Z',
    expiresAt: '2099-06-01T08:00:00Z',
    createdAt: '2099-05-31T09:00:00Z',
    ...overrides,
  }
}

function withRole(role: string) {
  mockUseCurrentOrg.mockReturnValue({
    currentMembership: { id: 'm-1', organizationId: 'org-1', role, organizationName: 'Shop', organizationSlug: 'shop' },
    memberships: [],
    membershipsQuery: { isPending: false } as never,
    setCurrentOrganizationId: vi.fn(),
  } as never)
}

function withRequests(requests: BookingRequest[], overrides: Record<string, unknown> = {}) {
  mockUseRequests.mockReturnValue({
    data: requests,
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
        <AppRequestsPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

/**
 * The surface the audit found missing entirely: a public booking arrived as
 * pending, held the slot through the exclusion constraint, and there was
 * nowhere for a shop to answer it.
 */
describe('AppRequestsPage', () => {
  beforeEach(() => {
    confirmMutate.mockReset().mockResolvedValue(undefined)
    declineMutate.mockReset().mockResolvedValue(undefined)
    withRole('owner')
    withRequests([request()])
    mockUseLocations.mockReturnValue({
      data: [{ id: 'loc-1', timezone: 'Europe/Paris' }],
      isPending: false,
      isError: false,
    } as never)
    mockUseConfirm.mockReturnValue({ mutateAsync: confirmMutate, isPending: false, isError: false } as never)
    mockUseDecline.mockReturnValue({ mutateAsync: declineMutate, isPending: false, isError: false } as never)
  })

  it('shows everything needed to decide without opening anything', () => {
    renderPage()

    expect(screen.getByText('Alex Martin')).toBeInTheDocument()
    expect(screen.getByText(/Fade/)).toBeInTheDocument()
    expect(screen.getByText(/30 min/)).toBeInTheDocument()
    expect(screen.getByText(/Karim/)).toBeInTheDocument()
    expect(screen.getByText('Bastille')).toBeInTheDocument()
    expect(screen.getByText(/Short on the sides please/)).toBeInTheDocument()
  })

  it('accepts in ONE tap — no confirmation for the common, safe answer', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(confirmMutate).toHaveBeenCalledWith('req-1'))
  })

  it('makes declining deliberate, because it cannot be taken back', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    expect(screen.getByText('Decline this request?')).toBeInTheDocument()
    // Still nothing sent until the second, explicit confirmation.
    expect(declineMutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Decline request' }))
    await waitFor(() =>
      expect(declineMutate).toHaveBeenCalledWith({ appointmentId: 'req-1', note: '' }),
    )
  })

  it('passes the optional message on to the customer', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    fireEvent.change(screen.getByLabelText('Message to the customer'), {
      target: { value: 'Fully booked that morning' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Decline request' }))

    await waitFor(() =>
      expect(declineMutate).toHaveBeenCalledWith({
        appointmentId: 'req-1',
        note: 'Fully booked that morning',
      }),
    )
  })

  it('explains a lost race in words a person can act on', async () => {
    // Two staff answering at once is the system working, not an error. The
    // raw Postgres message is not what a receptionist should read.
    confirmMutate.mockRejectedValue({ message: 'this request has already been answered' })

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(screen.getByText('Already answered')).toBeInTheDocument())
    expect(screen.getByText('Someone else answered this request first.')).toBeInTheDocument()
    expect(screen.queryByText(/already been answered/)).not.toBeInTheDocument()
  })

  it('explains an expired request rather than showing an SQLSTATE', async () => {
    confirmMutate.mockRejectedValue({ message: 'this request has expired' })

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(screen.getByText('This request expired')).toBeInTheDocument())
  })

  it('shows an empty state rather than an empty page', () => {
    withRequests([])

    renderPage()

    expect(screen.getByText('No requests waiting')).toBeInTheDocument()
  })

  it('says so when it is not actually live', () => {
    // A screen that silently stopped updating looks exactly like one with
    // nothing to show — and this is the screen where that costs a booking.
    withRequests([request()], { realtimeStatus: 'offline' })

    renderPage()

    expect(screen.getByText(/Reconnecting/)).toBeInTheDocument()
  })

  it('does not offer the inbox to a barber', () => {
    // Mirrors private.can_manage_appointments: front-of-house roles decide.
    withRole('barber')

    renderPage()

    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
    expect(screen.getByText(/handled by owners, managers and reception/)).toBeInTheDocument()
  })

  it('does not even query when the caller may not decide', () => {
    withRole('barber')

    renderPage()

    expect(mockUseRequests).toHaveBeenCalledWith(undefined)
  })

  it('lets a receptionist decide', () => {
    withRole('receptionist')

    renderPage()

    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument()
  })

  it('offers the customer phone number as a tap-to-call link', () => {
    renderPage()

    expect(screen.getByRole('link', { name: '+33612345678' })).toHaveAttribute('href', 'tel:+33612345678')
  })

  it('recovers from a load failure instead of dead-ending', () => {
    withRequests([], { isError: true, error: new Error('network down'), data: undefined })

    renderPage()

    expect(screen.getByText("Couldn't load booking requests")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
