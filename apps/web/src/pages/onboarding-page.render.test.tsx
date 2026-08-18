import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingPage } from '@/pages/onboarding-page'
import { useAuth } from '@/lib/auth-context'
import { useMyAccess, type MyAccess } from '@/lib/queries/access'
import { useResolvedOrganization, type MembershipWithOrganization } from '@/lib/queries/memberships'
import { useOrganizationReadiness, type OrganizationReadiness } from '@/lib/queries/onboarding'
import { useOrgLocations } from '@/lib/queries/locations'
import { useOrgServices } from '@/lib/queries/services'
import { useAssignBarberServices } from '@/lib/queries/barber-services'
import { useEnsureOwnerProfessional } from '@/lib/queries/onboarding'

/**
 * The production crash this file exists to prevent from returning:
 *
 *   "useCurrentOrg must be used within a CurrentOrgProvider"
 *   current-org-context -> onboarding-page
 *
 * CurrentOrgProvider is mounted by AppLayout — inside the finished
 * professional workspace — and /onboarding is a SIBLING route. Rendering
 * OnboardingPage with no provider anywhere above it is therefore the exact
 * production condition, and is how every test here renders it. If anything
 * reintroduces that dependency, these throw.
 *
 * The other half is that the authentication method must be irrelevant: a
 * session is a session, and authorization comes from memberships.
 */

vi.mock('@/lib/auth-context', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/queries/access', () => ({ useMyAccess: vi.fn() }))
vi.mock('@/lib/queries/memberships', () => ({ useResolvedOrganization: vi.fn() }))
vi.mock('@/lib/queries/onboarding', async () => {
  const actual = await vi.importActual<typeof import('@/lib/queries/onboarding')>('@/lib/queries/onboarding')
  return { ...actual, useOrganizationReadiness: vi.fn(), useEnsureOwnerProfessional: vi.fn() }
})
vi.mock('@/lib/queries/services', async () => {
  const actual = await vi.importActual<typeof import('@/lib/queries/services')>('@/lib/queries/services')
  return { ...actual, useOrgServices: vi.fn() }
})
vi.mock('@/lib/queries/barber-services', () => ({ useAssignBarberServices: vi.fn() }))
vi.mock('@/lib/queries/locations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/queries/locations')>('@/lib/queries/locations')
  return { ...actual, useOrgLocations: vi.fn() }
})

const mockUseAuth = vi.mocked(useAuth)
const mockUseAccess = vi.mocked(useMyAccess)
const mockUseResolvedOrg = vi.mocked(useResolvedOrganization)
const mockUseReadiness = vi.mocked(useOrganizationReadiness)
const mockUseLocations = vi.mocked(useOrgLocations)
const mockUseServices = vi.mocked(useOrgServices)
const mockUseAssignServices = vi.mocked(useAssignBarberServices)
const mockUseEnsurePro = vi.mocked(useEnsureOwnerProfessional)

function resolved(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

function access(overrides: Partial<MyAccess> = {}): MyAccess {
  return {
    userId: 'user-1',
    platformRole: null,
    platformAvailable: false,
    professionalAvailable: true,
    organizationCount: 1,
    ownedOrganizationCount: 1,
    customerAvailable: true,
    customerProfileExists: false,
    customerOnboardingCompleted: false,
    applicationStatus: 'approved',
    signupIntent: null,
    ...overrides,
  }
}

function membership(overrides: Partial<MembershipWithOrganization> = {}): MembershipWithOrganization {
  return {
    id: 'm-1',
    role: 'owner',
    organizationId: 'org-1',
    organizationName: 'Le Fade Parisien',
    organizationSlug: 'le-fade-parisien',
    ...overrides,
  }
}

function withOrganizations(list: MembershipWithOrganization[], activeId?: string) {
  const organizationId = activeId ?? list[0]?.organizationId ?? null
  mockUseResolvedOrg.mockReturnValue({
    membershipsQuery: resolved(list),
    memberships: list,
    organizationId,
    membership: list.find((m) => m.organizationId === organizationId) ?? null,
  } as never)
}

function incompleteReadiness(overrides: Partial<OrganizationReadiness> = {}): OrganizationReadiness {
  return {
    organizationId: 'org-1',
    businessType: 'barbershop',
    currency: 'EUR',
    hasBusinessType: true,
    hasCurrency: true,
    hasLocation: true,
    hasLocationAddress: true,
    hasTimezone: true,
    hasProfessional: false,
    hasService: false,
    hasServiceAtLocation: false,
    hasServiceForProfessional: false,
    hasLocationHours: false,
    hasProfessionalHours: false,
    hasPublicProfile: false,
    readyToBook: false,
    readyToPublish: false,
    isPublished: false,
    missingRequirements: ['service', 'professional', 'location_hours', 'professional_hours'],
    ...overrides,
  }
}

/**
 * No CurrentOrgProvider anywhere — exactly how the real /onboarding route
 * renders. QueryClientProvider IS present because App.tsx mounts it above the
 * router for the whole application; it is not the thing under test.
 */
function renderOnboarding(entry = '/onboarding') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/app" element={<div>Professional workspace</div>} />
          <Route path="/workspace" element={<div>Workspace chooser</div>} />
          <Route path="/pro/application" element={<div>Application status</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('OnboardingPage — renders without CurrentOrgProvider', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
    mockUseAccess.mockReturnValue(resolved(access()))
    withOrganizations([membership()])
    mockUseReadiness.mockReturnValue(resolved(incompleteReadiness()))
    mockUseLocations.mockReturnValue(
      resolved([
        {
          id: 'loc-1',
          organizationId: 'org-1',
          name: 'Bastille',
          addressLine1: '2 rue de la Roquette',
          addressLine2: null,
          city: 'Paris',
          region: null,
          postalCode: '75011',
          country: 'FR',
          timezone: 'Europe/Paris',
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
      ]),
    )
  })

  it('does not throw, and shows the wizard', () => {
    // The regression test. Before the fix this threw
    // "useCurrentOrg must be used within a CurrentOrgProvider".
    expect(() => renderOnboarding()).not.toThrow()
    expect(screen.getByRole('heading', { name: /set up le fade parisien/i })).toBeInTheDocument()
  })

  it('renders for an approved owner whose organization is incomplete', () => {
    renderOnboarding()

    expect(screen.getByRole('navigation', { name: /setup steps/i })).toBeInTheDocument()
  })

  it.each([
    ['Google', { provider: 'google', providers: ['google'] }],
    ['Apple', { provider: 'apple', providers: ['apple'] }],
    ['email/password', { provider: 'email', providers: ['email'] }],
  ])('renders for a %s-authenticated owner', (_label, appMetadata) => {
    // Authorization is the owner membership; the provider is irrelevant. The
    // identity below differs only in how it signed in.
    mockUseAuth.mockReturnValue({
      session: {} as never,
      user: { id: 'user-1', app_metadata: appMetadata } as never,
      loading: false,
    })

    renderOnboarding()

    expect(screen.getByRole('heading', { name: /set up le fade parisien/i })).toBeInTheDocument()
  })

  it('resolves the single owned organization automatically', () => {
    renderOnboarding()

    expect(mockUseReadiness).toHaveBeenCalledWith('org-1')
    // One organization means no chooser to get in the way.
    expect(screen.queryByText('Setting up:')).not.toBeInTheDocument()
  })
})

describe('OnboardingPage — authorization', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
    mockUseReadiness.mockReturnValue(resolved(incompleteReadiness()))
    mockUseLocations.mockReturnValue(resolved([]))
  })

  it('sends a customer with no professional access to the workspace, not a create form', () => {
    mockUseAccess.mockReturnValue(
      resolved(access({ professionalAvailable: false, organizationCount: 0, applicationStatus: null, signupIntent: 'customer' })),
    )
    withOrganizations([])

    renderOnboarding()

    expect(screen.getByText('Workspace chooser')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /set up your business/i })).not.toBeInTheDocument()
  })

  it('sends a pending applicant to their application status', () => {
    mockUseAccess.mockReturnValue(
      resolved(access({ professionalAvailable: false, organizationCount: 0, applicationStatus: 'pending_review' })),
    )
    withOrganizations([])

    renderOnboarding()

    expect(screen.getByText('Application status')).toBeInTheDocument()
  })

  it('sends a rejected applicant to their application status', () => {
    mockUseAccess.mockReturnValue(
      resolved(access({ professionalAvailable: false, organizationCount: 0, applicationStatus: 'rejected' })),
    )
    withOrganizations([])

    renderOnboarding()

    expect(screen.getByText('Application status')).toBeInTheDocument()
  })

  it('still offers the legitimate self-serve create path to an account with no application', () => {
    // LOT A deliberately keeps this open — create_organization enforces the
    // application gate server-side, so the form is not the control.
    mockUseAccess.mockReturnValue(
      resolved(access({ professionalAvailable: false, organizationCount: 0, applicationStatus: null, signupIntent: null })),
    )
    withOrganizations([])

    renderOnboarding()

    expect(screen.getByRole('heading', { name: /set up your business/i })).toBeInTheDocument()
  })

  it('keeps a barber out of the setup wizard', () => {
    // Configuring the business is owner/manager work, and every onboarding
    // RPC re-checks exactly that server-side.
    mockUseAccess.mockReturnValue(resolved(access()))
    withOrganizations([membership({ role: 'barber' })])

    renderOnboarding()

    expect(screen.getByText('Professional workspace')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: /setup steps/i })).not.toBeInTheDocument()
  })

  it('ignores an ?org= id the user has no membership in', () => {
    // useResolvedOrganization validates the parameter against the RLS-scoped
    // membership list, so an injected id resolves to the caller's OWN
    // organization rather than addressing someone else's.
    mockUseAccess.mockReturnValue(resolved(access()))
    withOrganizations([membership()])

    renderOnboarding('/onboarding?org=00000000-0000-4000-8000-00000000dead')

    expect(mockUseResolvedOrg).toHaveBeenCalledWith('user-1', '00000000-0000-4000-8000-00000000dead')
    // Resolution fell back to the membership the caller genuinely holds.
    expect(mockUseReadiness).toHaveBeenCalledWith('org-1')
    expect(screen.getByRole('heading', { name: /set up le fade parisien/i })).toBeInTheDocument()
  })
})

describe('OnboardingPage — multiple organizations', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
    mockUseAccess.mockReturnValue(resolved(access({ organizationCount: 2, ownedOrganizationCount: 2 })))
    mockUseReadiness.mockReturnValue(resolved(incompleteReadiness()))
    mockUseLocations.mockReturnValue(resolved([]))
  })

  const both = [
    membership(),
    membership({ id: 'm-2', organizationId: 'org-2', organizationName: 'Studio Lyon', organizationSlug: 'studio-lyon' }),
  ]

  it('names the organization being configured and offers the others', () => {
    withOrganizations(both)

    renderOnboarding()

    expect(screen.getByText('Setting up:')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Le Fade Parisien' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Studio Lyon' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('configures the organization named by a VALID ?org=', () => {
    withOrganizations(both, 'org-2')

    renderOnboarding('/onboarding?org=org-2')

    expect(mockUseReadiness).toHaveBeenCalledWith('org-2')
    expect(screen.getByRole('heading', { name: /set up studio lyon/i })).toBeInTheDocument()
  })
})

describe('OnboardingPage — the Professionals step actually persists', () => {
  const ensureMutate = vi.fn()
  const assignMutate = vi.fn()

  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
    mockUseAccess.mockReturnValue(resolved(access()))
    withOrganizations([membership()])
    mockUseLocations.mockReturnValue(
      resolved([
        {
          id: 'loc-1', organizationId: 'org-1', name: 'Bastille',
          addressLine1: '2 rue de la Roquette', addressLine2: null, city: 'Paris', region: null,
          postalCode: '75011', country: 'FR', timezone: 'Europe/Paris', isActive: true,
          createdAt: '', updatedAt: '',
        },
      ]),
    )
    mockUseServices.mockReturnValue(
      resolved([
        { id: 'svc-1', organizationId: 'org-1', categoryId: null, name: 'Coupe', description: null, durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, priceCents: 2500, isActive: true, createdAt: '', updatedAt: '' },
        { id: 'svc-2', organizationId: 'org-1', categoryId: null, name: 'Fade', description: null, durationMinutes: 45, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, priceCents: 3000, isActive: true, createdAt: '', updatedAt: '' },
        { id: 'svc-3', organizationId: 'org-1', categoryId: null, name: 'Retired', description: null, durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, priceCents: 1000, isActive: false, createdAt: '', updatedAt: '' },
      ]),
    )

    ensureMutate.mockReset()
    ensureMutate.mockResolvedValue('barber-1')
    assignMutate.mockReset()
    assignMutate.mockResolvedValue(undefined)
    mockUseEnsurePro.mockReturnValue({ mutateAsync: ensureMutate, isPending: false } as never)
    mockUseAssignServices.mockReturnValue({ mutateAsync: assignMutate, isPending: false } as never)

    mockUseReadiness.mockReturnValue(
      resolved(incompleteReadiness({ hasService: true, hasServiceAtLocation: true })),
    )
  })

  function submitProfessionalStep() {
    renderOnboarding('/onboarding?step=professional')
    fireEvent.change(screen.getByLabelText('Your name as customers see it'), { target: { value: 'Karim B.' } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Barber' } })
    fireEvent.submit(screen.getByRole('button', { name: /i take clients/i }))
  }

  it('persists the professional with the name and title the owner typed', async () => {
    submitProfessionalStep()

    await waitFor(() => expect(ensureMutate).toHaveBeenCalled())
    expect(ensureMutate).toHaveBeenCalledWith({
      organizationId: 'org-1',
      locationId: 'loc-1',
      displayName: 'Karim B.',
      title: 'Barber',
    })
  })

  it('links the ACTIVE catalog to the new professional', async () => {
    // The production bug: this passed an empty services array, so no
    // barber_services row was ever created.
    submitProfessionalStep()

    await waitFor(() => expect(assignMutate).toHaveBeenCalled())
    expect(assignMutate).toHaveBeenCalledWith({
      organizationId: 'org-1',
      barberId: 'barber-1',
      serviceIds: ['svc-1', 'svc-2'],
    })
  })

  it('completes even when there is no catalog to link yet', async () => {
    mockUseServices.mockReturnValue(resolved([]))

    submitProfessionalStep()

    await waitFor(() => expect(ensureMutate).toHaveBeenCalled())
    expect(assignMutate).toHaveBeenCalledWith({ organizationId: 'org-1', barberId: 'barber-1', serviceIds: [] })
  })

  it('refuses to save without a name, and does not touch the database', async () => {
    renderOnboarding('/onboarding?step=professional')
    fireEvent.submit(screen.getByRole('button', { name: /i take clients/i }))

    await waitFor(() => expect(screen.getByText(/a name is required/i)).toBeInTheDocument())
    expect(ensureMutate).not.toHaveBeenCalled()
  })

  it('shows the Professionals step ticked once a professional exists', () => {
    // Derived from persisted readiness, so a refresh, a re-login or a Google
    // sign-in all reach the same conclusion.
    mockUseReadiness.mockReturnValue(
      resolved(incompleteReadiness({ hasProfessional: true, hasService: true, hasServiceAtLocation: true })),
    )

    renderOnboarding('/onboarding?step=review')

    expect(screen.getByRole('button', { name: 'Professionals' }).className).toContain('success')
  })
})
