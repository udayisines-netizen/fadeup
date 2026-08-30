import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { CustomerV2Shell } from '@/customer-v2/shell/customer-v2-shell'
import { V2_ROUTES } from '@/customer-v2/routes'

vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(() => ({ session: null, user: null, loading: false })),
}))
vi.mock('@/lib/use-pending-claim', () => ({ usePendingClaimRedemption: vi.fn() }))

function renderShell() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[V2_ROUTES.home]}>
        <Routes>
          <Route path={V2_ROUTES.home} element={<CustomerV2Shell />}>
            <Route index element={<p>home</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/**
 * The navigation contract, which is the part of a shell that drifts silently.
 *
 * Nobody notices a sixth tab or a reordered Book in review, and no other test
 * would fail. PRODUCT_UI_BLUEPRINT.md §3 fixes both the set and the order, so
 * both are asserted rather than described.
 */
describe('CustomerV2Shell navigation', () => {
  it('offers exactly five destinations, in the blueprint order', () => {
    renderShell()

    const bar = screen.getAllByRole('navigation')[1]
    const labels = within(bar)
      .getAllByRole('link')
      .map((link) => link.textContent?.trim())

    expect(labels).toEqual(['Home', 'Marketplace', 'Book', 'Appointments', 'Profile'])
  })

  it('keeps Book inside the navigation rather than floating above it', () => {
    renderShell()

    const bar = screen.getAllByRole('navigation')[1]
    const book = within(bar).getByRole('link', { name: 'Book' })

    // A floating action button is a sibling of the bar, not a list item in it.
    expect(book.closest('li')).not.toBeNull()
    expect(book.closest('nav')).toBe(bar)
  })

  it('gives Book no visual privilege the other destinations lack', () => {
    renderShell()

    const bar = screen.getAllByRole('navigation')[1]
    const items = within(bar).getAllByRole('link')
    // NavLink appends `active`/`pending`/`transitioning` to a string className,
    // so the current tab legitimately differs by those. Strip them — the claim
    // is about authored styling, not router state.
    const classes = items.map((item) =>
      item.className
        .split(/\s+/)
        .filter((token) => !['active', 'pending', 'transitioning'].includes(token))
        .join(' '),
    )

    // Every tab shares one class string. Green here would mean a NAVIGATION
    // target wearing the colour reserved for booking a haircut.
    expect(new Set(classes).size).toBe(1)
    expect(classes[0]).not.toMatch(/bg-v2-green(?!-tint)/)
  })

  it('routes every destination inside the preview, never over the canonical app', () => {
    renderShell()

    const bar = screen.getAllByRole('navigation')[1]
    for (const link of within(bar).getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^\/_preview\/r5r/)
    }
  })

  it('reaches notifications without spending a primary destination on it', () => {
    renderShell()

    // Activity is reachable from the header, and is not one of the five.
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument()
  })
})
