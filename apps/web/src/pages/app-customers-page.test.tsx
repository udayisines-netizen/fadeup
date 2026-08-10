import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AppCustomersPage } from '@/pages/app-customers-page'
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

function makeBuilder(result: QueryResult) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  }
  return builder
}

const EMPTY: QueryResult = { data: [], error: null }

function mockTables(overrides: Partial<Record<string, QueryResult>>) {
  const tables: Record<string, QueryResult> = {
    customers: EMPTY,
    appointments: EMPTY,
    ...overrides,
  }

  const from = vi.fn((table: string) => makeBuilder(tables[table] ?? EMPTY))
  mockGetSupabaseClient.mockReturnValue({ from } as unknown as SupabaseClient)
  return { from }
}

function customerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cust-1',
    organization_id: 'org-1',
    name: 'Alice Customer',
    phone: '555-0100',
    email: 'alice@example.com',
    notes: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
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
        <AppCustomersPage />
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

describe('AppCustomersPage', () => {
  beforeEach(() => {
    mockMembership('owner')
  })

  it('renders the customer list once loaded, with an owner able to add one', async () => {
    mockTables({ customers: { data: [customerRow()], error: null } })

    renderPage()

    expect(await screen.findByText('Alice Customer')).toBeInTheDocument()
    expect(screen.getByText('555-0100')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add customer' })).toBeInTheDocument()
  })

  it('renders an error state when the query fails', async () => {
    mockTables({ customers: { data: null, error: { message: 'network unreachable' } } })

    renderPage()

    expect(await screen.findByText("Couldn't load customers")).toBeInTheDocument()
    expect(screen.getByText('network unreachable')).toBeInTheDocument()
  })

  it('renders an empty state with no customers yet', async () => {
    mockTables({})

    renderPage()

    expect(await screen.findByText('No customers yet')).toBeInTheDocument()
  })

  it('filters the list by the search field', async () => {
    mockTables({
      customers: {
        data: [customerRow(), customerRow({ id: 'cust-2', name: 'Bob Other', phone: '555-0200', email: 'bob@example.com' })],
        error: null,
      },
    })

    renderPage()

    await screen.findByText('Alice Customer')
    expect(screen.getByText('Bob Other')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'alice' } })

    expect(screen.getByText('Alice Customer')).toBeInTheDocument()
    expect(screen.queryByText('Bob Other')).not.toBeInTheDocument()
  })

  it('hides "Add customer" for a barber-role viewer, who can still view a customer\'s detail read-only', async () => {
    mockMembership('barber')
    mockTables({
      customers: { data: [customerRow()], error: null },
      appointments: { data: [], error: null },
    })

    renderPage()

    await screen.findByText('Alice Customer')
    expect(screen.queryByRole('button', { name: 'Add customer' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'View' }))

    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByText('alice@example.com')).toBeInTheDocument())
    expect(within(dialog).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })
})
