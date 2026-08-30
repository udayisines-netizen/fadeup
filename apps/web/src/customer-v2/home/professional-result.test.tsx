import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { MarketplaceProfessionalResult } from '@/lib/queries/marketplace'
import { ProfessionalResult } from '@/customer-v2/home/professional-result'
import type { MarketplaceSupplyType } from '@/customer-v2/marketplace-supply'

/**
 * The data-honesty contract of the R5R result, expressed as assertions.
 *
 * Every value on a marketplace result is nullable, and each null means
 * something specific: no published opening hours, no shared coordinates, no
 * resolved currency. The rule this file locks down is that a null renders
 * NOTHING — never a zero, never a dash, never "Closed" standing in for
 * "unknown".
 *
 * It is a test rather than a comment because the failure is invisible in
 * review: `{result.isOpenNow ? 'Open' : 'Closed'}` looks correct on the page
 * and quietly tells a customer a shop is shut when FadeUp has no idea.
 */

const BASE: MarketplaceProfessionalResult = {
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
  startingPriceCents: null,
  isOpenNow: null,
  queueWaitingCount: 0,
  totalCount: 1,
  marketplaceSupplyType: null,
}

function renderResult(
  overrides: Partial<MarketplaceProfessionalResult>,
  currency?: string,
  supplyType: MarketplaceSupplyType | null = null,
) {
  return render(
    <MemoryRouter>
      <ProfessionalResult
        result={{ ...BASE, ...overrides }}
        supplyType={supplyType}
        currency={currency}
        index={0}
      />
    </MemoryRouter>,
  )
}

describe('ProfessionalResult renders only what is real', () => {
  it('says nothing about opening state when the backend does not know', () => {
    renderResult({ isOpenNow: null })

    expect(screen.queryByText('Open')).not.toBeInTheDocument()
    expect(screen.queryByText('Closed')).not.toBeInTheDocument()
  })

  it('distinguishes open from closed when the backend does know', () => {
    const { unmount } = renderResult({ isOpenNow: true })
    expect(screen.getByText('Open')).toBeInTheDocument()
    unmount()

    renderResult({ isOpenNow: false })
    expect(screen.getByText('Closed')).toBeInTheDocument()
  })

  it('omits distance until coordinates have actually been shared', () => {
    const { unmount } = renderResult({ distanceKm: null })
    expect(screen.queryByText(/km/)).not.toBeInTheDocument()
    unmount()

    renderResult({ distanceKm: 1.2 })
    expect(screen.getByText(/1[.,]2\s*km/)).toBeInTheDocument()
  })

  it('omits the price when the organization currency has not resolved', () => {
    // A number without the right currency beside it is a WRONG price, not a
    // partial one — a Tokyo shop's 2500 is not €25.
    renderResult({ startingPriceCents: 2500 }, undefined)
    expect(screen.queryByText(/25/)).not.toBeInTheDocument()
  })

  it('prices in the business currency once it is known', () => {
    renderResult({ startingPriceCents: 2500 }, 'EUR')
    expect(screen.getByText(/from/)).toBeInTheDocument()
  })

  it('never renders an empty queue as an invitation', () => {
    const { unmount } = renderResult({ queueWaitingCount: 0 })
    expect(screen.queryByText(/waiting/)).not.toBeInTheDocument()
    unmount()

    renderResult({ queueWaitingCount: 3 })
    expect(screen.getByText(/3 waiting/)).toBeInTheDocument()
  })

})

describe('ProfessionalResult conversion hierarchy', () => {
  it('books the chosen location, so the wizard never asks for it again', () => {
    /*
      `search_public_professionals` emits one row per active LOCATION, so a
      multi-site organization is several listings the customer chooses between.
      `public-booking-page.tsx` only auto-skips its location step when the org
      has exactly one location or the parameter is supplied — dropping it made
      the customer pick the same branch twice and risk picking the wrong one.

      The `?barber=` form this used to assert is gone with barber rows: a shop's
      staff are not marketplace supply, so Home never preselects a professional.
    */
    renderResult({})

    expect(screen.getByRole('link', { name: 'Book' })).toHaveAttribute(
      'href',
      '/_preview/r5r/s/side-agency/book?location=loc-1',
    )
  })

  it('keeps Book the only filled action — no Follow competing with it', () => {
    renderResult({})

    // R5's barber profile put Follow above Book and gave it the page's only
    // elevation. Discovery has exactly one action, and it books.
    expect(screen.queryByRole('link', { name: /follow/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /follow/i })).not.toBeInTheDocument()
  })

  it('leaves the identity tile out of the accessibility tree when there is no photo', () => {
    const { container } = renderResult({ barberAvatarUrl: null })

    expect(container.querySelector('img')).toBeNull()
  })
})

/**
 * The R5R.1A-R2 correction: what a listing is ALLOWED to call itself.
 *
 * These are assertions rather than comments because the classification is
 * invisible in review against the current database — no organization is
 * reachable as a solo professional today, so every mislabelling renders a
 * plausible page. A listing that defaults to "Barbershop" because nothing told
 * it otherwise is a fabricated classification, and it would look completely
 * correct.
 */
describe('ProfessionalResult states the kind of supply it is', () => {
  it('labels an independent professional', () => {
    renderResult({}, 'EUR', 'independent')

    expect(screen.getByText('Independent')).toBeInTheDocument()
    expect(screen.queryByText('Barbershop')).not.toBeInTheDocument()
  })

  it('labels a barbershop', () => {
    renderResult({}, 'EUR', 'barbershop')

    expect(screen.getByText('Barbershop')).toBeInTheDocument()
    expect(screen.queryByText('Independent')).not.toBeInTheDocument()
  })

  it('claims no type at all when the domain has not said', () => {
    /*
      `organizations.business_type` is unreachable from any customer-facing
      contract today, so this is the live path. A listing that called itself a
      Barbershop because nothing told it otherwise would be a fabricated
      classification, which is the same failure as a fabricated price.
    */
    renderResult({}, 'EUR', null)

    expect(screen.queryByText('Independent')).not.toBeInTheDocument()
    expect(screen.queryByText('Barbershop')).not.toBeInTheDocument()
    // The rest of the row is unaffected.
    expect(screen.getByRole('link', { name: 'Side Agency' })).toBeInTheDocument()
  })

  it('never exposes an organization or group concept to the customer', () => {
    renderResult({ organizationName: 'Fade Factory Group', locationName: 'Fade Factory Créteil' },
      'EUR', 'barbershop')

    for (const forbidden of [/group/i, /organization/i, /multi.?location/i, /parent/i]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument()
    }
  })
})

describe('ProfessionalResult second line', () => {
  it('leads with the supply type and the locality, not the street', () => {
    /*
      The street led until the type label arrived in front of it, at which point
      "Barbershop · 19 rue Danton · Antony (92)" truncated at 390px and the
      ellipsis ate the city. The locality is the part a customer scanning a
      country-wide list actually needs; the full address is one tap deeper, on
      the profile, where it has room.
    */
    renderResult({}, 'EUR', 'barbershop')

    expect(screen.getByText(/Antony \(92\)/)).toBeInTheDocument()
    expect(screen.queryByText(/19 rue Danton/)).not.toBeInTheDocument()
  })

  it('falls back to the street when a listing has no city on file', () => {
    // Both are nullable, and a listing must still say WHERE it is.
    renderResult({ city: null }, 'EUR', 'barbershop')

    expect(screen.getByText(/19 rue Danton/)).toBeInTheDocument()
  })

  it('says nothing rather than a stray separator when neither is known', () => {
    renderResult({ city: null, addressLine1: null }, 'EUR', 'barbershop')

    expect(screen.getByText('Barbershop')).toBeInTheDocument()
    expect(screen.queryByText('·')).not.toBeInTheDocument()
  })
})

describe('ProfessionalResult flattens a multi-location organization', () => {
  it("titles the listing with the LOCATION's name when the organization runs several", () => {
    /*
      A customer outside Fade Factory Créteil is outside Créteil, not outside
      "Fade Factory Group". The group must never be named, and the site must be
      named — both come from the same line.
    */
    renderResult({ organizationName: 'Fade Factory Group', locationName: 'Fade Factory Créteil' })

    expect(screen.getByRole('link', { name: 'Fade Factory Créteil' })).toBeInTheDocument()
    expect(screen.queryByText('Fade Factory Group')).not.toBeInTheDocument()
  })

  it('does not repeat the name when a single-site shop stores it twice', () => {
    // `organization_name` and its one `location_name` are usually the same
    // string; printing both would be noise, not information.
    renderResult({ organizationName: 'Side Agency', locationName: 'Side Agency' })

    expect(screen.getAllByText('Side Agency')).toHaveLength(1)
  })

  it('books the chosen location, so the wizard never asks for it again', () => {
    renderResult({ organizationName: 'Fade Factory Group', locationName: 'Fade Factory Créteil' })

    expect(screen.getByRole('link', { name: 'Book' })).toHaveAttribute(
      'href',
      '/_preview/r5r/s/side-agency/book?location=loc-1',
    )
  })
})
