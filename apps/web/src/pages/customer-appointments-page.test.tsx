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

vi.mock('@/lib/queries/customer-app', () => ({
  useMyAppointments: vi.fn(),
  useCancelMyAppointment: vi.fn(),
}))

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
    notes: null,
    priceCents: 2000,
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

  it('splits appointments into upcoming (cancellable) and past (rebookable) correctly', async () => {
    mockUseMyAppointments.mockReturnValue({
      data: [appointment({ id: 'upcoming', status: 'pending' }), appointment({ id: 'past', status: 'completed' })],
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as never)

    renderPage()

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
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
})
