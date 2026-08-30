import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { MyAppointment } from '@/lib/queries/customer-app'
import { CustomerV2AppointmentsPage } from '@/customer-v2/appointments/appointments-page'

/**
 * The appointments contract: the split is stage-driven, and Book again carries
 * the shop, the location and the barber — never the stale service.
 */

const state: { appointments: MyAppointment[]; user: { id: string } | null } = {
  appointments: [],
  user: { id: 'user-1' },
}

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ session: null, user: state.user, loading: false }),
}))

vi.mock('@/lib/calendar/ics', () => ({ downloadIcs: vi.fn() }))

vi.mock('@/lib/queries/customer-app', async (importOriginal) => {
  // The REAL bookingStage/isLiveStage run — they are the logic under test.
  const original = await importOriginal<typeof import('@/lib/queries/customer-app')>()
  return {
    ...original,
    useMyAppointments: () => ({
      data: state.appointments,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useCancelMyAppointment: () => ({ mutate: vi.fn(), isPending: false }),
    useMyQueueStatus: () => ({ data: [] }),
  }
})

const base: MyAppointment = {
  id: 'appt-1',
  organizationId: 'org-1',
  organizationName: 'Side Agency',
  organizationSlug: 'side-agency',
  locationId: 'loc-1',
  locationName: 'Side Agency',
  barberId: 'barber-1',
  barberDisplayName: 'Barber Test',
  serviceId: 'svc-1',
  serviceName: 'Classic cut',
  startsAt: '2099-01-01T10:00:00Z',
  endsAt: '2099-01-01T10:30:00Z',
  status: 'confirmed',
  priceCents: 2500,
  currency: 'EUR',
  locationTimezone: 'Europe/Paris',
  resolution: null,
  resolutionNote: null,
  expiresAt: null,
  createdAt: '2026-01-01T00:00:00Z',
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CustomerV2AppointmentsPage />
    </MemoryRouter>,
  )
}

describe('the split is stage-driven', () => {
  it('puts a future confirmed booking under Upcoming and a completed one under Past', () => {
    state.appointments = [
      base,
      {
        ...base,
        id: 'appt-2',
        status: 'completed',
        startsAt: '2026-01-10T10:00:00Z',
        endsAt: '2026-01-10T10:30:00Z',
      },
    ]
    renderPage()

    expect(screen.getByRole('heading', { name: 'Upcoming' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Past' })).toBeInTheDocument()
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  it('files a confirmed appointment whose time already passed under Past', () => {
    state.appointments = [
      {
        ...base,
        id: 'appt-3',
        status: 'confirmed',
        startsAt: '2026-01-10T10:00:00Z',
        endsAt: '2026-01-10T10:30:00Z',
      },
    ]
    renderPage()

    expect(screen.queryByRole('heading', { name: 'Upcoming' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Past' })).toBeInTheDocument()
  })
})

describe('Book again preserves the real context', () => {
  it('carries shop, location and barber into the greenfield booking flow', () => {
    state.appointments = [
      {
        ...base,
        id: 'appt-4',
        status: 'completed',
        startsAt: '2026-01-10T10:00:00Z',
        endsAt: '2026-01-10T10:30:00Z',
      },
    ]
    renderPage()

    expect(screen.getByRole('link', { name: 'Book again' })).toHaveAttribute(
      'href',
      '/_preview/r5r/s/side-agency/book?location=loc-1&barber=barber-1',
    )
  })
})

describe('truthful gates', () => {
  it('asks a signed-out visitor to sign in rather than showing nothing', () => {
    state.user = null
    state.appointments = []
    renderPage()

    expect(
      screen.getByRole('heading', { name: 'Sign in to see your appointments' }),
    ).toBeInTheDocument()
    state.user = { id: 'user-1' }
  })

  it('shows the honest empty state with a path into discovery', () => {
    state.appointments = []
    renderPage()

    expect(screen.getByRole('heading', { name: 'No appointments yet' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Find your next barber' })).toBeInTheDocument()
  })
})
