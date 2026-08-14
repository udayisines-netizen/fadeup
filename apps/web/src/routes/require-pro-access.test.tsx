import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RequireProAccess } from '@/routes/require-pro-access'
import { useAuth } from '@/lib/auth-context'
import { useMyMemberships } from '@/lib/queries/memberships'
import { useMyProfessionalApplication } from '@/lib/queries/professional-applications'

vi.mock('@/lib/auth-context', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/queries/memberships', () => ({ useMyMemberships: vi.fn() }))
vi.mock('@/lib/queries/professional-applications', () => ({ useMyProfessionalApplication: vi.fn() }))

const mockUseAuth = vi.mocked(useAuth)
const mockUseMemberships = vi.mocked(useMyMemberships)
const mockUseApplication = vi.mocked(useMyProfessionalApplication)

function resolved(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/app']}>
      <Routes>
        <Route
          path="/app"
          element={
            <RequireProAccess>
              <div>Pro dashboard</div>
            </RequireProAccess>
          }
        />
        <Route path="/pro/application" element={<div>Application status</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireProAccess', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
    mockUseMemberships.mockReturnValue(resolved([]))
    mockUseApplication.mockReturnValue(resolved(null))
  })

  it('sends a PENDING applicant to their status page instead of the dashboard', () => {
    mockUseApplication.mockReturnValue(resolved({ id: 'a-1', status: 'pending_review' }))

    renderGuard()

    expect(screen.getByText('Application status')).toBeInTheDocument()
    expect(screen.queryByText('Pro dashboard')).not.toBeInTheDocument()
  })

  it('sends a REJECTED applicant to their status page rather than a bare authorization error', () => {
    mockUseApplication.mockReturnValue(resolved({ id: 'a-1', status: 'rejected' }))

    renderGuard()

    expect(screen.getByText('Application status')).toBeInTheDocument()
    expect(screen.queryByText('Pro dashboard')).not.toBeInTheDocument()
  })

  it('lets an APPROVED professional with a membership through', () => {
    mockUseMemberships.mockReturnValue(resolved([{ id: 'm-1', organizationId: 'org-1', role: 'owner' }]))
    mockUseApplication.mockReturnValue(resolved({ id: 'a-1', status: 'approved' }))

    renderGuard()

    expect(screen.getByText('Pro dashboard')).toBeInTheDocument()
  })

  it('lets a member through even while they have an unrelated pending application elsewhere', () => {
    // A barber invited to staff a shop may also have applied for their own.
    // The membership is what grants access, so it wins.
    mockUseMemberships.mockReturnValue(resolved([{ id: 'm-1', organizationId: 'org-1', role: 'barber' }]))
    mockUseApplication.mockReturnValue(resolved({ id: 'a-1', status: 'pending_review' }))

    renderGuard()

    expect(screen.getByText('Pro dashboard')).toBeInTheDocument()
  })

  it('does not interfere with an ordinary account that never applied', () => {
    renderGuard()

    expect(screen.getByText('Pro dashboard')).toBeInTheDocument()
  })
})
