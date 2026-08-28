import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MarketplaceResults } from '@/components/marketplace/marketplace-results'
import { usePublicOrganizationBarbers } from '@/lib/queries/public-barber'
import { usePublicServices } from '@/lib/queries/public-booking'
import type { MarketplaceProfessionalResult } from '@/lib/queries/marketplace'

vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(() => ({ session: null, user: null, loading: false })),
}))
vi.mock('@/lib/queries/customer-app', () => ({
  useMyFavorites: vi.fn(() => ({ data: [], isPending: false })),
  useAddFavorite: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRemoveFavorite: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))
vi.mock('@/lib/queries/public-barber', () => ({ usePublicOrganizationBarbers: vi.fn() }))
vi.mock('@/lib/queries/public-booking', () => ({
  usePublicServices: vi.fn(),
  usePublicAvailableSlots: vi.fn(() => ({ data: [], isPending: false, isError: false, isSuccess: true, refetch: vi.fn() })),
  useBookPublicAppointment: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}))
vi.mock('@/lib/queries/customer-profile', () => ({
  useMyCustomerProfile: vi.fn(() => ({ data: null })),
  storePendingClaimToken: vi.fn(),
}))
vi.mock('@/lib/analytics', () => ({
  useAnalytics: vi.fn(() => ({ track: vi.fn() })),
  useTrackView: vi.fn(),
}))

const mockBarbers = vi.mocked(usePublicOrganizationBarbers)
const mockServices = vi.mocked(usePublicServices)

function shop(overrides: Partial<MarketplaceProfessionalResult> = {}): MarketplaceProfessionalResult {
  return {
    entityType: 'shop',
    organizationId: 'org-1',
    organizationName: 'Le Fade Parisien',
    organizationSlug: 'le-fade-parisien',
    barberId: null,
    professionalId: null,
    barberDisplayName: null,
    barberAvatarUrl: null,
    barberTitle: null,
    locationId: 'loc-1',
    locationName: 'Le Marais',
    addressLine1: null,
    city: 'Paris',
    region: null,
    postalCode: null,
    country: 'FR',
    latitude: 48.86,
    longitude: 2.35,
    timezone: 'Europe/Paris',
    distanceKm: null,
    startingPriceCents: 1600,
    isOpenNow: true,
    queueWaitingCount: 0,
    totalCount: 1,
    ...overrides,
  }
}

function renderResults(props: Partial<Parameters<typeof MarketplaceResults>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MarketplaceResults
          results={[shop()]}
          currencies={{ 'org-1': 'EUR' }}
          mode="list"
          onModeChange={vi.fn()}
          sort="recommended"
          onSortChange={vi.fn()}
          isPending={false}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('MarketplaceResults', () => {
  beforeEach(() => {
    mockBarbers.mockReturnValue({
      data: [
        {
          barberId: 'barber-1',
          professionalId: 'pro-1',
          displayName: 'Karim',
          title: 'Fade specialist',
          avatarUrl: null,
          locationId: 'loc-1',
          locationName: 'Le Marais',
        },
        {
          // Another branch of the same shop. Must NOT appear under a card
          // whose address says Le Marais.
          barberId: 'barber-2',
          professionalId: null,
          displayName: 'Sofia',
          title: null,
          avatarUrl: null,
          locationId: 'loc-2',
          locationName: 'Belleville',
        },
      ],
      isPending: false,
      isError: false,
    } as never)

    mockServices.mockReturnValue({
      data: [{ id: 'svc-1', categoryId: null, categoryName: null, name: 'Fade', description: null, durationMinutes: 30, priceCents: 2500 }],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as never)
  })

  it('does not fetch a shop team until the card is actually expanded', () => {
    // A page of twenty results firing twenty team queries for the one card
    // somebody might open is the difference between a fast marketplace and a
    // slow one, and it is invisible in a screenshot.
    renderResults()
    expect(mockBarbers).not.toHaveBeenCalled()
  })

  it('expands in place into the shop team rather than navigating away', async () => {
    renderResults()

    const toggle = screen.getByRole('button', { name: /Choose a professional/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(screen.getByText('Karim')).toBeInTheDocument())
  })

  it('offers only the professionals who work at THIS location', async () => {
    renderResults()
    fireEvent.click(screen.getByRole('button', { name: /Choose a professional/ }))

    await waitFor(() => expect(screen.getByText('Karim')).toBeInTheDocument())
    // A shop with three branches must not offer a barber from across town
    // under a card whose address names one of them.
    expect(screen.queryByText('Sofia')).not.toBeInTheDocument()
  })

  it('keeps one card open at a time', async () => {
    renderResults({
      results: [shop(), shop({ organizationId: 'org-2', organizationSlug: 'other', organizationName: 'Other Shop', locationId: 'loc-9' })],
      currencies: { 'org-1': 'EUR', 'org-2': 'EUR' },
    })

    const toggles = screen.getAllByRole('button', { name: /Choose a professional/ })
    fireEvent.click(toggles[0]!)
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(toggles[1]!)
    // Two open cards means the second pushes the first off screen while the
    // customer is reading it.
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'false')
    expect(toggles[1]).toHaveAttribute('aria-expanded', 'true')
  })

  it('choosing a professional opens booking IN PLACE, starting at the service step', async () => {
    renderResults()
    fireEvent.click(screen.getByRole('button', { name: /Choose a professional/ }))
    await waitFor(() => expect(screen.getByText('Karim')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Karim/ }))

    const dialog = await screen.findByRole('dialog')
    // Criterion J: after the barber, the remaining questions are service,
    // slot, confirm — and the first one is on screen without a navigation.
    expect(within(dialog).getByText('Book with Karim')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Fade/ })).toBeInTheDocument()
  })

  it('shows no rating and no next-slot time on a collapsed card', () => {
    // There is no reviews table, and availability is a function of a service
    // that has not been chosen. Both would have to be invented.
    renderResults()
    expect(screen.queryByText(/★|stars?|rating/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/From \d/)).not.toBeInTheDocument()
  })

  it('has no Follow control on a marketplace card, but does have Favourite', () => {
    // §9 is explicit. Follow belongs on a profile; Favourite is what a list is
    // for.
    renderResults()
    expect(screen.queryByRole('button', { name: 'Follow' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Follow' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add to favorites' })).toBeInTheDocument()
  })

  it('offers only sorts the database can actually back', () => {
    renderResults()
    const select = screen.getByRole('combobox', { name: 'Sort' })
    const options = within(select).getAllByRole('option').map((option) => option.textContent)
    // "Available soonest" needs a service; "Highest rated" needs reviews.
    // Offering either would be a control that does nothing.
    expect(options).toEqual(['Recommended', 'Nearest', 'Price'])
  })

  it('reports a result opening with its 1-based rank', () => {
    const onOpenResult = vi.fn()
    renderResults({ onOpenResult })

    fireEvent.click(screen.getByRole('link', { name: 'View profile' }))

    expect(onOpenResult).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-1' }), 0)
  })
})
