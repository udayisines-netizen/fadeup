import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteButton } from '@/components/customer/favorite-button'
import { useAuth } from '@/lib/auth-context'
import { useMyFavorites, useAddFavorite, useRemoveFavorite } from '@/lib/queries/customer-app'

vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

vi.mock('@/lib/queries/customer-app', () => ({
  useMyFavorites: vi.fn(),
  useAddFavorite: vi.fn(),
  useRemoveFavorite: vi.fn(),
}))

const mockUseAuth = vi.mocked(useAuth)
const mockUseMyFavorites = vi.mocked(useMyFavorites)
const mockUseAddFavorite = vi.mocked(useAddFavorite)
const mockUseRemoveFavorite = vi.mocked(useRemoveFavorite)

function renderButton() {
  return render(
    <MemoryRouter initialEntries={['/s/demo-shop/profile']}>
      <FavoriteButton organizationId="org-1" />
    </MemoryRouter>,
  )
}

describe('FavoriteButton', () => {
  it('signed-out visitors get a link to login with a redirect back — never a button that silently fails', () => {
    mockUseAuth.mockReturnValue({ session: null, user: null, loading: false })
    mockUseMyFavorites.mockReturnValue({ data: undefined, isPending: false } as never)
    mockUseAddFavorite.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    mockUseRemoveFavorite.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)

    renderButton()

    const link = screen.getByRole('link', { name: 'Add to favorites' })
    expect(link).toHaveAttribute('href', `/login?redirect=${encodeURIComponent('/s/demo-shop/profile')}`)
  })

  it('signed-in customers can add and, once favorited, remove', async () => {
    const addMutate = vi.fn()
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
    mockUseMyFavorites.mockReturnValue({ data: [], isPending: false } as never)
    mockUseAddFavorite.mockReturnValue({ mutate: addMutate, isPending: false } as never)
    mockUseRemoveFavorite.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)

    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Add to favorites' }))

    await waitFor(() => expect(addMutate).toHaveBeenCalledWith({ organizationId: 'org-1' }))
  })

  it('shows the "remove" state once the organization is already a favorite', () => {
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
    mockUseMyFavorites.mockReturnValue({
      data: [{ favoriteId: 'fav-1', organizationId: 'org-1', organizationName: 'Shop', organizationSlug: 'demo-shop', barberId: null, barberDisplayName: null, barberAvatarUrl: null, createdAt: '2026-08-01T00:00:00Z' }],
      isPending: false,
    } as never)
    mockUseAddFavorite.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    mockUseRemoveFavorite.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)

    renderButton()

    expect(screen.getByRole('button', { name: 'Remove from favorites' })).toHaveAttribute('aria-pressed', 'true')
  })
})
