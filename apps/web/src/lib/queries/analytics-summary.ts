import { useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * `get_organization_analytics_summary` — R3's read contract, finally read.
 *
 * R3 shipped four aggregation contracts and wired none of them into a screen;
 * this is the first consumer. Nothing new is defined here: no event is added,
 * no taxonomy is widened, and §39 is satisfied because the numbers below
 * already existed and were simply never asked for.
 *
 * ============================================================================
 * AUTHORIZATION IS THE FUNCTION'S, NOT THIS FILE'S
 * ============================================================================
 *
 * The RPC re-derives owner/manager membership in its own body, BEFORE it even
 * parses the window, so a barber calling it gets 42501 rather than a number.
 * The `enabled` flag below is therefore a UX decision — do not fire a request
 * that is going to be refused — and never a security boundary. Removing it
 * would make the dashboard noisier, not less safe.
 *
 * ============================================================================
 * EVERY FUNNEL STARTS EMPTY, AND THAT IS NOT A BUG
 * ============================================================================
 *
 * R3 backfills nothing: `analytics_events` fills from application forward. A
 * shop that installed FadeUp yesterday has a genuinely empty summary, and the
 * dashboard must say so rather than showing zeroes that look like failure.
 * `hasAnyActivity` exists so a card can tell those two states apart.
 */

export interface OrganizationAnalyticsSummary {
  windowFrom: string
  windowTo: string

  profileViews: number
  uniqueAuthenticatedViewers: number
  distinctAnonymousSessions: number

  bookingStarts: number
  appointmentsCreated: number
  appointmentsConfirmed: number
  appointmentsCompleted: number
  appointmentsCancelled: number
  appointmentsNoShow: number

  queueViews: number
  queueJoins: number
  queueCompletions: number
  queueCancellations: number

  follows: number
  unfollows: number
  favorites: number
  unfavorites: number

  uniqueCustomers: number
  repeatCustomers: number

  /** Already a ratio in [0,1] from the server — never recomputed here. */
  bookingConversionRate: number | null
  queueConversionRate: number | null
}

interface SummaryRow {
  window_from: string
  window_to: string
  profile_views: number
  unique_authenticated_viewers: number
  distinct_anonymous_sessions: number
  booking_starts: number
  appointments_created: number
  appointments_confirmed: number
  appointments_completed: number
  appointments_cancelled: number
  appointments_no_show: number
  queue_views: number
  queue_joins: number
  queue_completions: number
  queue_cancellations: number
  follows: number
  unfollows: number
  favorites: number
  unfavorites: number
  unique_customers: number
  repeat_customers: number
  booking_conversion_rate: number | null
  queue_conversion_rate: number | null
}

function mapSummary(row: SummaryRow): OrganizationAnalyticsSummary {
  return {
    windowFrom: row.window_from,
    windowTo: row.window_to,
    profileViews: Number(row.profile_views),
    uniqueAuthenticatedViewers: Number(row.unique_authenticated_viewers),
    distinctAnonymousSessions: Number(row.distinct_anonymous_sessions),
    bookingStarts: Number(row.booking_starts),
    appointmentsCreated: Number(row.appointments_created),
    appointmentsConfirmed: Number(row.appointments_confirmed),
    appointmentsCompleted: Number(row.appointments_completed),
    appointmentsCancelled: Number(row.appointments_cancelled),
    appointmentsNoShow: Number(row.appointments_no_show),
    queueViews: Number(row.queue_views),
    queueJoins: Number(row.queue_joins),
    queueCompletions: Number(row.queue_completions),
    queueCancellations: Number(row.queue_cancellations),
    follows: Number(row.follows),
    unfollows: Number(row.unfollows),
    favorites: Number(row.favorites),
    unfavorites: Number(row.unfavorites),
    uniqueCustomers: Number(row.unique_customers),
    repeatCustomers: Number(row.repeat_customers),
    bookingConversionRate: row.booking_conversion_rate === null ? null : Number(row.booking_conversion_rate),
    queueConversionRate: row.queue_conversion_rate === null ? null : Number(row.queue_conversion_rate),
  }
}

/** True when the window contains ANY recorded activity at all. */
export function hasAnyActivity(summary: OrganizationAnalyticsSummary | null | undefined): boolean {
  if (!summary) return false
  return (
    summary.profileViews > 0 ||
    summary.bookingStarts > 0 ||
    summary.appointmentsCreated > 0 ||
    summary.queueViews > 0 ||
    summary.queueJoins > 0 ||
    summary.follows > 0 ||
    summary.favorites > 0
  )
}

export function useOrganizationAnalyticsSummary(
  organizationId: string | undefined,
  options?: { from?: string | null; to?: string | null; enabled?: boolean },
) {
  return useQuery({
    queryKey: ['organization-analytics-summary', organizationId, options?.from ?? null, options?.to ?? null],
    queryFn: async (): Promise<OrganizationAnalyticsSummary | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_organization_analytics_summary', {
        p_organization_id: organizationId,
        p_from: options?.from ?? null,
        p_to: options?.to ?? null,
      })
      if (error) throw error
      const rows = (data ?? []) as SummaryRow[]
      return rows[0] ? mapSummary(rows[0]) : null
    },
    enabled: Boolean(organizationId) && (options?.enabled ?? true),
    // These are aggregates over an append-only table, not live operational
    // state. Refetching them on every window focus would cost a scan for a
    // number that has barely moved.
    staleTime: 5 * 60_000,
    retry: false,
  })
}
