import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PublicWalkinPage } from '@/pages/public-walkin-page'
import { usePublicLocations, usePublicOrganization } from '@/lib/queries/public-booking'
import { useJoinPublicQueue } from '@/lib/queries/public-queue'

vi.mock('@/lib/queries/public-booking', () => ({
  usePublicOrganization: vi.fn(),
  usePublicLocations: vi.fn(),
}))

vi.mock('@/lib/queries/public-queue', () => ({
  useJoinPublicQueue: vi.fn(),
}))

const mockUsePublicOrganization = vi.mocked(usePublicOrganization)
const mockUsePublicLocations = vi.mocked(usePublicLocations)
const mockUseJoinPublicQueue = vi.mocked(useJoinPublicQueue)

function pendingQuery() {
  return { data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() } as never
}

function successQuery(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

function renderAtSlug(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/s/${slug}/walk-in`]}>
      <Routes>
        <Route path="/s/:slug/walk-in" element={<PublicWalkinPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PublicWalkinPage', () => {
  it('shows a friendly "not found" state for an unknown slug', async () => {
    mockUsePublicOrganization.mockReturnValue(successQuery(null))
    mockUsePublicLocations.mockReturnValue(pendingQuery())
    mockUseJoinPublicQueue.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)

    renderAtSlug('no-such-shop')

    expect(await screen.findByText("We couldn't find this shop")).toBeInTheDocument()
  })

  it('auto-skips a single location, checks a customer in, and shows the "check in another" success screen', async () => {
    mockUsePublicOrganization.mockReturnValue(successQuery({ id: 'org-1', name: "Jack's Barbers", slug: 'jacks-barbers' }))
    mockUsePublicLocations.mockReturnValue(
      successQuery([{ id: 'loc-1', name: 'Main Shop', addressLine1: null, addressLine2: null, city: 'Austin', region: 'TX', postalCode: null, country: 'US', timezone: 'America/Chicago' }]),
    )
    const mutateAsync = vi.fn().mockResolvedValue({ id: 'queue-1', status: 'waiting', createdAt: '2026-08-10T12:00:00.000Z' })
    mockUseJoinPublicQueue.mockReturnValue({ mutateAsync, isPending: false } as never)

    renderAtSlug('jacks-barbers')

    // Single location auto-skipped — straight to the check-in form.
    const nameField = await screen.findByLabelText('Full name')
    fireEvent.change(nameField, { target: { value: 'Alice Customer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check in' }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ organizationSlug: 'jacks-barbers', locationId: 'loc-1', customerName: 'Alice Customer' }),
      ),
    )

    expect(await screen.findByText("You're checked in")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check in another customer' })).toBeInTheDocument()
  })
})
