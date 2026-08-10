import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PublicQueueDisplayPage } from '@/pages/public-queue-display-page'
import { usePublicLocations, usePublicOrganization } from '@/lib/queries/public-booking'
import { usePublicQueueStatus } from '@/lib/queries/public-queue'

vi.mock('@/lib/queries/public-booking', () => ({
  usePublicOrganization: vi.fn(),
  usePublicLocations: vi.fn(),
}))

vi.mock('@/lib/queries/public-queue', () => ({
  usePublicQueueStatus: vi.fn(),
}))

const mockUsePublicOrganization = vi.mocked(usePublicOrganization)
const mockUsePublicLocations = vi.mocked(usePublicLocations)
const mockUsePublicQueueStatus = vi.mocked(usePublicQueueStatus)

function pendingQuery() {
  return { data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() } as never
}

function successQuery(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

function renderAtSlug(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/s/:slug/display" element={<PublicQueueDisplayPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PublicQueueDisplayPage', () => {
  it('shows a friendly "not found" state for an unknown slug', async () => {
    mockUsePublicOrganization.mockReturnValue(successQuery(null))
    mockUsePublicLocations.mockReturnValue(successQuery([]))
    mockUsePublicQueueStatus.mockReturnValue(pendingQuery())

    renderAtSlug('/s/no-such-shop/display')

    expect(await screen.findByText("We couldn't find this shop")).toBeInTheDocument()
  })

  it('resolves the location from ?location= and shows "now serving" / "up next" sections', async () => {
    mockUsePublicOrganization.mockReturnValue(successQuery({ id: 'org-1', name: "Jack's Barbers", slug: 'jacks-barbers' }))
    mockUsePublicLocations.mockReturnValue(
      successQuery([
        { id: 'loc-1', name: 'Main Shop', addressLine1: null, addressLine2: null, city: 'Austin', region: 'TX', postalCode: null, country: 'US', timezone: 'America/Chicago' },
        { id: 'loc-2', name: 'North Shop', addressLine1: null, addressLine2: null, city: 'Austin', region: 'TX', postalCode: null, country: 'US', timezone: 'America/Chicago' },
      ]),
    )
    mockUsePublicQueueStatus.mockReturnValue(
      successQuery([
        { id: 'q-1', displayName: 'Alice W.', status: 'in_service', queuePosition: null, barberDisplayName: 'Sam Barber' },
        { id: 'q-2', displayName: 'Bob T.', status: 'waiting', queuePosition: 1, barberDisplayName: null },
      ]),
    )

    renderAtSlug('/s/jacks-barbers/display?location=loc-2')

    expect(await screen.findByText('North Shop')).toBeInTheDocument()
    expect(screen.getByText('Now serving')).toBeInTheDocument()
    expect(screen.getByText('Alice W.')).toBeInTheDocument()
    expect(screen.getByText('Up next')).toBeInTheDocument()
    expect(screen.getByText('Bob T.')).toBeInTheDocument()
    // Passed the requested loc-2 explicitly — not silently fell back to the first location.
    expect(mockUsePublicQueueStatus).toHaveBeenCalledWith('jacks-barbers', 'loc-2')
  })

  it('shows an empty state when no one is waiting or being served', async () => {
    mockUsePublicOrganization.mockReturnValue(successQuery({ id: 'org-1', name: "Jack's Barbers", slug: 'jacks-barbers' }))
    mockUsePublicLocations.mockReturnValue(
      successQuery([{ id: 'loc-1', name: 'Main Shop', addressLine1: null, addressLine2: null, city: 'Austin', region: 'TX', postalCode: null, country: 'US', timezone: 'America/Chicago' }]),
    )
    mockUsePublicQueueStatus.mockReturnValue(successQuery([]))

    renderAtSlug('/s/jacks-barbers/display')

    expect(await screen.findByText('No one is currently waiting')).toBeInTheDocument()
  })
})
