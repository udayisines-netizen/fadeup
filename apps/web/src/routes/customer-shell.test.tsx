import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@/lib/theme'
import { CustomerShell } from '@/routes/customer-shell'

vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(() => ({ session: {}, user: { id: 'user-1' }, loading: false })),
}))
vi.mock('@/lib/use-pending-claim', () => ({ usePendingClaimRedemption: vi.fn() }))
vi.mock('@/lib/queries/customer-app', () => ({
  useMyAppointments: vi.fn(() => ({ data: [], isPending: false })),
  useMyFavorites: vi.fn(() => ({ data: [], isPending: false })),
}))
vi.mock('@/components/notifications/notification-bell', () => ({
  NotificationBell: () => null,
}))

function renderShell() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
      <MemoryRouter initialEntries={['/app/customer']}>
        <Routes>
          <Route path="/app/customer" element={<CustomerShell />}>
            <Route index element={<p>discover</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

/**
 * The R5 navigation contract.
 *
 * These are acceptance criteria D, E and F expressed as assertions, and they
 * exist because navigation is the part of a product that drifts silently: a
 * later lot adds a sixth tab, or moves Passport back to the top level "just
 * for now", and nothing fails.
 */
describe('CustomerShell navigation', () => {
  it('offers exactly the five canonical destinations, in order, with BOOK in the centre', () => {
    renderShell()

    const bar = screen.getAllByRole('navigation', { name: 'Customer app navigation' })
    // Two navs render the same model: the desktop header and the mobile bar.
    // The bar is the one that carries BOOK as a prominent action.
    const tabBar = bar[bar.length - 1]!

    // Queried structurally rather than by role, because DOM ORDER is the
    // assertion: BOOK being third of five is what "centre" means here, and a
    // role query would happily return the same five in a different order.
    const labels = Array.from(tabBar.querySelectorAll('a, button')).map((element) =>
      element.textContent?.trim(),
    )

    expect(labels).toEqual(['Discover', 'Search', 'Book', 'Appointments', 'Profile'])
  })

  it('gives Search its own destination rather than folding it into Discover', () => {
    renderShell()
    const links = screen.getAllByRole('link', { name: 'Search' })
    expect(links[0]).toHaveAttribute('href', '/app/customer/search')
  })

  it('keeps Fade Passport OUT of the primary navigation', () => {
    renderShell()
    // §18 / criterion E: the passport lives inside Profile. Its ROUTE still
    // resolves — this asserts only that it is not a top-level tab.
    expect(screen.queryByRole('link', { name: 'Passport' })).not.toBeInTheDocument()
  })

  it('makes BOOK an action, not a link — it opens a selector rather than navigating', () => {
    renderShell()

    // §34: BOOK must always operate against a valid context, so with none
    // selected it opens the lightweight selector instead of guessing a shop.
    const book = screen.getByRole('button', { name: 'Book an appointment' })
    expect(book).toHaveAttribute('aria-haspopup', 'dialog')

    fireEvent.click(book)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Book a cut')).toBeInTheDocument()
  })

  it('offers the same BOOK action on desktop, as a real button in the header', () => {
    renderShell()
    // Same mental model, different expression — criterion C. Both controls
    // open the same sheet; neither is a stretched version of the other.
    const desktopBook = screen.getAllByRole('button', { name: 'Book' })
    expect(desktopBook.length).toBeGreaterThan(0)
  })
})
