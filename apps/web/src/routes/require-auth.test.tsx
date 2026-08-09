import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Session, User } from '@supabase/supabase-js'
import { RequireAuth } from '@/routes/require-auth'
import { useAuth } from '@/lib/auth-context'

vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

const mockUseAuth = vi.mocked(useAuth)

function LoginProbe() {
  const [params] = useSearchParams()
  return <p>Login page (redirect={params.get('redirect')})</p>
}

function renderProtectedRoute(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <p>Protected content</p>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireAuth', () => {
  it('shows a loading state while the session is still resolving', () => {
    mockUseAuth.mockReturnValue({ session: null, user: null, loading: true })

    renderProtectedRoute('/app')

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })

  it('redirects to /login with a redirect param when there is no session', () => {
    mockUseAuth.mockReturnValue({ session: null, user: null, loading: false })

    renderProtectedRoute('/app?tab=team')

    expect(screen.getByText('Login page (redirect=/app?tab=team)')).toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })

  it('renders the protected children once a session is present', () => {
    const user = { id: 'user-1' } as unknown as User
    const session = { user } as unknown as Session
    mockUseAuth.mockReturnValue({ session, user, loading: false })

    renderProtectedRoute('/app')

    expect(screen.getByText('Protected content')).toBeInTheDocument()
  })
})
