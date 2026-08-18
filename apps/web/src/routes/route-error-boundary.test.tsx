import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteErrorBoundary } from '@/routes/route-error-boundary'

/**
 * Production showed React Router's built-in developer screen — "Unexpected
 * Application Error! Hey developer…" — to real visitors when /onboarding
 * threw.
 *
 * The ErrorBoundary in App.tsx could not have helped: it wraps
 * <RouterProvider>, and the router catches route render errors before they
 * can bubble that high. These tests render through a real router so they
 * exercise that interception rather than a plain React boundary.
 */

function Boom(): never {
  throw new Error('useCurrentOrg must be used within a CurrentOrgProvider')
}

function renderWithRouter(element: React.ReactElement) {
  const router = createMemoryRouter(
    [{ path: '/', element, errorElement: <RouteErrorBoundary /> }],
    { initialEntries: ['/'] },
  )
  return render(<RouterProvider router={router} />)
}

describe('RouteErrorBoundary', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // React and the router both log the caught error; silence the noise but
    // keep the spy so the "still logs" assertion is real.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('replaces the router developer screen with a FadeUp recovery state', () => {
    renderWithRouter(<Boom />)

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument()
    // The exact strings React Router's default screen shows.
    expect(screen.queryByText(/unexpected application error/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/hey developer/i)).not.toBeInTheDocument()
  })

  it('offers reload and a safe way out', () => {
    renderWithRouter(<Boom />)

    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /go to my workspace/i })).toHaveAttribute('href', '/workspace')
    expect(screen.getByRole('link', { name: /^home$/i })).toHaveAttribute('href', '/')
  })

  it('shows the real error rather than hiding it', () => {
    // Someone reporting a problem can tell us what it said, and it matches
    // what was logged.
    renderWithRouter(<Boom />)

    expect(screen.getByText(/useCurrentOrg must be used within a CurrentOrgProvider/)).toBeInTheDocument()
  })

  it('still logs the error', () => {
    renderWithRouter(<Boom />)

    expect(consoleError).toHaveBeenCalledWith('Unhandled route error', expect.any(Error))
  })

  it('does not silently redirect', () => {
    // Bouncing a broken route to /workspace would hide the failure from
    // everyone, including us. The recovery is offered, never forced.
    renderWithRouter(<Boom />)

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument()
  })

  it('has FadeUp branding rather than a bare stack trace', () => {
    renderWithRouter(<Boom />)

    expect(screen.getByRole('link', { name: 'FadeUp' })).toBeInTheDocument()
  })
})
