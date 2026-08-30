import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { CustomerV2ShopProfilePage } from '@/customer-v2/profiles/shop-profile-page'

/**
 * The establishment profile's product contract.
 *
 * Load-bearing rules: staff reach customers HERE (team cards linking to their
 * social profiles) and never as marketplace rows; a multi-location
 * organization's site presents as an ordinary barbershop under its own site
 * name, with the group vocabulary appearing nowhere; Book carries the active
 * location.
 */

const state: {
  organization: unknown
  locations: unknown[]
  team: unknown[]
} = { organization: null, locations: [], team: [] }

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
}))

vi.mock('@/lib/queries/public-booking', () => ({
  usePublicOrganization: () => ({
    data: state.organization,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePublicLocations: () => ({ data: state.locations }),
  usePublicServices: () => ({ data: [], isPending: false }),
}))

vi.mock('@/lib/queries/public-barber', () => ({
  usePublicOrganizationBarbers: () => ({ data: state.team, isPending: false }),
}))

vi.mock('@/lib/queries/public-queue', () => ({
  usePublicQueueStatus: () => ({ data: [] }),
}))

vi.mock('@/lib/queries/organization-follows', () => ({
  useMyFollowedOrganizations: () => ({ data: [] }),
  useFollowOrganization: () => ({ mutate: vi.fn(), isPending: false }),
  useUnfollowOrganization: () => ({ mutate: vi.fn(), isPending: false }),
}))

const ORG = {
  id: 'org-1',
  name: 'Fade Factory Group',
  slug: 'fade-factory',
  currency: 'EUR',
  countryCode: 'FR',
}

const site = (id: string, name: string) => ({
  id,
  name,
  addressLine1: `${id} street`,
  addressLine2: null,
  city: 'Testville',
  region: null,
  postalCode: null,
  country: 'FR',
  timezone: 'Europe/Paris',
})

function renderPage(path = '/_preview/r5r/s/fade-factory') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/_preview/r5r/s/:slug" element={<CustomerV2ShopProfilePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('a multi-location site is an ordinary barbershop', () => {
  it("titles the page with the SITE's name and never names the group", () => {
    state.organization = ORG
    state.locations = [site('loc-1', 'Fade Factory République'), site('loc-2', 'Fade Factory Créteil')]
    state.team = []
    renderPage('/_preview/r5r/s/fade-factory?location=loc-2')

    expect(screen.getByRole('heading', { level: 1, name: 'Fade Factory Créteil' })).toBeInTheDocument()
    // The organization's own name appears nowhere: the group is Pro topology.
    expect(screen.queryByText('Fade Factory Group')).not.toBeInTheDocument()
    for (const forbidden of [/multi.?location/i, /organization/i, /\bgroup\b/i, /parent/i]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument()
    }
    // Book carries the active site.
    expect(screen.getByRole('link', { name: 'Book' })).toHaveAttribute(
      'href',
      '/s/fade-factory?location=loc-2',
    )
    // Sibling sites are a plain switcher.
    expect(screen.getByRole('link', { name: 'Fade Factory République' })).toBeInTheDocument()
  })
})

describe('team is the sanctioned discovery path for staff', () => {
  it('links each member to their greenfield social profile', () => {
    state.organization = { ...ORG, name: 'Side Agency', slug: 'side-agency' }
    state.locations = [site('loc-1', 'Side Agency')]
    state.team = [
      {
        barberId: 'barber-1',
        professionalId: 'pro-1',
        displayName: 'Barber Test',
        title: 'Senior barber',
        avatarUrl: null,
        locationId: 'loc-1',
        locationName: 'Side Agency',
      },
    ]
    renderPage('/_preview/r5r/s/side-agency')

    expect(screen.getByRole('link', { name: /Barber Test/ })).toHaveAttribute(
      'href',
      '/_preview/r5r/s/side-agency/b/barber-1',
    )
  })
})
