import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerDiscoverPage } from '@/pages/customer/discover-page'
import { useMyCustomerProfile } from '@/lib/queries/customer-profile'
import { useMyAppointments, useMyQueueStatus } from '@/lib/queries/customer-app'
import { useSearchPublicProfessionals } from '@/lib/queries/marketplace'
import { useGeoSuggestion } from '@/lib/intl/geo'

vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(() => ({ session: null, user: { id: 'user-1' }, loading: false })),
}))
vi.mock('@/lib/queries/customer-profile', () => ({ useMyCustomerProfile: vi.fn() }))
vi.mock('@/lib/queries/customer-app', () => ({ useMyAppointments: vi.fn(), useMyQueueStatus: vi.fn() }))
vi.mock('@/lib/queries/marketplace', () => ({
  useSearchPublicProfessionals: vi.fn(),
  usePublicCurrencies: () => ({}),
}))
vi.mock('@/lib/intl/geo', () => ({ useGeoSuggestion: vi.fn() }))

const mockProfile = vi.mocked(useMyCustomerProfile)
const mockAppointments = vi.mocked(useMyAppointments)
const mockQueue = vi.mocked(useMyQueueStatus)
const mockSearch = vi.mocked(useSearchPublicProfessionals)
const mockGeo = vi.mocked(useGeoSuggestion)

function fromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appt-1',
    organizationId: 'org-1',
    organizationName: 'Le Fade Parisien',
    organizationSlug: 'le-fade-parisien',
    locationId: 'loc-1',
    locationName: 'Le Marais',
    barberId: 'barber-1',
    barberDisplayName: 'Karim',
    serviceId: 'svc-1',
    serviceName: 'Fade',
    startsAt: fromNow(60 * 24),
    endsAt: fromNow(60 * 25),
    status: 'confirmed',
    priceCents: 2500,
    currency: 'EUR',
    locationTimezone: 'Europe/Paris',
    resolution: null,
    resolutionNote: null,
    expiresAt: null,
    createdAt: fromNow(-600),
    ...overrides,
  }
}

function renderPage() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/customer']}>
        <CustomerDiscoverPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/**
 * The signed-in customer home. V1 was a stack of equal-weight cards whose
 * discovery section was a button to another page; these tests pin the two
 * things that fixed it — search is on the page, and exactly one line of
 * context sits above it.
 */
describe('CustomerDiscoverPage', () => {
  beforeEach(() => {
    mockProfile.mockReturnValue({
      data: { onboardingCompletedAt: '2026-01-01T00:00:00Z', haircutFrequency: null },
      isPending: false,
      isError: false,
    } as never)
    mockQueue.mockReturnValue({ data: [], isPending: false, isError: false } as never)
    mockAppointments.mockReturnValue({ data: [], isPending: false, isError: false } as never)
    mockSearch.mockReturnValue({ data: [], isPending: false, isSuccess: true, isError: false } as never)
    mockGeo.mockReturnValue({
      countryCode: null,
      suggestedLocale: null,
      suggestedCurrency: null,
      suggestedTimezone: null,
    } as never)
  })

  it('puts search on the page instead of a link to it', () => {
    renderPage()

    expect(screen.getByRole('search')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Find a barber' })).toBeInTheDocument()
  })

  it('leads with a live queue over everything else', () => {
    mockQueue.mockReturnValue({
      data: [
        {
          status: 'waiting',
          queuePosition: 3,
          organizationName: 'Le Fade Parisien',
          organizationSlug: 'le-fade-parisien',
        },
      ],
      isPending: false,
      isError: false,
    } as never)
    mockAppointments.mockReturnValue({ data: [appointment()], isPending: false, isError: false } as never)

    renderPage()

    expect(screen.getByText("You're in line")).toBeInTheDocument()
    expect(screen.getByText('2 people ahead of you')).toBeInTheDocument()
    // One context row, not a stack: the appointment must not also appear.
    expect(screen.queryByText('Upcoming appointment')).not.toBeInTheDocument()
  })

  it('falls back to the next appointment when no queue is active', () => {
    mockAppointments.mockReturnValue({ data: [appointment()], isPending: false, isError: false } as never)

    renderPage()

    expect(screen.getByText('Upcoming appointment')).toBeInTheDocument()
  })

  it('renders no context row at all for a customer with no history', () => {
    renderPage()

    expect(screen.queryByText("You're in line")).not.toBeInTheDocument()
    expect(screen.queryByText('Upcoming appointment')).not.toBeInTheDocument()
    // An empty state for "you have no appointments" on a discovery page is a
    // card that exists to say nothing.
    expect(screen.queryByText(/no appointments/i)).not.toBeInTheDocument()
  })

  it('lets search load even while the customer context is still pending', () => {
    mockAppointments.mockReturnValue({ data: undefined, isPending: true, isError: false } as never)

    renderPage()

    // The one thing on this page that must be usable immediately.
    expect(screen.getByRole('search')).toBeInTheDocument()
  })

  it('passes the GeoIP country to the search as a removable starting filter', () => {
    mockGeo.mockReturnValue({
      countryCode: 'FR',
      suggestedLocale: 'fr',
      suggestedCurrency: 'EUR',
      suggestedTimezone: 'Europe/Paris',
    } as never)

    renderPage()

    expect(mockSearch).toHaveBeenLastCalledWith(expect.objectContaining({ country: 'FR' }))
    // Visible and reversible — a filter a customer cannot see is a filter
    // that makes the marketplace look empty for no discoverable reason.
    expect(screen.getByRole('button', { name: /Search everywhere/ })).toBeInTheDocument()
  })
})
