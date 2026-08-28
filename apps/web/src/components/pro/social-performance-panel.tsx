import { useTranslation } from 'react-i18next'
import { Eye, Heart, TrendingUp, UserPlus } from 'lucide-react'
import { Panel } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { hasAnyActivity, type OrganizationAnalyticsSummary } from '@/lib/queries/analytics-summary'
import { cn } from '@/lib/cn'

/**
 * ============================================================================
 * SOCIAL PERFORMANCE, WITH CREATOR-ANALYTICS CHARACTER
 * ============================================================================
 *
 * §25 asks for analytics that feel closer to a creator dashboard than to
 * enterprise BI: trend cards, visual comparison, human context — and
 * explicitly not a rainbow palette or an Excel grid.
 *
 * The honest form of that here is a conversion BAR, not a chart. FadeUp has no
 * time series to plot: `get_organization_analytics_summary` returns totals for
 * one window, not a daily series, so a sparkline would have to invent its own
 * shape. A proportion IS visualisable from a total, and it is also the number
 * that matters — of the people who looked, how many started a booking.
 *
 * The colour is the accent and one neutral. Two colours is what §25 means by
 * "avoid rainbow chart palettes", and it also keeps the bar legible for
 * someone who cannot distinguish them, because the value is written beside it.
 *
 * ============================================================================
 * ZERO AND "NOTHING YET" ARE DIFFERENT ANSWERS
 * ============================================================================
 *
 * R3 backfills nothing — every funnel starts empty and fills from application
 * forward. A shop that installed FadeUp last week has a genuinely empty
 * window, and showing it a row of zeroes would read as "your profile is not
 * working" rather than "we have not been counting long". `hasAnyActivity`
 * separates them and the empty state says which one this is.
 */
export function SocialPerformancePanel({
  summary,
  isPending,
  isError,
}: {
  summary: OrganizationAnalyticsSummary | null | undefined
  isPending: boolean
  isError: boolean
}) {
  const { t } = useTranslation('app')

  return (
    <Panel title={t('dashboard.socialTitle')} meta={t('dashboard.socialMeta')}>
      {isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      ) : isError ? (
        // The RPC refuses a caller who is not owner/manager, and that is not
        // an error worth alarming anyone about — it is a card they should not
        // be looking at. Said quietly, once.
        <p className="text-sm text-ink-500">{t('dashboard.socialUnavailable')}</p>
      ) : !hasAnyActivity(summary) ? (
        <EmptyState
          icon={TrendingUp}
          title={t('dashboard.socialEmptyTitle')}
          description={t('dashboard.socialEmptyDescription')}
        />
      ) : summary ? (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-3 gap-3">
            <Stat icon={<Eye className="h-4 w-4" />} value={summary.profileViews} label={t('dashboard.socialViews')} />
            <Stat icon={<UserPlus className="h-4 w-4" />} value={summary.follows} label={t('dashboard.socialFollows')} />
            <Stat icon={<Heart className="h-4 w-4" />} value={summary.favorites} label={t('dashboard.socialFavorites')} />
          </div>

          {summary.bookingConversionRate !== null ? (
            <ConversionBar
              label={t('dashboard.socialConversion')}
              hint={t('dashboard.socialConversionHint')}
              rate={summary.bookingConversionRate}
            />
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-ink-500">
        <span aria-hidden="true">{icon}</span>
        <span className="truncate text-label uppercase">{label}</span>
      </span>
      {/* `tabular-nums` so a column of KPIs does not jitter as values change. */}
      <span className="text-kpi tabular-nums text-ink-950">{value}</span>
    </div>
  )
}

/**
 * One proportion, drawn once.
 *
 * `role="img"` with a full `aria-label`: the bar is decoration for a number
 * that is also written beside it, and letting a screen reader walk into two
 * nested divs would announce nothing useful. The percentage is rounded for
 * display only — the server's ratio is never recomputed here.
 */
function ConversionBar({ label, hint, rate }: { label: string; hint: string; rate: number }) {
  const percent = Math.round(Math.min(1, Math.max(0, rate)) * 100)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-caption font-medium text-ink-700">{label}</span>
        <span className="text-base font-semibold tabular-nums text-ink-950">{percent}%</span>
      </div>
      <div
        role="img"
        aria-label={`${label}: ${percent}%`}
        className="h-2 w-full overflow-hidden rounded-full bg-paper-200"
      >
        <div
          className={cn(
            'h-full rounded-full bg-accent-600',
            'transition-[width] duration-[--fu-duration-settle] ease-[--fu-ease-out] motion-reduce:transition-none',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-pretty text-xs text-ink-500">{hint}</p>
    </div>
  )
}
