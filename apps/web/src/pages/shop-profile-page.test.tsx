import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ShopProfilePage } from '@/pages/shop-profile-page'
import { usePublicOrganization, usePublicLocations } from '@/lib/queries/public-booking'
import { usePublicOrganizationBarbers } from '@/lib/queries/public-barber'

vi.mock('@/lib/queries/public-booking', () => ({
  usePublicOrganization: vi.fn(),
  usePublicLocations: vi.fn(),
}))

vi.mock('@/lib/queries/public-barber', () => ({
  usePublicOrganizationBarbers: vi.fn(),
}))

const mockUsePublicOrganization = vi.mocked(usePublicOrganization)
const mockUsePublicLocations = vi.mocked(usePublicLocations)
const mockUsePublicOrganizationBarbers = vi.mocked(usePublicOrganizationBarbers)

function successQuery(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

function renderAtPath(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/s/:slug/profile" element={<ShopProfilePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ShopProfilePage', () => {
  it('shows shop identity, real location, and team roster with links into each barber profile', async () => {
    mockUsePublicOrganization.mockReturnValue(successQuery({ id: 'org-1', name: "Jack's Barbers", slug: 'jacks-barbers' }))
    mockUsePublicLocations.mockReturnValue(
      successQuery([{ id: 'loc-1', name: 'Main Shop', addressLine1: '1 Main St', addressLine2: null, city: 'Paris', region: null, postalCode: '75001', country: 'FR', timezone: 'Europe/Paris' }]),
    )
    mockUsePublicOrganizationBarbers.mockReturnValue(
      successQuery([{ barberId: 'barber-1', displayName: 'Sam Barber', title: 'Master Barber', avatarUrl: null, locationId: 'loc-1', locationName: 'Main Shop' }]),
    )

    renderAtPath('/s/jacks-barbers/profile')

    expect(await screen.findByText("Jack's Barbers")).toBeInTheDocument()
    expect(screen.getByText(/Main Shop/)).toBeInTheDocument()
    expect(screen.getByText('Sam Barber')).toBeInTheDocument()
    const barberLink = screen.getByRole('link', { name: /Sam Barber/ })
    expect(barberLink).toHaveAttribute('href', '/s/jacks-barbers/barbers/barber-1')
    const bookLink = screen.getByRole('link', { name: 'Book now' })
    expect(bookLink).toHaveAttribute('href', '/s/jacks-barbers')
  })

  it('shows an empty state when the shop has no public team members yet — never a fabricated roster', async () => {
    mockUsePublicOrganization.mockReturnValue(successQuery({ id: 'org-1', name: "Jack's Barbers", slug: 'jacks-barbers' }))
    mockUsePublicLocations.mockReturnValue(successQuery([]))
    mockUsePublicOrganizationBarbers.mockReturnValue(successQuery([]))

    renderAtPath('/s/jacks-barbers/profile')

    expect(await screen.findByText('No public team members yet')).toBeInTheDocument()
  })

  it('shows a friendly "not found" state for an unknown shop slug', async () => {
    mockUsePublicOrganization.mockReturnValue(successQuery(null))
    mockUsePublicLocations.mockReturnValue(successQuery([]))
    mockUsePublicOrganizationBarbers.mockReturnValue(successQuery([]))

    renderAtPath('/s/no-such-shop/profile')

    expect(await screen.findByText("We couldn't find this shop")).toBeInTheDocument()
  })
})
