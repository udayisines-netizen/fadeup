import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OrganizationReadiness } from '@/lib/queries/onboarding'
import { ProV2ProfilePage } from '@/pro-v2/profile/pro-profile-page'

/**
 * The profile page's truths: the checklist is the server's readiness verdict
 * verbatim, Publish exists only when the server says publishable, and the
 * editors mirror the owner/manager RLS boundary.
 */

function readinessOf(overrides: Partial<OrganizationReadiness>): OrganizationReadiness {
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

const state: { role: string; readiness: OrganizationReadiness } = {
  role: 'owner',
  readiness: readinessOf({}),
}

const setVisibilityMutate = vi.fn()

vi.mock('@/pro-v2/shell/pro-v2-shell', () => ({
  useProScope: () => ({
    organizationId: 'org-1',
    organizationName: 'Side Agency',
    role: state.role,
    locationId: null,
    locations: [{ id: 'loc-1', name: 'Side Agency' }],
  }),
}))

vi.mock('@/lib/queries/onboarding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queries/onboarding')>()),
  useOrganizationReadiness: () => ({ data: state.readiness, isPending: false, isError: false }),
  useSaveBusinessProfile: () => ({ mutate: vi.fn(), isPending: false }),
  useEnsureOwnerProfessional: () => ({ mutate: vi.fn(), isPending: false }),
  useApplyStarterServices: () => ({ mutate: vi.fn(), isPending: false }),
  useApplyWeeklyHours: () => ({ mutate: vi.fn(), isPending: false }),
  useCompleteOnboarding: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/queries/organization-marketplace', () => ({
  useOrganizationMarketplaceVisibility: () => ({
    data: { marketplaceVisible: false, slug: 'side-agency', name: 'Side Agency' },
    isPending: false,
  }),
  useSetMarketplaceVisibility: () => ({ mutate: setVisibilityMutate, isPending: false }),
}))

vi.mock('@/lib/queries/locations', () => ({
  useOrgLocations: () => ({
    data: [
      {
        id: 'loc-1',
        organizationId: 'org-1',
        name: 'Side Agency',
        addressLine1: '1 Rue de la Paix',
        addressLine2: null,
        city: 'Paris',
        region: null,
        postalCode: '75002',
        country: 'FR',
        timezone: 'Europe/Paris',
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    isPending: false,
  }),
  useUpdateLocation: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/queries/staff-profiles', () => ({
  useOrgStaffProfiles: () => ({
    data: [
      {
        id: 'sp-1',
        organizationId: 'org-1',
        userId: 'user-1',
        locationId: 'loc-1',
        displayName: 'Sofian',
        title: 'Senior barber',
        bio: null,
        avatarUrl: null,
        isPublic: true,
      },
    ],
    isPending: false,
  }),
  useUpdateStaffProfile: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/queries/barbers', () => ({
  useOrgBarbers: () => ({ data: [{ id: 'b-1', staffProfileId: 'sp-1' }], isPending: false }),
}))

describe('setup checklist', () => {
  it('renders the server-reported gaps and offers Publish only when publishable', () => {
    state.role = 'owner'
    state.readiness = readinessOf({
      readyToPublish: true,
      isPublished: false,
      missingRequirements: ['location_hours'],
      hasLocationHours: false,
    })
    render(<ProV2ProfilePage />)

    expect(screen.getByText('Set your opening hours')).toBeInTheDocument()
    expect(screen.getByText('Publish')).toBeInTheDocument()
    // The default-hours quick action follows the same server verdict.
    expect(screen.getByText(/Apply default hours/)).toBeInTheDocument()
  })

  it('never offers Publish when the server says not publishable', () => {
    state.role = 'owner'
    state.readiness = readinessOf({
      readyToPublish: false,
      isPublished: false,
      missingRequirements: ['service'],
      hasService: false,
    })
    render(<ProV2ProfilePage />)

    expect(screen.queryByText('Publish')).not.toBeInTheDocument()
    expect(screen.getByText('Add at least one service')).toBeInTheDocument()
    expect(screen.getByText('Add starter services')).toBeInTheDocument()
  })
})

describe('role boundary', () => {
  it('hides every editor from a barber — the RLS boundary, mirrored', () => {
    state.role = 'barber'
    state.readiness = readinessOf({ isPublished: true })
    render(<ProV2ProfilePage />)

    expect(screen.getByText('Published')).toBeInTheDocument()
    expect(screen.queryByText('Business')).not.toBeInTheDocument()
    expect(screen.queryByText('Team')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})

describe('public listing', () => {
  it('flips marketplace visibility through the real mutation', () => {
    state.role = 'owner'
    state.readiness = readinessOf({ isPublished: true })
    render(<ProV2ProfilePage />)

    const toggle = screen.getByRole('switch')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    expect(setVisibilityMutate).toHaveBeenCalledWith(true)
  })
})
