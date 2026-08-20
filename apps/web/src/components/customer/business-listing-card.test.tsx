import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { BusinessListingCard } from '@/components/customer/business-listing-card'
import type { MarketplaceProfessionalResult } from '@/lib/queries/marketplace'

vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(() => ({ session: null, user: null, loading: false })),
}))

function renderCard(result: MarketplaceProfessionalResult, currency: string | undefined = 'EUR') {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BusinessListingCard result={result} currency={currency} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function shopResult(overrides: Partial<MarketplaceProfessionalResult> = {}): MarketplaceProfessionalResult {
  return {
    entityType: 'shop',
    organizationId: 'org-1',
    organizationName: 'Le Fade Parisien',
    organizationSlug: 'demo-le-fade-parisien',
    barberId: null,
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
    distanceKm: null,
    startingPriceCents: 1600,
    isOpenNow: true,
    queueWaitingCount: 0,
    totalCount: 1,
    ...overrides,
  }
}

/**
 * This card is what a customer chooses from. Most of these tests are about
 * what it must NOT say — the reference design carries a photo, a star rating,
 * a next-slot badge and a promo chip, and FadeUp has the data for none of them.
 */
describe('BusinessListingCard', () => {
  it('a shop links to its profile, and offers a direct route into booking', () => {
    renderCard(shopResult())

    expect(screen.getByRole('link', { name: 'Le Fade Parisien' })).toHaveAttribute(
      'href',
      '/s/demo-le-fade-parisien/profile',
    )
    expect(screen.getByRole('link', { name: 'Book' })).toHaveAttribute('href', '/s/demo-le-fade-parisien')
  })

  it('a professional links to their own page, and books with them preselected', () => {
    renderCard(
      shopResult({
        entityType: 'barber',
        barberId: 'barber-1',
        barberDisplayName: 'Karim Belhadj',
        barberTitle: 'Owner',
      }),
    )

    expect(screen.getByRole('link', { name: 'Karim Belhadj' })).toHaveAttribute(
      'href',
      '/s/demo-le-fade-parisien/barbers/barber-1',
    )
    expect(screen.getByRole('link', { name: 'Book' })).toHaveAttribute(
      'href',
      '/s/demo-le-fade-parisien?barber=barber-1',
    )
  })

  it('prices in the SHOP\'s currency, not the viewer\'s', () => {
    // A marketplace spans countries. Before LOT E every price rendered as USD.
    renderCard(shopResult({ startingPriceCents: 1600 }), 'GBP')

    expect(screen.getByText(/£16/)).toBeInTheDocument()
  })

  it('never renders a rating, a review count or a photo it does not have', () => {
    const { container } = renderCard(shopResult())

    expect(screen.queryByText(/★|\d[.,]\d\s*\/\s*5/)).not.toBeInTheDocument()
    expect(screen.queryByText(/review/i)).not.toBeInTheDocument()
    // A shop has no image column; only a professional's avatar is a real image.
    expect(container.querySelector('img')).toBeNull()
  })

  it('shows a professional’s real avatar when they published one', () => {
    const { container } = renderCard(
      shopResult({
        entityType: 'barber',
        barberId: 'barber-1',
        barberDisplayName: 'Karim Belhadj',
        barberAvatarUrl: 'https://cdn.example.test/karim.jpg',
      }),
    )

    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.test/karim.jpg')
  })

  it('stays silent about an empty queue rather than announcing zero', () => {
    renderCard(shopResult({ queueWaitingCount: 0 }))

    expect(screen.queryByText(/waiting/i)).not.toBeInTheDocument()
  })

  it('reports a real queue', () => {
    renderCard(shopResult({ queueWaitingCount: 3 }))

    expect(screen.getByText('3 people waiting')).toBeInTheDocument()
  })

  it('says nothing about hours when the shop has not published any', () => {
    // `null` means unknown, which is not the same as closed. Rendering it as
    // "Closed" would cost a shop customers for a field they never filled in.
    renderCard(shopResult({ isOpenNow: null }))

    expect(screen.queryByText('Open now')).not.toBeInTheDocument()
    expect(screen.queryByText('Closed')).not.toBeInTheDocument()
  })

  it('omits the price line entirely when no service is priced', () => {
    renderCard(shopResult({ startingPriceCents: null }))

    expect(screen.queryByText(/From/)).not.toBeInTheDocument()
  })
})
