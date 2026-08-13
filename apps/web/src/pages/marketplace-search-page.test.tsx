import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { MarketplaceSearchPage } from '@/pages/marketplace-search-page'
import { useSearchPublicProfessionals } from '@/lib/queries/marketplace'

vi.mock('@/lib/queries/marketplace', () => ({
  useSearchPublicProfessionals: vi.fn(),
}))

const mockUseSearchPublicProfessionals = vi.mocked(useSearchPublicProfessionals)

function renderPage(initialEntry = '/search?city=Paris') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <MarketplaceSearchPage />
    </MemoryRouter>,
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

    expect(screen.getByText('Le Fade Parisien')).toBeInTheDocument()
    expect(screen.getByText('Karim Belhadj')).toBeInTheDocument()
    expect(screen.getAllByText('2 people waiting').length).toBe(2)
    // "Open now" appears three times: once per result card's status badge, plus the filter switch's own label.
    expect(screen.getAllByText('Open now').length).toBe(3)
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

    fireEvent.click(screen.getByLabelText('Open now'))

    expect(mockUseSearchPublicProfessionals).toHaveBeenLastCalledWith(expect.objectContaining({ openNowOnly: true }))
  })

  it('the shop/barber segmented filter calls the search hook with the right entityType', () => {
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
