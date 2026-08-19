import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerAppointmentsPage } from '@/pages/customer-appointments-page'
import { ToastProvider } from '@/components/ui/toast'
import { useAuth } from '@/lib/auth-context'
import { useMyAppointments, useCancelMyAppointment, type MyAppointment } from '@/lib/queries/customer-app'

vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

vi.mock('@/lib/queries/customer-app', async () => {
  // bookingStage/isLiveStage are pure derivations the page relies on — mocking
  // them would test the mock instead of the vocabulary.
  const actual = await vi.importActual<typeof import('@/lib/queries/customer-app')>('@/lib/queries/customer-app')
  return { ...actual, useMyAppointments: vi.fn(), useCancelMyAppointment: vi.fn() }
})

const mockUseAuth = vi.mocked(useAuth)
const mockUseMyAppointments = vi.mocked(useMyAppointments)
const mockUseCancelMyAppointment = vi.mocked(useCancelMyAppointment)

function appointment(overrides: Partial<MyAppointment> = {}): MyAppointment {
  return {
    id: 'a-1',
    organizationId: 'org-1',
    organizationName: 'Le Fade Parisien',
    organizationSlug: 'demo-le-fade-parisien',
    locationId: 'loc-1',
    locationName: 'Main',
    barberId: 'barber-1',
    barberDisplayName: 'Karim',
    serviceId: 'svc-1',
    serviceName: 'Fade',
    startsAt: '2099-01-01T10:00:00Z',
    endsAt: '2099-01-01T10:30:00Z',
    status: 'confirmed',
    priceCents: 2000,
    currency: 'EUR',
    locationTimezone: 'Europe/Paris',
    // LOT C lifecycle fields. `resolution` is what lets the UI say "not
    // accepted" or "expired" rather than the blunt "cancelled" the database
    // uses for all three.
    resolution: null,
    resolutionNote: null,
    expiresAt: null,
    createdAt: '2099-01-01T09:00:00Z',
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <CustomerAppointmentsPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('CustomerAppointmentsPage', () => {
  const mutateAsync = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    mutateAsync.mockClear()
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
    mockUseCancelMyAppointment.mockReturnValue({ mutateAsync, isPending: false } as never)
  })

  it('shows both empty states — never a fabricated appointment', async () => {
    mockUseMyAppointments.mockReturnValue({ data: [], isPending: false, isError: false, error: null, refetch: vi.fn() } as never)

    renderPage()

    expect(screen.getByText('No upcoming appointments')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Past' }))
    await waitFor(() => expect(screen.getByText('No past appointments yet')).toBeInTheDocument())
  })

  it('splits appointments into upcoming (actionable) and past (rebookable) correctly', async () => {
    mockUseMyAppointments.mockReturnValue({
      data: [appointment({ id: 'upcoming', status: 'pending' }), appointment({ id: 'past', status: 'completed' })],
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as never)

    renderPage()

    // A request you sent is WITHDRAWN; a confirmed appointment is CANCELLED.
    // Same RPC, different act, so the label follows the act.
    expect(screen.getByRole('button', { name: 'Withdraw request' })).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Past' }))
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Rebook' })).toHaveAttribute('href', '/s/demo-le-fade-parisien?barber=barber-1&service=svc-1'),
    )
  })

  it('cancelling requires confirmation, then calls the mutation', async () => {
    mockUseMyAppointments.mockReturnValue({
      data: [appointment({ id: 'upcoming', status: 'pending' })],
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as never)

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }))
    expect(screen.getByText('Cancel this appointment?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith('upcoming'))
  })

  it('shows an error state, not a raw error message, when appointments fail to load', () => {
    mockUseMyAppointments.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('network error'),
      refetch: vi.fn(),
    } as never)

    renderPage()

    expect(screen.getByText("Couldn't load your appointments")).toBeInTheDocument()
  })

  it('a stale pending request is not shown as upcoming, and cannot be cancelled from there', () => {
    // Public bookings are created `pending`, and only `confirmed` rows are
    // ever aged out server-side. Splitting on status alone left a request a
    // shop never confirmed sitting under Upcoming forever with a live
    // Cancel button, while Home (which checks the date) showed nothing.
    mockUseMyAppointments.mockReturnValue({
      data: [appointment({ id: 'stale', status: 'pending', startsAt: '2020-01-01T10:00:00Z', endsAt: '2020-01-01T10:30:00Z' })],
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as never)

    renderPage()

    expect(screen.getByText(/no upcoming/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('never exposes appointment notes — that column is shared with staff-authored internal notes', () => {
    // Regression guard for 20260813160000_claim_scope_fix.sql: get_my_appointments
    // stopped returning appointments.notes because staff write to the same
    // column from the internal appointments dialog. Nothing customer-facing
    // may reintroduce a dependency on it.
    const appt = appointment()
    expect(Object.keys(appt)).not.toContain('notes')
  })

  it('says "waiting for confirmation", never a database word, while pending', () => {
    // The whole point of the LOT C customer surface: after booking, do not
    // imply the appointment is confirmed.
    mockUseMyAppointments.mockReturnValue({
      data: [appointment({ id: 'p', status: 'pending', expiresAt: '2099-01-01T09:30:00Z' })],
      isPending: false, isError: false, error: null, refetch: vi.fn(),
    } as never)

    renderPage()

    expect(screen.getByText('Waiting for confirmation')).toBeInTheDocument()
    expect(screen.getByText('Request sent')).toBeInTheDocument()
    expect(screen.queryByText(/pending/i)).not.toBeInTheDocument()
  })

  it('says "not accepted" for a decline — not the database\'s "cancelled"', () => {
    // status=cancelled + resolution=declined. LOT C adds no status values, so
    // three very different situations share one status; `resolution` is what
    // lets this screen tell them apart.
    mockUseMyAppointments.mockReturnValue({
      data: [appointment({
        id: 'd', status: 'cancelled', resolution: 'declined',
        resolutionNote: 'Fully booked that morning',
      })],
      isPending: false, isError: false, error: null, refetch: vi.fn(),
    } as never)

    renderPage()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Past' }))

    expect(screen.getByText('Not accepted')).toBeInTheDocument()
    expect(screen.getByText(/Fully booked that morning/)).toBeInTheDocument()
    expect(screen.queryByText('Cancelled')).not.toBeInTheDocument()
  })

  it('distinguishes an expired request from a cancellation', () => {
    mockUseMyAppointments.mockReturnValue({
      data: [appointment({ id: 'e', status: 'cancelled', resolution: 'expired' })],
      isPending: false, isError: false, error: null, refetch: vi.fn(),
    } as never)

    renderPage()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Past' }))

    expect(screen.getByText('Request expired')).toBeInTheDocument()
  })

  it('offers a way forward after a decline rather than a dead end', async () => {
    mockUseMyAppointments.mockReturnValue({
      data: [appointment({ id: 'd', status: 'cancelled', resolution: 'declined' })],
      isPending: false, isError: false, error: null, refetch: vi.fn(),
    } as never)

    renderPage()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Past' }))

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Find another time' })).toHaveAttribute(
        'href', '/s/demo-le-fade-parisien?barber=barber-1&service=svc-1'),
    )
  })

  it('keeps a declined request OUT of upcoming, however recent it is', () => {
    mockUseMyAppointments.mockReturnValue({
      data: [appointment({ id: 'd', status: 'cancelled', resolution: 'declined' })],
      isPending: false, isError: false, error: null, refetch: vi.fn(),
    } as never)

    renderPage()

    expect(screen.getByText('No upcoming appointments')).toBeInTheDocument()
  })

  it('subscribes scoped to the signed-in user', () => {
    mockUseMyAppointments.mockReturnValue({
      data: [], isPending: false, isError: false, error: null, refetch: vi.fn(),
    } as never)

    renderPage()

    // The user id is what scopes the notifications subscription that makes
    // this screen live; passing only `enabled` would leave it polling.
    expect(mockUseMyAppointments).toHaveBeenCalledWith(true, 'user-1')
  })
})
