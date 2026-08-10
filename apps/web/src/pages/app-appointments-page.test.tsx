import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AppAppointmentsPage } from '@/pages/app-appointments-page'
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

/** Minimal thenable query-builder stand-in — chainable like the real Supabase builder, but resolves whenever awaited regardless of which chain methods were called. */
function makeBuilder(result: QueryResult) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    then: (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  }
  return builder
}

const EMPTY: QueryResult = { data: [], error: null }

function mockTables(overrides: Partial<Record<string, QueryResult>>) {
  const tables: Record<string, QueryResult> = {
    locations: EMPTY,
    chairs: EMPTY,
    services: EMPTY,
    service_locations: EMPTY,
    barber_services: EMPTY,
    barbers: EMPTY,
    staff_profiles: EMPTY,
    appointments: EMPTY,
    ...overrides,
  }

  const from = vi.fn((table: string) => makeBuilder(tables[table] ?? EMPTY))
  // useApplyNoShowRule (LOT 13) fires once on mount via a plain RPC call —
  // stub it to a no-op success so it doesn't throw in every test here.
  const rpc = vi.fn(() => Promise.resolve({ data: 0, error: null }))
  mockGetSupabaseClient.mockReturnValue({ from, rpc } as unknown as SupabaseClient)
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

function appointmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appt-1',
    organization_id: 'org-1',
    location_id: 'loc-1',
    barber_id: 'barber-1',
    chair_id: null,
    service_id: 'svc-1',
    customer_name: 'Jordan Customer',
    customer_phone: '555-0100',
    customer_email: null,
    starts_at: '2026-08-09T15:00:00.000Z',
    ends_at: '2026-08-09T15:30:00.000Z',
    buffer_before_minutes: 0,
    buffer_after_minutes: 5,
    status: 'confirmed',
    notes: null,
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
        <AppAppointmentsPage />
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

describe('AppAppointmentsPage', () => {
  beforeEach(() => {
    mockMembership('owner')
  })

  it("renders the day's appointments once loaded, with an owner able to book a new one", async () => {
    mockTables({
      locations: { data: [locationRow()], error: null },
      services: { data: [serviceRow()], error: null },
      barbers: { data: [barberRow()], error: null },
      staff_profiles: { data: [staffProfileRow()], error: null },
      appointments: { data: [appointmentRow()], error: null },
    })

    renderPage()

    expect(await screen.findByText('Jordan Customer')).toBeInTheDocument()
    expect(screen.getByText('Classic Haircut')).toBeInTheDocument()
    expect(screen.getByText('Sam Barber')).toBeInTheDocument()
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New appointment' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update status' })).toBeInTheDocument()
  })

  it('renders an error state when a query fails', async () => {
    mockTables({
      locations: { data: null, error: { message: 'network unreachable' } },
    })

    renderPage()

    expect(await screen.findByText("Couldn't load the schedule")).toBeInTheDocument()
    expect(screen.getByText('network unreachable')).toBeInTheDocument()
  })

  it('renders an empty state for a location with nothing booked that day', async () => {
    mockTables({
      locations: { data: [locationRow()], error: null },
    })

    renderPage()

    expect(await screen.findByText('No appointments')).toBeInTheDocument()
  })

  it('hides booking actions and status actions on OTHER barbers\' appointments for a barber-role viewer', async () => {
    mockMembership('barber')
    mockTables({
      locations: { data: [locationRow()], error: null },
      services: { data: [serviceRow()], error: null },
      // The signed-in barber (user-1 / profile-1) has their own barbers row,
      // but the appointment below is assigned to a DIFFERENT barber.
      barbers: { data: [barberRow(), barberRow({ id: 'barber-2', staff_profile_id: 'profile-2' })], error: null },
      staff_profiles: {
        data: [staffProfileRow(), staffProfileRow({ id: 'profile-2', user_id: 'user-2', display_name: 'Other Barber' })],
        error: null,
      },
      appointments: { data: [appointmentRow({ barber_id: 'barber-2' })], error: null },
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Jordan Customer')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'New appointment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update status' })).not.toBeInTheDocument()
  })

  it('lets a barber-role viewer change status on their OWN assigned appointment, since LOT 11 phase 1 self-service', async () => {
    mockMembership('barber')
    mockTables({
      locations: { data: [locationRow()], error: null },
      services: { data: [serviceRow()], error: null },
      barbers: { data: [barberRow()], error: null },
      staff_profiles: { data: [staffProfileRow()], error: null },
      // appointmentRow()'s default barber_id ('barber-1') matches barberRow()
      // above, and staffProfileRow()'s user_id ('user-1') matches the mocked
      // signed-in user — this appointment is the viewer's own.
      appointments: { data: [appointmentRow()], error: null },
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Jordan Customer')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'New appointment' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update status' })).toBeInTheDocument()
  })
})
