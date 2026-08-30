import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProV2RetentionPage } from '@/pro-v2/retention/retention-page'

/**
 * Retention truths: the win-back list is arithmetic on real rows (lapsed
 * means no completed visit for 60+ days AND nothing booked), plan management
 * mirrors the owner/manager RLS boundary, and staff transitions go through
 * the real status mutation.
 */

const DAY_MS = 86_400_000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString()
const daysAhead = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString()

const state: {
  role: string
  appointments: Array<{ customerId: string | null; locationId: string; startsAt: string; status: string }>
  customers: Array<{ id: string; name: string; phone: string | null; email: string | null }>
  plans: Array<Record<string, unknown>>
  enrollments: Array<Record<string, unknown>>
} = { role: 'owner', appointments: [], customers: [], plans: [], enrollments: [] }

const updateStatusMutate = vi.fn()

vi.mock('@/pro-v2/shell/pro-v2-shell', () => ({
  useProScope: () => ({
    organizationId: 'org-1',
    organizationName: 'Side Agency',
    role: state.role,
    locationId: null,
    locations: [{ id: 'loc-1', name: 'Side Agency' }],
  }),
}))

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, session: null, loading: false }),
}))

vi.mock('@/lib/queries/appointments', () => ({
  useOrgAppointmentsSince: () => ({ data: state.appointments, isPending: false, isError: false }),
}))

vi.mock('@/lib/queries/customers', () => ({
  useOrgCustomers: () => ({ data: state.customers, isPending: false, isError: false }),
}))

vi.mock('@/lib/queries/membership-plans', () => ({
  useOrgMembershipPlans: () => ({ data: state.plans, isPending: false, isError: false }),
  useCreateMembershipPlan: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateMembershipPlan: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/queries/customer-memberships', () => ({
  useOrgCustomerMemberships: () => ({ data: state.enrollments, isPending: false, isError: false }),
  useEnrollCustomerMembership: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateCustomerMembershipStatus: () => ({ mutate: updateStatusMutate, isPending: false }),
}))

vi.mock('@/lib/intl/use-intl', () => ({
  useMoney: () => (amountMinor: number) => `€${(amountMinor / 100).toFixed(2)}`,
  useOrganizationCurrency: () => 'EUR',
}))

const CUSTOMERS = [
  { id: 'c-lapsed', name: 'Karim Lapsed', phone: '+33600000001', email: null },
  { id: 'c-booked', name: 'Nora Booked', phone: null, email: 'nora@example.com' },
  { id: 'c-recent', name: 'Ryan Recent', phone: null, email: null },
]

const PLAN = {
  id: 'plan-1',
  organizationId: 'org-1',
  name: 'Fresh Fade Club',
  description: null,
  priceCents: 2500,
  billingInterval: 'monthly',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('win-back', () => {
  it('lists only genuinely lapsed customers — old last visit AND nothing booked', () => {
    state.role = 'owner'
    state.customers = CUSTOMERS
    state.plans = []
    state.enrollments = []
    state.appointments = [
      // Lapsed: completed 70 days ago, nothing upcoming.
      { customerId: 'c-lapsed', locationId: 'loc-1', startsAt: daysAgo(70), status: 'completed' },
      // Not lapsed: old visit BUT a booking next week.
      { customerId: 'c-booked', locationId: 'loc-1', startsAt: daysAgo(80), status: 'completed' },
      { customerId: 'c-booked', locationId: 'loc-1', startsAt: daysAhead(7), status: 'confirmed' },
      // Not lapsed: visited 10 days ago.
      { customerId: 'c-recent', locationId: 'loc-1', startsAt: daysAgo(10), status: 'completed' },
    ]
    render(<ProV2RetentionPage />)

    expect(screen.getByText('Karim Lapsed')).toBeInTheDocument()
    expect(screen.getByText('70 days ago')).toBeInTheDocument()
    expect(screen.queryByText('Nora Booked')).not.toBeInTheDocument()
    expect(screen.queryByText('Ryan Recent')).not.toBeInTheDocument()
  })
})

describe('plans', () => {
  it('shows the plan with its real price and management for an owner', () => {
    state.role = 'owner'
    state.customers = []
    state.appointments = []
    state.plans = [PLAN]
    state.enrollments = []
    render(<ProV2RetentionPage />)

    expect(screen.getByText('Fresh Fade Club')).toBeInTheDocument()
    expect(screen.getByText(/€25\.00/)).toBeInTheDocument()
    expect(screen.getByText('New plan')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
  })

  it('hides plan management from a barber — mirroring the RLS boundary', () => {
    state.role = 'barber'
    state.customers = []
    state.appointments = []
    state.plans = [PLAN]
    state.enrollments = []
    render(<ProV2RetentionPage />)

    expect(screen.getByText('Fresh Fade Club')).toBeInTheDocument()
    expect(screen.queryByText('New plan')).not.toBeInTheDocument()
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
  })
})

describe('members', () => {
  it('cancels through the real status mutation', () => {
    state.role = 'owner'
    state.customers = CUSTOMERS
    state.appointments = []
    state.plans = [PLAN]
    state.enrollments = [
      {
        id: 'enr-1',
        organizationId: 'org-1',
        customerId: 'c-recent',
        planId: 'plan-1',
        status: 'active',
        startedAt: '2026-08-01T00:00:00Z',
        currentPeriodStart: '2026-08-01T00:00:00Z',
        currentPeriodEnd: '2026-09-01T00:00:00Z',
        cancelledAt: null,
        notes: null,
        createdBy: null,
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-01T00:00:00Z',
      },
    ]
    render(<ProV2RetentionPage />)

    // Appears both as the member row and as an enroll-form option.
    expect(screen.getAllByText(/Ryan Recent/).length).toBeGreaterThan(0)
    expect(screen.getByText('Pause')).toBeInTheDocument()

    // The membership row's own Cancel (the plan form is closed, so it is the
    // only Cancel on screen).
    fireEvent.click(screen.getByText('Cancel'))
    expect(updateStatusMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'enr-1', status: 'cancelled' }),
    )
  })
})
