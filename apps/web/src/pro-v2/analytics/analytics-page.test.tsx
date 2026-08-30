import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OrganizationAnalyticsSummary } from '@/lib/queries/analytics-summary'
import { ProV2AnalyticsPage } from '@/pro-v2/analytics/analytics-page'

/**
 * The analytics contract: server figures verbatim (conversion included), an
 * honest empty state, a daily series counting only completed rows, and no
 * deltas against a silent previous window.
 */

function summaryOf(overrides: Partial<OrganizationAnalyticsSummary>): OrganizationAnalyticsSummary {
  return {
    windowFrom: '2026-07-30T00:00:00Z',
    windowTo: '2026-08-29T00:00:00Z',
    profileViews: 0,
    uniqueAuthenticatedViewers: 0,
    distinctAnonymousSessions: 0,
    bookingStarts: 0,
    appointmentsCreated: 0,
    appointmentsConfirmed: 0,
    appointmentsCompleted: 0,
    appointmentsCancelled: 0,
    appointmentsNoShow: 0,
    queueViews: 0,
    queueJoins: 0,
    queueCompletions: 0,
    queueCancellations: 0,
    follows: 0,
    unfollows: 0,
    favorites: 0,
    unfavorites: 0,
    uniqueCustomers: 0,
    repeatCustomers: 0,
    bookingConversionRate: null,
    queueConversionRate: null,
    ...overrides,
  }
}

const state: {
  current: OrganizationAnalyticsSummary | null
  previous: OrganizationAnalyticsSummary | null
  appointments: Array<{ id: string; status: string; startsAt: string }>
} = { current: null, previous: null, appointments: [] }

vi.mock('@/pro-v2/shell/pro-v2-shell', () => ({
  useProScope: () => ({
    organizationId: 'org-1',
    organizationName: 'Side Agency',
    role: 'owner',
    locationId: null,
    locations: [{ id: 'loc-1', name: 'Side Agency' }],
  }),
}))

vi.mock('@/lib/queries/analytics-summary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queries/analytics-summary')>()),
  useOrganizationAnalyticsSummary: (
    _organizationId: string | undefined,
    options?: { from?: string | null },
  ) => {
    // The page's two windows are told apart by their `from` instant: the
    // previous window starts ~60 days back, the current one ~30.
    const daysBack = options?.from
      ? Math.round((Date.now() - new Date(options.from).getTime()) / 86_400_000)
      : 0
    const data = daysBack > 45 ? state.previous : state.current
    return { data, isPending: false, isError: false, refetch: vi.fn() }
  },
}))

vi.mock('@/lib/queries/calendar', () => ({
  useCalendarRange: () => ({
    appointments: state.appointments,
    timeBlocks: [],
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    realtimeStatus: 'live',
  }),
}))

describe('analytics page', () => {
  it('renders the server figures and the server conversion rate verbatim', () => {
    state.current = summaryOf({
      profileViews: 120,
      bookingStarts: 30,
      appointmentsCreated: 18,
      appointmentsCompleted: 12,
      bookingConversionRate: 0.42,
      uniqueCustomers: 9,
    })
    state.previous = null
    state.appointments = []
    render(<ProV2AnalyticsPage />)

    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    // 0.42 formatted, never recomputed from the funnel counts (12/30 ≠ 42%).
    expect(screen.getByText('42% conversion')).toBeInTheDocument()
    // A silent previous window means no delta annotations anywhere.
    expect(screen.queryByText(/previous 30 days/)).not.toBeInTheDocument()
  })

  it('shows the honest empty state for an organization with no recorded activity', () => {
    state.current = summaryOf({})
    state.previous = null
    state.appointments = []
    render(<ProV2AnalyticsPage />)

    expect(screen.getByText('No analytics yet')).toBeInTheDocument()
    expect(screen.queryByText('Booking funnel')).not.toBeInTheDocument()
  })

  it('counts only completed appointments in the daily series', () => {
    const today = new Date().toISOString()
    state.current = summaryOf({ profileViews: 5 })
    state.previous = null
    state.appointments = [
      { id: 'a1', status: 'completed', startsAt: today },
      { id: 'a2', status: 'completed', startsAt: today },
      { id: 'a3', status: 'cancelled', startsAt: today },
    ]
    render(<ProV2AnalyticsPage />)

    // The chart's accessible name counts the two completed rows, not the
    // cancelled one.
    expect(
      screen.getByLabelText('2 completed appointments over the last 30 days'),
    ).toBeInTheDocument()
  })

  it('annotates deltas when the previous window recorded activity', () => {
    state.current = summaryOf({ profileViews: 120 })
    state.previous = summaryOf({ profileViews: 100 })
    state.appointments = []
    render(<ProV2AnalyticsPage />)

    expect(screen.getByText('+20')).toBeInTheDocument()
    expect(screen.getByText(/previous 30 days/)).toBeInTheDocument()
  })
})
