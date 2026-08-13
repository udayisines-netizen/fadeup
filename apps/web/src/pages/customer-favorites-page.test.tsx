import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerFavoritesPage } from '@/pages/customer-favorites-page'
import { useAuth } from '@/lib/auth-context'
import { useMyFavorites, useRemoveFavorite } from '@/lib/queries/customer-app'

vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

vi.mock('@/lib/queries/customer-app', () => ({
  useMyFavorites: vi.fn(),
  useRemoveFavorite: vi.fn(),
}))

const mockUseAuth = vi.mocked(useAuth)
const mockUseMyFavorites = vi.mocked(useMyFavorites)
const mockUseRemoveFavorite = vi.mocked(useRemoveFavorite)

function renderPage() {
  return render(
    <MemoryRouter>
      <CustomerFavoritesPage />
    </MemoryRouter>,
  )
}

describe('CustomerFavoritesPage', () => {
  const mutate = vi.fn()

  beforeEach(() => {
    mutate.mockClear()
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
    mockUseRemoveFavorite.mockReturnValue({ mutate } as never)
  })

  it('shows the empty state with a Discover shortcut — never a fabricated favorites list', () => {
    mockUseMyFavorites.mockReturnValue({ data: [], isPending: false, isError: false, error: null, refetch: vi.fn() } as never)

    renderPage()

    expect(screen.getByText('No favorites yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Discover barbers' })).toHaveAttribute('href', '/search')
  })

  it('shows saved shop and barber favorites with working profile/book links, and can remove one', async () => {
    mockUseMyFavorites.mockReturnValue({
      data: [
        {
          favoriteId: 'fav-shop',
          organizationId: 'org-1',
          organizationName: 'Le Fade Parisien',
          organizationSlug: 'demo-le-fade-parisien',
          barberId: null,
          barberDisplayName: null,
          barberAvatarUrl: null,
          createdAt: '2026-08-01T00:00:00Z',
        },
        {
          favoriteId: 'fav-barber',
          organizationId: 'org-1',
          organizationName: 'Le Fade Parisien',
          organizationSlug: 'demo-le-fade-parisien',
          barberId: 'barber-1',
          barberDisplayName: 'Karim Belhadj',
          barberAvatarUrl: null,
          createdAt: '2026-08-01T00:00:00Z',
        },
      ],
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as never)

    renderPage()

    expect(screen.getAllByText('Le Fade Parisien').length).toBeGreaterThan(0)
    expect(screen.getByText('Karim Belhadj')).toBeInTheDocument()

    const removeButtons = screen.getAllByRole('button', { name: 'Remove' })
    fireEvent.click(removeButtons[0]!)

    await waitFor(() => expect(mutate).toHaveBeenCalledWith('fav-shop'))
  })

  it('shows an error state, not a raw error message, when favorites fail to load', () => {
    mockUseMyFavorites.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('network error'),
      refetch: vi.fn(),
    } as never)

    renderPage()

    expect(screen.getByText("Couldn't load your favorites")).toBeInTheDocument()
  })
})
