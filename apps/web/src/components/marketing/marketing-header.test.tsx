import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MarketingHeader } from '@/components/marketing/marketing-header'
import { useAuth } from '@/lib/auth-context'
import { ThemeProvider } from '@/lib/theme'

vi.mock('@/lib/auth-context', () => ({ useAuth: vi.fn() }))

const mockUseAuth = vi.mocked(useAuth)

function renderHeader() {
  // The header mounts LanguageSwitcher (which persists the choice through a
  // mutation) and ThemeToggle, so it needs both providers even though
  // nothing under test here fetches or changes a theme.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={['/search']}>
          <MarketingHeader />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

describe('MarketingHeader', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: null, user: null, loading: false })
  })

  it('offers the usual sign-in CTAs to a visitor with no session', () => {
    renderHeader()

    expect(screen.getByRole('link', { name: 'Start free' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'My FadeUp' })).not.toBeInTheDocument()
  })

  it('gives a signed-in customer a way back into the app instead of asking them to log in', () => {
    // The customer app's Discover tab points at /search, which renders out
    // here rather than inside the app shell. Without this, the first tap on
    // Discover stranded a logged-in customer on a page offering "Log in" and
    // "Start free", reachable back only via the browser Back button.
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })

    renderHeader()

    const back = screen.getAllByRole('link', { name: 'My FadeUp' })[0]
    expect(back).toHaveAttribute('href', '/app/customer')
    expect(screen.queryByRole('link', { name: 'Start free' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Customer login' })).not.toBeInTheDocument()
  })
})
