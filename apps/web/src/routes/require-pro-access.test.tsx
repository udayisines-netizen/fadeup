import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RequireProAccess } from '@/routes/require-pro-access'
import { useAuth } from '@/lib/auth-context'
import { useMyMemberships } from '@/lib/queries/memberships'
import { useMyProfessionalApplication } from '@/lib/queries/professional-applications'
import { useOrganizationReadiness, type OrganizationReadiness } from '@/lib/queries/onboarding'

vi.mock('@/lib/auth-context', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/queries/memberships', () => ({ useMyMemberships: vi.fn() }))
vi.mock('@/lib/queries/professional-applications', () => ({ useMyProfessionalApplication: vi.fn() }))
vi.mock('@/lib/queries/onboarding', () => ({ useOrganizationReadiness: vi.fn() }))

const mockUseAuth = vi.mocked(useAuth)
const mockUseMemberships = vi.mocked(useMyMemberships)
const mockUseApplication = vi.mocked(useMyProfessionalApplication)
const mockUseReadiness = vi.mocked(useOrganizationReadiness)

/** A business that is fully set up — the pre-LOT-B assumption, now explicit. */
function readyBusiness(overrides: Partial<OrganizationReadiness> = {}): OrganizationReadiness {
  return {
    organizationId: 'org-1',
    businessType: 'barbershop',
    currency: 'EUR',
    hasBusinessType: true,
    hasCurrency: true,
    hasLocation: true,
    hasLocationAddress: true,
    hasTimezone: true,
    hasProfessional: true,
    hasService: true,
    hasServiceAtLocation: true,
    hasServiceForProfessional: true,
    hasLocationHours: true,
    hasProfessionalHours: true,
    hasPublicProfile: true,
    readyToBook: true,
    readyToPublish: true,
    isPublished: false,
    missingRequirements: [],
    ...overrides,
  }
}

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
        <Route path="/onboarding" element={<div>Setup wizard</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Renders a NON-index /app route, which must stay reachable during setup. */
function renderAdminScreen() {
  return render(
    <MemoryRouter initialEntries={['/app/services']}>
      <Routes>
        <Route
          path="/app/services"
          element={
            <RequireProAccess>
              <div>Services screen</div>
            </RequireProAccess>
          }
        />
        <Route path="/onboarding" element={<div>Setup wizard</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireProAccess', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
    mockUseMemberships.mockReturnValue(resolved([]))
    mockUseApplication.mockReturnValue(resolved(null))
    mockUseReadiness.mockReturnValue(resolved(readyBusiness()))
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

  it('sends a member whose business is NOT yet bookable to setup instead of the dashboard', () => {
    // The LOT B change: holding a membership no longer implies a finished
    // setup. An approved shop with no services and no hours used to land on
    // a dashboard that could not tell it anything was wrong.
    mockUseMemberships.mockReturnValue(resolved([{ id: 'm-1', organizationId: 'org-1', role: 'owner' }]))
    mockUseReadiness.mockReturnValue(
      resolved(
        readyBusiness({
          hasService: false,
          hasLocationHours: false,
          readyToBook: false,
          readyToPublish: false,
          missingRequirements: ['service', 'location_hours'],
        }),
      ),
    )

    renderGuard()

    expect(screen.getByText('Setup wizard')).toBeInTheDocument()
    expect(screen.queryByText('Pro dashboard')).not.toBeInTheDocument()
  })

  it('keeps the admin screens reachable while setup is unfinished', () => {
    // The wizard links to /app/services, /app/locations and /app/team.
    // Redirecting the whole /app subtree would trap someone in a loop
    // between a step and the screen that step points at.
    mockUseMemberships.mockReturnValue(resolved([{ id: 'm-1', organizationId: 'org-1', role: 'owner' }]))
    mockUseReadiness.mockReturnValue(resolved(readyBusiness({ readyToBook: false, missingRequirements: ['service'] })))

    renderAdminScreen()

    expect(screen.getByText('Services screen')).toBeInTheDocument()
    expect(screen.queryByText('Setup wizard')).not.toBeInTheDocument()
  })

  it('waits for the server answer rather than guessing while readiness loads', () => {
    mockUseMemberships.mockReturnValue(resolved([{ id: 'm-1', organizationId: 'org-1', role: 'owner' }]))
    mockUseReadiness.mockReturnValue({ data: undefined, isPending: true, isError: false, error: null } as never)

    renderGuard()

    expect(screen.queryByText('Pro dashboard')).not.toBeInTheDocument()
    expect(screen.queryByText('Setup wizard')).not.toBeInTheDocument()
  })
})
