import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { MarketplaceProfessionalResult } from '@/lib/queries/marketplace'
import type { CustomerLocation } from '@/customer-v2/hooks/use-customer-location'
import type { MarketplaceDiscovery } from '@/customer-v2/hooks/use-marketplace-discovery'
import { CustomerV2MarketplacePage } from '@/customer-v2/marketplace/marketplace-page'

/**
 * The Marketplace's product contract, as assertions.
 *
 * What must never regress: ONE unified list (entity-type sections were the
 * R5R.1A-R2 correction), a sort control that only offers orderings the query
 * can honour, and a Show-more that appears exactly when the server says more
 * rows exist.
 */

const location: CustomerLocation = {
  precision: 'country',
  countryCode: 'FR',
  countryLabel: 'France',
  isAnywhere: false,
  coordinates: null,
  radiusKm: null,
  preciseStatus: 'idle',
  requestPrecise: vi.fn(),
  clearPrecise: vi.fn(),
  chooseCountry: vi.fn(),
}

vi.mock('@/customer-v2/hooks/use-customer-location', () => ({
  PRECISE_RADIUS_KM: 25,
  useCustomerLocation: () => location,
}))

function row(overrides: Partial<MarketplaceProfessionalResult> = {}): MarketplaceProfessionalResult {
  return {
    entityType: 'shop',
    organizationId: 'org-1',
    organizationName: 'Side Agency',
    organizationSlug: 'side-agency',
    barberId: null,
    professionalId: null,
    barberDisplayName: null,
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
    startingPriceCents: 2500,
    isOpenNow: null,
    queueWaitingCount: 0,
    totalCount: 1,
    marketplaceSupplyType: 'barbershop',
    ...overrides,
  }
}

const discovery: MarketplaceDiscovery = {
  listings: [{ result: row(), supplyType: 'barbershop' }],
  totalCount: 1,
  currencyByOrganization: { 'org-1': 'EUR' },
  isPending: false,
  isFetching: false,
  isError: false,
  refetch: vi.fn(),
  isFiltered: false,
  hasQuery: false,
  hasFacet: false,
  hasMore: false,
  showMore: vi.fn(),
}

const useMarketplaceDiscovery = vi.fn((_input: unknown) => discovery)
vi.mock('@/customer-v2/hooks/use-marketplace-discovery', () => ({
  useMarketplaceDiscovery: (input: unknown) => useMarketplaceDiscovery(input),
}))

function renderPage(overrides: Partial<MarketplaceDiscovery> = {}) {
  useMarketplaceDiscovery.mockReturnValue({ ...discovery, ...overrides })
  return render(
    <MemoryRouter>
      <CustomerV2MarketplacePage />
    </MemoryRouter>,
  )
}

describe('Marketplace is one unified supply list', () => {
  it('renders a single results section and no entity-type grouping', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Marketplace' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Barbers' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Barbershops' })).not.toBeInTheDocument()

    // The listing carries its supply label and its Book action.
    expect(screen.getByText('Barbershop')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Book' })).toHaveAttribute(
      'href',
      '/s/side-agency?location=loc-1',
    )
  })

  it("shows the server's total beside the results heading", () => {
    renderPage({ totalCount: 40 })

    expect(screen.getByText('40 results')).toBeInTheDocument()
  })
})

describe('the sort control only offers honourable orderings', () => {
  it('hides Nearest while precise location is off', () => {
    // The mocked location is country-precision: no coordinates, no distance,
    // so a Nearest chip would be a placebo.
    renderPage()

    expect(screen.getByRole('button', { name: 'Recommended' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Price' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nearest' })).not.toBeInTheDocument()
  })

  it('marks exactly one sort as selected', () => {
    renderPage()

    const pressed = [
      screen.getByRole('button', { name: 'Recommended' }),
      screen.getByRole('button', { name: 'Price' }),
    ].filter((chip) => chip.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
  })
})

describe('paging follows the server total', () => {
  it('offers Show more only when the server says more rows exist', () => {
    const { unmount } = renderPage({ hasMore: false })
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
    unmount()

    renderPage({ hasMore: true, totalCount: 40 })
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument()
  })
})
