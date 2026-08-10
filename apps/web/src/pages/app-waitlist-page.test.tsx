import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AppWaitlistPage } from '@/pages/app-waitlist-page'
import { useCurrentOrg } from '@/lib/current-org-context'
import { getSupabaseClient } from '@/lib/supabase'
import { ToastProvider } from '@/components/ui/toast'

vi.mock('@/lib/current-org-context', () => ({
  useCurrentOrg: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseClient: vi.fn(),
}))

vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(() => ({ session: null, user: { id: 'user-1' }, loading: false })),
}))

const mockUseCurrentOrg = vi.mocked(useCurrentOrg)
const mockGetSupabaseClient = vi.mocked(getSupabaseClient)

type QueryResult = { data: unknown[] | null; error: { message: string } | null }

function makeBuilder(result: QueryResult) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  }
  return builder
}

const EMPTY: QueryResult = { data: [], error: null }

function mockTables(overrides: Partial<Record<string, QueryResult>>) {
  const tables: Record<string, QueryResult> = {
    locations: EMPTY,
    services: EMPTY,
    barbers: EMPTY,
    staff_profiles: EMPTY,
    waitlist_entries: EMPTY,
    ...overrides,
  }

  const from = vi.fn((table: string) => makeBuilder(tables[table] ?? EMPTY))
  mockGetSupabaseClient.mockReturnValue({ from } as unknown as SupabaseClient)
  return { from }
}

function locationRow(overrides: Record<string, unknown> = {}) {
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

function waitlistEntryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wait-1',
    organization_id: 'org-1',
    location_id: 'loc-1',
    customer_id: null,
    customer_name: 'Jordan Waiting',
    customer_phone: '555-0100',
    customer_email: null,
    desired_service_id: null,
    desired_barber_id: null,
    notes: null,
    status: 'waiting',
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AppWaitlistPage />
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

describe('AppWaitlistPage', () => {
  beforeEach(() => {
    mockMembership('owner')
  })

  it('renders the waitlist once loaded, with an owner able to add an entry and change status', async () => {
    mockTables({
      locations: { data: [locationRow()], error: null },
      waitlist_entries: { data: [waitlistEntryRow()], error: null },
    })

    renderPage()

    expect(await screen.findByText('Jordan Waiting')).toBeInTheDocument()
    expect(screen.getByText('Waiting')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to waitlist' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update status' })).toBeInTheDocument()
  })

  it('renders an error state when a query fails', async () => {
    mockTables({
      locations: { data: null, error: { message: 'network unreachable' } },
    })

    renderPage()

    expect(await screen.findByText("Couldn't load the waitlist")).toBeInTheDocument()
    expect(screen.getByText('network unreachable')).toBeInTheDocument()
  })

  it('renders an empty state for a location with no one waiting', async () => {
    mockTables({
      locations: { data: [locationRow()], error: null },
    })

    renderPage()

    expect(await screen.findByText('No one is waiting')).toBeInTheDocument()
  })

  it('hides "Add to waitlist" and status actions for a barber-role viewer', async () => {
    mockMembership('barber')
    mockTables({
      locations: { data: [locationRow()], error: null },
      waitlist_entries: { data: [waitlistEntryRow()], error: null },
    })

    renderPage()

    expect(await screen.findByText('Jordan Waiting')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to waitlist' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update status' })).not.toBeInTheDocument()
  })
})
