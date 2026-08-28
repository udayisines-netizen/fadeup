import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerDiscoverPage } from '@/pages/customer/discover-page'
import { useMyCustomerProfile } from '@/lib/queries/customer-profile'
import { useMyAppointments, useMyFavorites, useMyQueueStatus } from '@/lib/queries/customer-app'
import { useSearchPublicProfessionals } from '@/lib/queries/marketplace'
import { useGeoSuggestion } from '@/lib/intl/geo'

vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(() => ({ session: null, user: { id: 'user-1' }, loading: false })),
}))
vi.mock('@/lib/queries/customer-profile', () => ({ useMyCustomerProfile: vi.fn() }))
vi.mock('@/lib/queries/customer-app', () => ({
  useMyAppointments: vi.fn(),
  useMyQueueStatus: vi.fn(),
  useMyFavorites: vi.fn(),
}))
vi.mock('@/lib/queries/marketplace', () => ({
  useSearchPublicProfessionals: vi.fn(),
  usePublicCurrencies: () => ({}),
}))
vi.mock('@/lib/intl/geo', () => ({ useGeoSuggestion: vi.fn() }))

const mockProfile = vi.mocked(useMyCustomerProfile)
const mockAppointments = vi.mocked(useMyAppointments)
const mockQueue = vi.mocked(useMyQueueStatus)
const mockFavorites = vi.mocked(useMyFavorites)
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
 * The signed-in customer home.
 *
 * R5 split Discover and Search back into two destinations, so what these tests
 * pin has changed: Discover is now social and local — one line of context,
 * the places this customer kept, and what is near them — and the search FORM
 * is deliberately no longer on it. The V2 assertion that "search is on the
 * page" was correct for V2 and is exactly what R5 reverses; the reason it was
 * added (Discover must not be a card containing a link to Search) is pinned
 * instead by Search being a real tab in `customer-shell.test.tsx`.
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
    mockFavorites.mockReturnValue({ data: [], isPending: false, isError: false } as never)
    mockSearch.mockReturnValue({ data: [], isPending: false, isSuccess: true, isError: false } as never)
    mockGeo.mockReturnValue({
      countryCode: null,
      suggestedLocale: null,
      suggestedCurrency: null,
      suggestedTimezone: null,
    } as never)
  })

  it('no longer carries the search form — Search is its own destination', () => {
    renderPage()
    expect(screen.queryByRole('search')).not.toBeInTheDocument()
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

  it('shows what is nearby even while the customer context is still pending', () => {
    mockAppointments.mockReturnValue({ data: undefined, isPending: true, isError: false } as never)

    renderPage()

    // The context row is a skeleton, but the nearby section has already asked
    // its own question — a slow appointments query must not hold it hostage.
    expect(screen.getByRole('heading', { name: 'Near you' })).toBeInTheDocument()
  })

  it('scopes "near you" to the GeoIP country and names it in the heading', () => {
    mockGeo.mockReturnValue({
      countryCode: 'FR',
      suggestedLocale: 'fr',
      suggestedCurrency: 'EUR',
      suggestedTimezone: 'Europe/Paris',
    } as never)

    renderPage()

    expect(mockSearch).toHaveBeenLastCalledWith(expect.objectContaining({ country: 'FR' }))
    // The country NAME, never the ISO code — "Near you in France", not "in FR".
    expect(screen.getByRole('heading', { name: 'Near you in France' })).toBeInTheDocument()
  })

  it('surfaces saved places, and links a saved BARBER to that barber rather than the shop', () => {
    mockFavorites.mockReturnValue({
      data: [
        {
          favoriteId: 'fav-1',
          organizationId: 'org-1',
          organizationName: 'Le Fade Parisien',
          organizationSlug: 'le-fade-parisien',
          barberId: 'barber-1',
          barberDisplayName: 'Karim',
          barberAvatarUrl: null,
          createdAt: fromNow(-6000),
        },
      ],
      isPending: false,
      isError: false,
    } as never)

    renderPage()

    expect(screen.getByRole('link', { name: /Karim/ })).toHaveAttribute(
      'href',
      '/s/le-fade-parisien/barbers/barber-1',
    )
  })

  it('offers search rather than an error panel when nothing is nearby', () => {
    // A failed proximity query and a genuinely empty one leave the customer
    // needing the same escape hatch, and an error panel on a home screen is
    // heavier than the situation warrants.
    mockSearch.mockReturnValue({ data: [], isPending: false, isSuccess: true, isError: true } as never)

    renderPage()

    expect(screen.getByRole('link', { name: 'Open search' })).toHaveAttribute(
      'href',
      '/app/customer/search',
    )
  })
})
