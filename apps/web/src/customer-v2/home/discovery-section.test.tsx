import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { MarketplaceProfessionalResult } from '@/lib/queries/marketplace'
import type { DiscoveryListing, HomeDiscovery } from '@/customer-v2/hooks/use-home-discovery'
import { DiscoverySection } from '@/customer-v2/home/discovery-section'

/**
 * The rules that keep Home's groups honest.
 *
 * Splitting one list into two named groups is the change most capable of
 * quietly reintroducing fabricated structure: a heading that renders when its
 * query found nothing is a section promising content that does not exist, and a
 * count taken from the loaded page instead of the server's total is a smaller
 * version of the same lie. Both look completely correct in review against a
 * two-row database, which is exactly why they are asserted here.
 */

function row(overrides: Partial<MarketplaceProfessionalResult> = {}): MarketplaceProfessionalResult {
  return {
    entityType: 'barber',
    organizationId: 'org-1',
    organizationName: 'Side Agency',
    organizationSlug: 'side-agency',
    barberId: 'barber-1',
    professionalId: 'pro-1',
    barberDisplayName: 'Barber Test',
    barberAvatarUrl: null,
    barberTitle: null,
    locationId: 'loc-1',
    locationName: 'Side Agency',
    addressLine1: '19 rue Danton',
    city: 'Antony (92)',
    region: null,
    postalCode: null,
    country: 'FR',
    latitude: null,
    longitude: null,
    timezone: 'Europe/Paris',
    distanceKm: null,
    startingPriceCents: null,
    isOpenNow: null,
    queueWaitingCount: 0,
    totalCount: 1,
    marketplaceSupplyType: null,
    ...overrides,
  }
}

function listing(
  overrides: Partial<MarketplaceProfessionalResult> = {},
  supplyType: DiscoveryListing['supplyType'] = null,
): DiscoveryListing {
  return { result: row(overrides), supplyType }
}

function renderSection(overrides: Partial<HomeDiscovery> = {}) {
  const discovery: HomeDiscovery = {
    listings: [],
    totalCount: 0,
    currencyByOrganization: { 'org-1': 'EUR' },
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
    isFiltered: false,
    hasQuery: false,
    hasFacet: false,
    isNearest: false,
    ...overrides,
  }

  return render(
    <MemoryRouter>
      <DiscoverySection discovery={discovery} onClearFilters={vi.fn()} onSearchEverywhere={null} />
    </MemoryRouter>,
  )
}

describe('DiscoverySection presents one unified list', () => {
  it('heads the list "Near you" and draws no entity-type sections', () => {
    renderSection({ listings: [listing(), listing({ locationId: 'loc-2' })], totalCount: 2 })

    expect(screen.getByRole('heading', { name: 'Near you' })).toBeInTheDocument()

    /*
      The correction this lot exists for. "Barbers" and "Barbershops" published
      the RPC's internal row shape as a customer taxonomy; neither may return as
      a visible grouping.
    */
    expect(screen.queryByRole('heading', { name: 'Barbers' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Barbershops' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1)
  })

  it("uses the server's total, not the number of rows on screen", () => {
    // Home asks for twelve. A filter whose server total is forty must say
    // forty, or the count silently becomes a page size.
    renderSection({ listings: [listing()], totalCount: 40 })

    expect(screen.getByText('40 results')).toBeInTheDocument()
  })

  it('says nothing about ordering unless the results were genuinely sorted by distance', () => {
    const { unmount } = renderSection({ listings: [listing()], totalCount: 1 })
    expect(screen.queryByText(/Nearest first/)).not.toBeInTheDocument()
    unmount()

    renderSection({ listings: [listing()], totalCount: 1, isNearest: true })
    expect(screen.getByText(/Nearest first/)).toBeInTheDocument()
  })
})

describe('DiscoverySection states', () => {
  it('shows the failure notice when the marketplace could not be reached', () => {
    renderSection({ isError: true })

    expect(screen.getByRole('heading', { name: 'The marketplace did not answer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('distinguishes an empty country from a query that matched nothing', () => {
    const { unmount } = renderSection({ listings: [], totalCount: 0 })
    expect(screen.getByRole('heading', { name: 'No one listed here yet' })).toBeInTheDocument()
    unmount()

    renderSection({ listings: [], totalCount: 0, isFiltered: true, hasQuery: true })
    expect(screen.getByRole('heading', { name: 'Nothing matches that' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument()
  })
})
