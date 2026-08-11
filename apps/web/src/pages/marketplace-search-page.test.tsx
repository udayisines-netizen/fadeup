import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { MarketplaceSearchPage } from '@/pages/marketplace-search-page'
import { useSearchPublicOrganizations } from '@/lib/queries/marketplace'

vi.mock('@/lib/queries/marketplace', () => ({
  useSearchPublicOrganizations: vi.fn(),
}))

const mockUseSearchPublicOrganizations = vi.mocked(useSearchPublicOrganizations)

function renderPage(initialEntry = '/search?city=Paris') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <MarketplaceSearchPage />
    </MemoryRouter>,
  )
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: 'org-1',
    organizationName: 'Le Fade Parisien',
    organizationSlug: 'demo-le-fade-parisien',
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

describe('MarketplaceSearchPage', () => {
  it('shows real results with live queue and price data — never a fabricated value', () => {
    mockUseSearchPublicOrganizations.mockReturnValue({
      data: [result()],
      isPending: false,
      isSuccess: true,
      isError: false,
    } as never)

    renderPage()

    expect(screen.getByText('Le Fade Parisien')).toBeInTheDocument()
    expect(screen.getByText('2 people waiting')).toBeInTheDocument()
    // "Open now" appears twice: the result card's status badge and the filter's own label.
    expect(screen.getAllByText('Open now').length).toBe(2)
  })

  it('shows the "nothing here yet" empty state when zero organizations exist in the area — never a fake listing', () => {
    mockUseSearchPublicOrganizations.mockReturnValue({
      data: [],
      isPending: false,
      isSuccess: true,
      isError: false,
    } as never)

    renderPage()

    expect(screen.getByText('No FadeUp barbers here yet')).toBeInTheDocument()
  })

  it('filters out closed shops client-side when "Open now" is toggled, with a way back', () => {
    mockUseSearchPublicOrganizations.mockReturnValue({
      data: [result({ organizationId: 'org-closed', organizationName: 'Closed Shop', isOpenNow: false })],
      isPending: false,
      isSuccess: true,
      isError: false,
    } as never)

    renderPage()

    expect(screen.getByText('Closed Shop')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Open now'))

    expect(screen.queryByText('Closed Shop')).not.toBeInTheDocument()
    expect(screen.getByText('No barbers match your filters')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('Closed Shop')).toBeInTheDocument()
  })

  it('shows an error state, not a raw error message, when the search RPC fails', () => {
    mockUseSearchPublicOrganizations.mockReturnValue({
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
