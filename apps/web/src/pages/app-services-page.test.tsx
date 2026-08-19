import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AppServicesPage } from '@/pages/app-services-page'
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

type QueryResult = { data: unknown[] | null; error: { message: string } | null }

/** Minimal thenable query-builder stand-in — chainable like the real Supabase builder, but resolves whenever awaited regardless of which chain methods were called. */
function makeBuilder(result: QueryResult) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  }
  return builder
}

const EMPTY: QueryResult = { data: [], error: null }

function mockTables(overrides: Partial<Record<string, QueryResult>>) {
  const tables: Record<string, QueryResult> = {
    service_categories: EMPTY,
    services: EMPTY,
    locations: EMPTY,
    barbers: EMPTY,
    staff_profiles: EMPTY,
    service_locations: EMPTY,
    barber_services: EMPTY,
    ...overrides,
  }

  const from = vi.fn((table: string) => makeBuilder(tables[table] ?? EMPTY))
  mockGetSupabaseClient.mockReturnValue({ from } as unknown as SupabaseClient)
  return { from }
}

function serviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'svc-1',
    organization_id: 'org-1',
    category_id: null,
    name: 'Classic Haircut',
    description: null,
    duration_minutes: 30,
    buffer_before_minutes: 0,
    buffer_after_minutes: 5,
    price_cents: 3500,
    is_active: true,
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
        <AppServicesPage />
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

describe('AppServicesPage', () => {
  beforeEach(() => {
    mockMembership('owner')
  })

  it('renders services once loaded, with an owner able to add a service and a category', async () => {
    mockTables({ services: { data: [serviceRow()], error: null } })

    renderPage()

    expect(await screen.findByText('Classic Haircut')).toBeInTheDocument()
    // The SHOP's currency (EUR by default), not a hardcoded dollar sign.
    expect(screen.getByText('€35.00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add service' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add category' })).toBeInTheDocument()
  })

  it('renders an error state when a query fails', async () => {
    mockTables({ services: { data: null, error: { message: 'network unreachable' } } })

    renderPage()

    expect(await screen.findByText("Couldn't load your service catalog")).toBeInTheDocument()
    expect(screen.getByText('network unreachable')).toBeInTheDocument()
  })

  it('renders empty states for a brand-new org with no categories or services', async () => {
    mockTables({})

    renderPage()

    expect(await screen.findByText('No categories yet')).toBeInTheDocument()
    expect(screen.getByText('No services yet')).toBeInTheDocument()
  })

  it('hides add/edit actions for a non-managing member', async () => {
    mockMembership('receptionist')
    mockTables({ services: { data: [serviceRow()], error: null } })

    renderPage()

    await waitFor(() => expect(screen.getByText('Classic Haircut')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Add service' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add category' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })
})
