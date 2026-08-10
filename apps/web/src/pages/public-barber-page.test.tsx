import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PublicBarberPage } from '@/pages/public-barber-page'
import { usePublicOrganization } from '@/lib/queries/public-booking'
import { usePublicBarber, usePublicBarberServices } from '@/lib/queries/public-barber'

vi.mock('@/lib/queries/public-booking', () => ({
  usePublicOrganization: vi.fn(),
}))

vi.mock('@/lib/queries/public-barber', () => ({
  usePublicBarber: vi.fn(),
  usePublicBarberServices: vi.fn(),
}))

const mockUsePublicOrganization = vi.mocked(usePublicOrganization)
const mockUsePublicBarber = vi.mocked(usePublicBarber)
const mockUsePublicBarberServices = vi.mocked(usePublicBarberServices)

function pendingQuery() {
  return { data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() } as never
}

function successQuery(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

function renderAtPath(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/s/:slug/barbers/:barberId" element={<PublicBarberPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PublicBarberPage', () => {
  it('shows a friendly "not found" state for a private or unknown barber', async () => {
    mockUsePublicOrganization.mockReturnValue(successQuery({ id: 'org-1', name: "Jack's Barbers", slug: 'jacks-barbers' }))
    mockUsePublicBarber.mockReturnValue(successQuery(null))
    mockUsePublicBarberServices.mockReturnValue(pendingQuery())

    renderAtPath('/s/jacks-barbers/barbers/no-such-barber')

    expect(await screen.findByText("We couldn't find this profile")).toBeInTheDocument()
  })

  it('renders the barber\'s profile and their real active services, with a "Book with" CTA', async () => {
    mockUsePublicOrganization.mockReturnValue(successQuery({ id: 'org-1', name: "Jack's Barbers", slug: 'jacks-barbers' }))
    mockUsePublicBarber.mockReturnValue(
      successQuery({ barberId: 'barber-1', displayName: 'Sam Barber', title: 'Master Barber', bio: 'Fades and tapers.', avatarUrl: null }),
    )
    mockUsePublicBarberServices.mockReturnValue(
      successQuery([{ id: 'svc-1', name: 'Classic Fade', durationMinutes: 30, priceCents: 3500 }]),
    )

    renderAtPath('/s/jacks-barbers/barbers/barber-1')

    expect(await screen.findByText('Sam Barber')).toBeInTheDocument()
    expect(screen.getByText('Master Barber')).toBeInTheDocument()
    expect(screen.getByText('Fades and tapers.')).toBeInTheDocument()
    expect(screen.getByText('Classic Fade')).toBeInTheDocument()
    expect(screen.getByText('$35.00')).toBeInTheDocument()
    const bookLink = screen.getByRole('link', { name: 'Book with Sam' })
    expect(bookLink).toHaveAttribute('href', '/s/jacks-barbers')
  })
})
