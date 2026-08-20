import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AppQueuePage } from '@/pages/app-queue-page'
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

/** Minimal thenable query-builder stand-in, same pattern as app-appointments-page.test.tsx. */
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

// Realtime is exercised via a fake channel — `useOrgQueue` subscribes on
// mount and unsubscribes on unmount; the mutation/invalidation path itself
// is what these tests assert on, not delivery of a live event.
function makeChannel() {
  const channel = {
    on: vi.fn(() => channel),
    subscribe: vi.fn(() => channel),
  }
  return channel
}

function mockTables(overrides: Partial<Record<string, QueryResult>>) {
  const tables: Record<string, QueryResult> = {
    locations: EMPTY,
    services: EMPTY,
    barbers: EMPTY,
    staff_profiles: EMPTY,
    queue_entries: EMPTY,
    ...overrides,
  }

  const from = vi.fn((table: string) => makeBuilder(tables[table] ?? EMPTY))
  const channel = vi.fn(() => makeChannel())
  const removeChannel = vi.fn()
  mockGetSupabaseClient.mockReturnValue({ from, channel, removeChannel } as unknown as SupabaseClient)
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

function barberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'barber-1',
    organization_id: 'org-1',
    staff_profile_id: 'profile-1',
    is_bookable: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function staffProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-1',
    organization_id: 'org-1',
    user_id: 'user-1',
    location_id: 'loc-1',
    display_name: 'Sam Barber',
    title: null,
    bio: null,
    avatar_url: null,
    is_public: true,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function queueEntryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'queue-1',
    organization_id: 'org-1',
    location_id: 'loc-1',
    barber_id: null,
    service_id: null,
    customer_name: 'Jordan Walk-in',
    customer_phone: '555-0100',
    status: 'waiting',
    notes: null,
    called_at: null,
    service_started_at: null,
    completed_at: null,
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
        <AppQueuePage />
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

describe('AppQueuePage', () => {
  beforeEach(() => {
    mockMembership('owner')
  })

  it("renders the live queue once loaded, with an owner able to add a walk-in and change status", async () => {
    mockTables({
      locations: { data: [locationRow()], error: null },
      barbers: { data: [barberRow()], error: null },
      staff_profiles: { data: [staffProfileRow()], error: null },
      queue_entries: { data: [queueEntryRow()], error: null },
    })

    renderPage()

    expect(await screen.findByText('Jordan Walk-in')).toBeInTheDocument()
    expect(screen.getByLabelText('Position 1')).toBeInTheDocument()
    expect(screen.getByText('Waiting')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add walk-in' })).toBeInTheDocument()
    // The one obvious next move is a real button, not an entry in a menu.
    expect(screen.getByRole('button', { name: 'Call' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update status' })).toBeInTheDocument()
  })

  it('offers exactly one tap for the move that always comes next', async () => {
    mockTables({
      locations: { data: [locationRow()], error: null },
      barbers: { data: [barberRow()], error: null },
      staff_profiles: { data: [staffProfileRow()], error: null },
      queue_entries: {
        data: [
          queueEntryRow({ id: 'q-waiting', customer_name: 'Waiting Person', status: 'waiting' }),
          queueEntryRow({ id: 'q-called', customer_name: 'Called Person', status: 'called' }),
          queueEntryRow({ id: 'q-serving', customer_name: 'Serving Person', status: 'in_service' }),
        ],
        error: null,
      },
    })

    renderPage()

    await screen.findByText('Waiting Person')
    // waiting -> Call, called -> Start, in service -> Finish. A barber does
    // this dozens of times a day, standing up, one-handed.
    expect(screen.getByRole('button', { name: 'Call' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument()
    // The destructive options stay in the overflow, never beside the common one.
    expect(screen.queryByRole('button', { name: 'Mark no-show' })).not.toBeInTheDocument()
  })

  it('leads with the person in the chair, then the person who is next', async () => {
    mockTables({
      locations: { data: [locationRow()], error: null },
      barbers: { data: [barberRow()], error: null },
      staff_profiles: { data: [staffProfileRow()], error: null },
      queue_entries: {
        data: [
          queueEntryRow({ id: 'q-serving', customer_name: 'Serving Person', status: 'in_service' }),
          queueEntryRow({ id: 'q-waiting', customer_name: 'Waiting Person', status: 'waiting' }),
        ],
        error: null,
      },
    })

    renderPage()

    await screen.findByText('Serving Person')
    expect(screen.getByText('In the chair')).toBeInTheDocument()
    // Someone being served outranks someone who is next: their state is the
    // one about to change.
    const headings = screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)
    expect(headings.indexOf('In the chair')).toBeLessThan(headings.indexOf('Waiting'))
  })

  it('files finished entries out of the way instead of burying the live queue', async () => {
    mockTables({
      locations: { data: [locationRow()], error: null },
      barbers: { data: [barberRow()], error: null },
      staff_profiles: { data: [staffProfileRow()], error: null },
      queue_entries: {
        data: [
          queueEntryRow({ id: 'q-waiting', customer_name: 'Waiting Person', status: 'waiting' }),
          queueEntryRow({ id: 'q-done', customer_name: 'Done Person', status: 'completed' }),
        ],
        error: null,
      },
    })

    renderPage()

    await screen.findByText('Waiting Person')
    expect(screen.getByText('1 finished today')).toBeInTheDocument()
    // Collapsed: a busy afternoon must not push three waiting people off-screen.
    expect(screen.getByText('Done Person').closest('details')).not.toHaveAttribute('open')
  })

  it('renders an error state when a query fails', async () => {
    mockTables({
      locations: { data: null, error: { message: 'network unreachable' } },
    })

    renderPage()

    expect(await screen.findByText("Couldn't load the queue")).toBeInTheDocument()
    expect(screen.getByText('network unreachable')).toBeInTheDocument()
  })

  it('renders an empty state for a location with no one waiting', async () => {
    mockTables({
      locations: { data: [locationRow()], error: null },
    })

    renderPage()

    expect(await screen.findByText('Nobody waiting')).toBeInTheDocument()
  })

  it('hides "Add walk-in" and status actions on OTHER barbers\' entries for a barber-role viewer', async () => {
    mockMembership('barber')
    mockTables({
      locations: { data: [locationRow()], error: null },
      barbers: { data: [barberRow(), barberRow({ id: 'barber-2', staff_profile_id: 'profile-2' })], error: null },
      staff_profiles: {
        data: [staffProfileRow(), staffProfileRow({ id: 'profile-2', user_id: 'user-2', display_name: 'Other Barber' })],
        error: null,
      },
      queue_entries: { data: [queueEntryRow({ barber_id: 'barber-2' })], error: null },
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Jordan Walk-in')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Add walk-in' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update status' })).not.toBeInTheDocument()
  })

  it('lets a barber-role viewer change status on their OWN assigned entry, since LOT 11 phase 1 self-service', async () => {
    mockMembership('barber')
    mockTables({
      locations: { data: [locationRow()], error: null },
      barbers: { data: [barberRow()], error: null },
      staff_profiles: { data: [staffProfileRow()], error: null },
      // queueEntryRow()'s default barber_id (null) means "any barber" — set
      // it to this viewer's own barber id to represent their assigned entry.
      queue_entries: { data: [queueEntryRow({ barber_id: 'barber-1' })], error: null },
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Jordan Walk-in')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Add walk-in' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update status' })).toBeInTheDocument()
  })
})
