import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PublicBookingPage } from '@/pages/public-booking-page'
import {
  usePublicAvailableSlots,
  usePublicBarbers,
  usePublicLocations,
  usePublicOrganization,
  usePublicServices,
  useBookPublicAppointment,
} from '@/lib/queries/public-booking'

vi.mock('@/lib/queries/public-booking', () => ({
  usePublicOrganization: vi.fn(),
  usePublicLocations: vi.fn(),
  usePublicServices: vi.fn(),
  usePublicBarbers: vi.fn(),
  usePublicAvailableSlots: vi.fn(),
  useBookPublicAppointment: vi.fn(),
}))

const mockUsePublicOrganization = vi.mocked(usePublicOrganization)
const mockUsePublicLocations = vi.mocked(usePublicLocations)
const mockUsePublicServices = vi.mocked(usePublicServices)
const mockUsePublicBarbers = vi.mocked(usePublicBarbers)
const mockUsePublicAvailableSlots = vi.mocked(usePublicAvailableSlots)
const mockUseBookPublicAppointment = vi.mocked(useBookPublicAppointment)

function pendingQuery() {
  return { data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() } as never
}

function successQuery(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

function renderAtSlug(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/s/${slug}`]}>
      <Routes>
        <Route path="/s/:slug" element={<PublicBookingPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PublicBookingPage', () => {
  it('shows a friendly "not found" state for an unknown slug (resolved, zero rows — not an error)', async () => {
    mockUsePublicOrganization.mockReturnValue(successQuery(null))
    mockUsePublicLocations.mockReturnValue(pendingQuery())
    mockUsePublicServices.mockReturnValue(pendingQuery())
    mockUsePublicBarbers.mockReturnValue(pendingQuery())
    mockUsePublicAvailableSlots.mockReturnValue(pendingQuery())
    mockUseBookPublicAppointment.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)

    renderAtSlug('no-such-shop')

    expect(await screen.findByText("We couldn't find this shop")).toBeInTheDocument()
  })

  it('auto-skips a single location and lists services grouped by category', async () => {
    mockUsePublicOrganization.mockReturnValue(
      successQuery({ id: 'org-1', name: "Jack's Barbers", slug: 'jacks-barbers' }),
    )
    mockUsePublicLocations.mockReturnValue(
      successQuery([{ id: 'loc-1', name: 'Main Shop', addressLine1: null, addressLine2: null, city: 'Austin', region: 'TX', postalCode: null, country: 'US', timezone: 'America/Chicago' }]),
    )
    mockUsePublicServices.mockReturnValue(
      successQuery([
        { id: 'svc-1', categoryId: 'cat-1', categoryName: 'Haircuts', name: 'Classic Fade', description: null, durationMinutes: 30, priceCents: 3500 },
      ]),
    )
    mockUsePublicBarbers.mockReturnValue(pendingQuery())
    mockUsePublicAvailableSlots.mockReturnValue(pendingQuery())
    mockUseBookPublicAppointment.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)

    renderAtSlug('jacks-barbers')

    expect(await screen.findByText('Classic Fade')).toBeInTheDocument()
    expect(screen.getByText('Haircuts')).toBeInTheDocument()
    expect(screen.getByText('$35.00')).toBeInTheDocument()
    // The single location was auto-selected — "Choose a location" should never appear.
    expect(screen.queryByText('Choose a location')).not.toBeInTheDocument()
  })
})
