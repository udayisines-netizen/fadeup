import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AppLocationsPage } from '@/pages/app-locations-page'
import { useCurrentOrg } from '@/lib/current-org-context'
import { getSupabaseClient } from '@/lib/supabase'
import { ToastProvider } from '@/components/ui/toast'

vi.mock('@/lib/current-org-context', () => ({
  useCurrentOrg: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseClient: vi.fn(),
}))

const mockUseCurrentOrg = vi.mocked(useCurrentOrg)
const mockGetSupabaseClient = vi.mocked(getSupabaseClient)

interface LocationRow {
  id: string
  organization_id: string
  name: string
  address_line1: string | null
  address_line2: string | null
  city: string | null
  region: string | null
  postal_code: string | null
  country: string | null
  timezone: string
  is_active: boolean
  created_at: string
  updated_at: string
}

function baseLocation(overrides: Partial<LocationRow>): LocationRow {
  return {
    id: 'loc-1',
    organization_id: 'org-1',
    name: 'Downtown',
    address_line1: null,
    address_line2: null,
    city: 'Austin',
    region: 'TX',
    postal_code: null,
    country: 'US',
    timezone: 'America/Chicago',
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function mockLocationsSelect(result: { data: LocationRow[] | null; error: { message: string } | null }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => Promise.resolve(result)),
  }
  const from = vi.fn(() => builder)
  mockGetSupabaseClient.mockReturnValue({ from } as unknown as SupabaseClient)
  return { from, builder }
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AppLocationsPage />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function mockMembership(role: 'owner' | 'manager' | 'receptionist' | 'barber') {
  mockUseCurrentOrg.mockReturnValue({
    membershipsQuery: {} as never,
    memberships: [],
    currentMembership: {
      id: 'membership-1',
      role,
      organizationId: 'org-1',
      organizationName: 'Fade Up Barbers',
      organizationSlug: 'fade-up-barbers',
    },
    setCurrentOrganizationId: vi.fn(),
  })
}

describe('AppLocationsPage', () => {
  beforeEach(() => {
    mockMembership('owner')
  })

  it('renders locations once loaded, with an owner able to add a location', async () => {
    mockLocationsSelect({ data: [baseLocation({})], error: null })

    renderPage()

    expect(await screen.findByText('Downtown')).toBeInTheDocument()
    expect(screen.getByText('Austin, TX, US')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add location' })).toBeInTheDocument()
  })

  it('renders an error state when the query fails', async () => {
    mockLocationsSelect({ data: null, error: { message: 'network unreachable' } })

    renderPage()

    expect(await screen.findByText("Couldn't load locations")).toBeInTheDocument()
    expect(screen.getByText('network unreachable')).toBeInTheDocument()
  })

  it('renders an empty state for a brand-new org with no locations', async () => {
    mockLocationsSelect({ data: [], error: null })

    renderPage()

    expect(await screen.findByText('No locations yet')).toBeInTheDocument()
  })

  it('hides the add/edit actions for a non-managing member', async () => {
    mockMembership('receptionist')
    mockLocationsSelect({ data: [baseLocation({})], error: null })

    renderPage()

    await waitFor(() => expect(screen.getByText('Downtown')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Add location' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })
})
