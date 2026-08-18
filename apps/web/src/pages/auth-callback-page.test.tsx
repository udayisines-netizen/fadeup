import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCallbackPage } from '@/pages/auth-callback-page'
import { useAuth } from '@/lib/auth-context'
import { useMyAccess, type MyAccess } from '@/lib/queries/access'

vi.mock('@/lib/auth-context', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/queries/access', async () => {
  const actual = await vi.importActual<typeof import('@/lib/queries/access')>('@/lib/queries/access')
  return { ...actual, useMyAccess: vi.fn() }
})

const mockUseAuth = vi.mocked(useAuth)
const mockUseAccess = vi.mocked(useMyAccess)

function resolved(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

function access(overrides: Partial<MyAccess> = {}): MyAccess {
  return {
    userId: 'user-1',
    platformRole: null,
    platformAvailable: false,
    professionalAvailable: false,
    organizationCount: 0,
    ownedOrganizationCount: 0,
    customerAvailable: true,
    customerProfileExists: false,
    customerOnboardingCompleted: false,
    applicationStatus: null,
    signupIntent: null,
    ...overrides,
  }
}

function renderCallback(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/auth/callback${search}`]}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/platform" element={<div>Platform control center</div>} />
        <Route path="/workspace" element={<div>Workspace chooser</div>} />
        <Route path="/app" element={<div>Professional workspace</div>} />
        <Route path="/app/customer" element={<div>Customer home</div>} />
        <Route path="/app/services" element={<div>Services screen</div>} />
        <Route path="/login" element={<div>Customer sign in</div>} />
        <Route path="/platform/login" element={<div>Platform sign in</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

/**
 * The Google/Apple callback is where "the provider authenticates, the
 * database authorizes" either holds or quietly stops holding. Every case
 * below arrives with a fully valid, fully successful OAuth session — the
 * only variable is what the database says.
 */
describe('AuthCallbackPage — platform boundary', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
    mockUseAccess.mockReturnValue(resolved(access()))
  })

  it('admits a Google/Apple identity that HAS a platform_members row', () => {
    mockUseAccess.mockReturnValue(resolved(access({ platformAvailable: true, platformRole: 'platform_admin' })))

    renderCallback('?intent=platform')

    expect(screen.getByText('Platform control center')).toBeInTheDocument()
  })

  it('refuses /platform to an identity with NO platform_members row', () => {
    renderCallback('?intent=platform')

    expect(screen.queryByText('Platform control center')).not.toBeInTheDocument()
    expect(screen.getByText('Workspace chooser')).toBeInTheDocument()
  })

  it('refuses /platform to a business owner who is not platform staff', () => {
    mockUseAccess.mockReturnValue(
      resolved(access({ professionalAvailable: true, organizationCount: 1, ownedOrganizationCount: 1 })),
    )

    renderCallback('?intent=platform')

    expect(screen.queryByText('Platform control center')).not.toBeInTheDocument()
    expect(screen.getByText('Workspace chooser')).toBeInTheDocument()
  })

  it('ignores a next= pointing into /platform when the database says no', () => {
    renderCallback('?intent=platform&next=%2Fplatform')

    expect(screen.queryByText('Platform control center')).not.toBeInTheDocument()
    expect(screen.getByText('Workspace chooser')).toBeInTheDocument()
  })
})

describe('AuthCallbackPage — open redirect', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
    mockUseAccess.mockReturnValue(resolved(access()))
  })

  it('discards an absolute external next and uses the intent default', () => {
    renderCallback('?intent=customer&next=https%3A%2F%2Fevil.example')

    expect(screen.getByText('Customer home')).toBeInTheDocument()
  })

  it('discards a protocol-relative next', () => {
    renderCallback('?intent=customer&next=%2F%2Fevil.example')

    expect(screen.getByText('Customer home')).toBeInTheDocument()
  })

  it('honours a genuine internal next', () => {
    mockUseAccess.mockReturnValue(resolved(access({ professionalAvailable: true })))

    renderCallback('?intent=pro&next=%2Fapp%2Fservices')

    expect(screen.getByText('Services screen')).toBeInTheDocument()
  })
})

describe('AuthCallbackPage — failure states', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
    mockUseAccess.mockReturnValue(resolved(access()))
  })

  it('shows the provider error instead of routing anywhere', () => {
    renderCallback('?intent=platform&error=access_denied&error_description=User%20cancelled')

    expect(screen.getByText('User cancelled')).toBeInTheDocument()
    expect(screen.queryByText('Platform control center')).not.toBeInTheDocument()
    expect(screen.queryByText('Workspace chooser')).not.toBeInTheDocument()
  })

  it('sends someone who lands here with no session back to the door they used', () => {
    mockUseAuth.mockReturnValue({ session: null, user: null, loading: false })

    renderCallback('?intent=platform')

    expect(screen.getByText('Platform sign in')).toBeInTheDocument()
  })
})
