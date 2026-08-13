import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ProfessionalResultCard } from '@/components/marketplace/professional-result-card'
import type { MarketplaceProfessionalResult } from '@/lib/queries/marketplace'

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

describe('ProfessionalResultCard', () => {
  it('a shop result links "View profile" to the shop profile page and "Book" straight into the wizard', () => {
    render(
      <MemoryRouter>
        <ProfessionalResultCard result={shopResult()} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute('href', '/s/demo-le-fade-parisien/profile')
    expect(screen.getByRole('link', { name: 'Book' })).toHaveAttribute('href', '/s/demo-le-fade-parisien')
  })

  it('a barber result links "View profile" to the barber page and "Book" with the barber preselected', () => {
    render(
      <MemoryRouter>
        <ProfessionalResultCard
          result={shopResult({ entityType: 'barber', barberId: 'barber-1', barberDisplayName: 'Karim Belhadj', barberTitle: 'Owner' })}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute(
      'href',
      '/s/demo-le-fade-parisien/barbers/barber-1',
    )
    expect(screen.getByRole('link', { name: 'Book' })).toHaveAttribute('href', '/s/demo-le-fade-parisien?barber=barber-1')
  })
})
