/**
 * The V3 result grammar's truth contract — the assertions carried over from
 * the deleted R5R `professional-result.test.tsx`, re-expressed against the
 * V3 row. A null never falls back to a default: `isOpenNow === null` says
 * NOTHING (not "Closed"), a queue of zero says nothing, a price without its
 * resolved currency waits rather than guessing EUR, and no rating or photo
 * chrome exists at all while those contracts do not.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import type { MarketplaceProfessionalResult } from '@/lib/queries/marketplace'
import { ResultRow } from '@/customer-v3/ui/result-row'

const base: MarketplaceProfessionalResult = {
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
  city: 'Antony',
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
  marketplaceSupplyType: 'barbershop',
}

function renderRow(overrides: Partial<MarketplaceProfessionalResult>, currency?: string) {
  return render(
    <MemoryRouter>
      <ResultRow result={{ ...base, ...overrides }} currency={currency} />
    </MemoryRouter>,
  )
}

describe('a null renders nothing', () => {
  it('says nothing about open state when the server does not know', () => {
    renderRow({ isOpenNow: null })
    expect(screen.queryByText(/open/i)).toBeNull()
    expect(screen.queryByText(/closed/i)).toBeNull()
  })

  it('says Closed only when the server said closed', () => {
    renderRow({ isOpenNow: false })
    expect(screen.getByText(/closed/i)).toBeTruthy()
  })

  it('renders no distance without coordinates-derived distance', () => {
    renderRow({ distanceKm: null })
    expect(screen.queryByText(/km/)).toBeNull()
  })

  it('renders no price until the org currency has resolved', () => {
    renderRow({ startingPriceCents: 2500 }, undefined)
    expect(screen.queryByText(/25/)).toBeNull()
  })

  it('renders the real price once the currency is known', () => {
    renderRow({ startingPriceCents: 2500 }, 'EUR')
    expect(screen.getByText(/25/)).toBeTruthy()
  })
})

describe('queue truth', () => {
  it('renders no queue line at zero waiting', () => {
    renderRow({ queueWaitingCount: 0 })
    expect(screen.queryByText(/waiting/i)).toBeNull()
  })

  it('renders the real count above zero', () => {
    renderRow({ queueWaitingCount: 3, isOpenNow: true })
    expect(screen.getByText(/3/)).toBeTruthy()
  })

  it('never renders invented wait minutes', () => {
    renderRow({ queueWaitingCount: 3 })
    expect(screen.queryByText(/min/i)).toBeNull()
  })
})

describe('supply vocabulary', () => {
  it('labels a NULL supply type with nothing, never a guess', () => {
    renderRow({ marketplaceSupplyType: null })
    expect(screen.queryByText(/barbershop/i)).toBeNull()
    expect(screen.queryByText(/independent/i)).toBeNull()
  })
})

describe('no fabricated chrome', () => {
  it('renders no rating star and no image frame (no contracts exist)', () => {
    const { container } = renderRow({})
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByText(/★/)).toBeNull()
  })

  it('Book is the only filled-green action and carries the location', () => {
    renderRow({})
    const book = screen.getByRole('link', { name: /book at/i })
    expect(book.getAttribute('href')).toContain('/s/side-agency/book')
    expect(book.getAttribute('href')).toContain('location=loc-1')
  })
})
