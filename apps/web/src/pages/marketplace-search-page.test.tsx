import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { MarketplaceSearchPage } from '@/pages/marketplace-search-page'
import { useSearchPublicProfessionals } from '@/lib/queries/marketplace'

vi.mock('@/lib/queries/marketplace', () => ({
  useSearchPublicProfessionals: vi.fn(),
  // A marketplace spans countries, so each card is priced in its own shop's
  // currency — resolved in one batch call beside the search itself.
  usePublicCurrencies: () => ({ 'org-1': 'GBP', 'org-2': 'EUR' }),
}))

// BusinessListingCard renders a FavoriteButton, which needs both an
// auth context (logged-out here) and a QueryClient ancestor.
vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(() => ({ session: null, user: null, loading: false })),
}))

// GeoIP is a network call. The suggestion it produces is exercised in its own
// tests; here it must simply not reach out.
vi.mock('@/lib/intl/geo', () => ({
  useGeoSuggestion: () => ({
    countryCode: null,
    suggestedLocale: null,
    suggestedCurrency: null,
    suggestedTimezone: null,
  }),
}))

const mockUseSearchPublicProfessionals = vi.mocked(useSearchPublicProfessionals)

function renderPage(initialEntry = '/search?city=Paris') {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <MarketplaceSearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function shopResult(overrides: Record<string, unknown> = {}) {
  return {
    entityType: 'shop' as const,
    organizationId: 'org-1',
    organizationName: 'Le Fade Parisien',
    organizationSlug: 'demo-le-fade-parisien',
    barberId: null,
    barberDisplayName: null,
    barberAvatarUrl: null,
    barberTitle: null,
    locationId: 'loc-1',
    locationName: 'Le Marais',
    addressLine1: '12 Rue des Rosiers',
    city: 'Paris',
    region: 'Île-de-France',
    postalCode: '75004',
    country: 'FR',
    distanceKm: null,
    startingPriceCents: 1600,
    isOpenNow: true,
    queueWaitingCount: 2,
    totalCount: 1,
    ...overrides,
  }
}

function barberResult(overrides: Record<string, unknown> = {}) {
  return {
    ...shopResult(),
    entityType: 'barber' as const,
    barberId: 'barber-1',
    barberDisplayName: 'Karim Belhadj',
    barberTitle: 'Master barber',
    ...overrides,
  }
}

describe('MarketplaceSearchPage', () => {
  it('shows real shop and barber results with live queue and price data — never a fabricated value', () => {
    mockUseSearchPublicProfessionals.mockReturnValue({
      data: [shopResult(), barberResult()],
      isPending: false,
      isSuccess: true,
      isError: false,
    } as never)

    renderPage()

    // The shop appears as its own card AND as the shop a barber belongs to.
    expect(screen.getAllByText('Le Fade Parisien').length).toBe(2)
    expect(screen.getByText('Karim Belhadj')).toBeInTheDocument()
    expect(screen.getAllByText('2 people waiting').length).toBe(2)
    // "Open now": one status badge per open card, plus the filter chip.
    expect(screen.getAllByText('Open now').length).toBe(3)
  })

  it('never renders a rating or a photo it does not have', () => {
    mockUseSearchPublicProfessionals.mockReturnValue({
      data: [shopResult()],
      isPending: false,
      isSuccess: true,
      isError: false,
    } as never)

    const { container } = renderPage()

    // No reviews table exists. A star on a listing card is the single most
    // consequential thing this product could fabricate.
    expect(screen.queryByText(/\d[.,]\d\s*(★|\/5)/)).not.toBeInTheDocument()
    // A shop has no image column; a barber's avatar is the only real image.
    expect(container.querySelector('img')).toBeNull()
  })

  it('shows the "nothing here yet" empty state when zero professionals exist in the area — never a fake listing', () => {
    mockUseSearchPublicProfessionals.mockReturnValue({
      data: [],
      isPending: false,
      isSuccess: true,
      isError: false,
    } as never)

    renderPage()

    expect(screen.getByText('No FadeUp barbers here yet')).toBeInTheDocument()
  })

  it('shows the filtered-empty state (with a way to clear) when a filter param yields zero results', () => {
    mockUseSearchPublicProfessionals.mockReturnValue({
      data: [],
      isPending: false,
      isSuccess: true,
      isError: false,
    } as never)

    renderPage('/search?city=Paris&openNow=1')

    expect(screen.getByText('No barbers match your filters')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })

  it('toggling "Open now" calls the search hook with the server-side filter set', () => {
    mockUseSearchPublicProfessionals.mockReturnValue({
      data: [shopResult()],
      isPending: false,
      isSuccess: true,
      isError: false,
    } as never)

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Open now', pressed: false }))

    expect(mockUseSearchPublicProfessionals).toHaveBeenLastCalledWith(expect.objectContaining({ openNowOnly: true }))
  })

  it('the shop/barber chips call the search hook with the right entityType', () => {
    mockUseSearchPublicProfessionals.mockReturnValue({
      data: [barberResult()],
      isPending: false,
      isSuccess: true,
      isError: false,
    } as never)

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Barbers' }))

    expect(mockUseSearchPublicProfessionals).toHaveBeenLastCalledWith(expect.objectContaining({ entityType: 'barber' }))
  })

  it('sends a service chip to the SERVICE parameter, not the free-text query', () => {
    // p_query matches shop/professional/city names; service names are a
    // separate parameter. Collapsing the two would silently stop matching.
    mockUseSearchPublicProfessionals.mockReturnValue({
      data: [shopResult()],
      isPending: false,
      isSuccess: true,
      isError: false,
    } as never)

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Fade' }))

    expect(mockUseSearchPublicProfessionals).toHaveBeenLastCalledWith(
      expect.objectContaining({ serviceQuery: 'Fade', query: null }),
    )
  })

  it('keeps search state in the URL so a result page can be shared', () => {
    mockUseSearchPublicProfessionals.mockReturnValue({
      data: [shopResult()],
      isPending: false,
      isSuccess: true,
      isError: false,
    } as never)

    renderPage('/search?city=Paris&type=barber&openNow=1&service=Beard')

    expect(mockUseSearchPublicProfessionals).toHaveBeenLastCalledWith(
      expect.objectContaining({
        city: 'Paris',
        entityType: 'barber',
        openNowOnly: true,
        serviceQuery: 'Beard',
      }),
    )
  })

  it('shows an error state, not a raw error message, when the search RPC fails', () => {
    mockUseSearchPublicProfessionals.mockReturnValue({
      data: undefined,
      isPending: false,
      isSuccess: false,
      isError: true,
      error: new Error('network error'),
    } as never)

    renderPage()

    expect(screen.getByText("Couldn't load results")).toBeInTheDocument()
  })
})
