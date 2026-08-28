import { Link } from 'react-router-dom'
import { useAcquisitionOverview } from '@/lib/queries/acquisition/overview'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import type { ProspectScoreBucket, ProspectType } from '@/lib/queries/acquisition/types'

const TYPE_LABELS: Record<ProspectType, string> = {
  barbershop: 'Barbershops',
  independent_barber: 'Independent barbers',
}

const BUCKET_VARIANTS: Record<ProspectScoreBucket, BadgeVariant> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  HOT: 'danger',
}

/** /platform/acquisition (index) — real counts only; an unimplemented metric is simply omitted, never a placeholder (CLAUDE.md). */
export function PlatformAcquisitionOverviewPage() {
  const overviewQuery = useAcquisitionOverview()

  if (overviewQuery.isPending) {
    return <OverviewSkeleton />
  }

  if (overviewQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load acquisition stats"
        description={overviewQuery.error.message}
      />
    )
  }

  const stats = overviewQuery.data

  return (
    <div className="flex flex-col gap-8">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total prospects" value={stats.totalProspects} />
        <StatCard label="Discovered today" value={stats.discoveredToday} />
        <StatCard label="Running jobs" value={stats.jobCounts.running} to="/platform/acquisition/jobs?status=running" />
        <StatCard label="Queued jobs" value={stats.jobCounts.queued} to="/platform/acquisition/jobs?status=queued" />
        <StatCard
          label="Failed jobs"
          value={stats.jobCounts.failed}
          to="/platform/acquisition/jobs?status=failed"
          tone={stats.jobCounts.failed > 0 ? 'danger' : undefined}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By score bucket</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {(Object.entries(stats.byScoreBucket) as [ProspectScoreBucket, number][]).map(([bucket, count]) => (
              <div key={bucket} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                <Badge variant={BUCKET_VARIANTS[bucket]}>{bucket}</Badge>
                <span className="text-sm font-semibold text-ink-950">{count}</span>
              </div>
            ))}
            {stats.unscoredCount > 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2">
                <Badge variant="neutral">Not yet scored</Badge>
                <span className="text-sm font-semibold text-ink-950">{stats.unscoredCount}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By type</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {(Object.entries(stats.byType) as [ProspectType, number][]).map(([type, count]) => (
              <Link
                key={type}
                to={type === 'barbershop' ? '/platform/acquisition/barbershops' : '/platform/acquisition/independent-barbers'}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 hover:bg-paper-50"
              >
                <span className="text-sm text-ink-700">{TYPE_LABELS[type]}</span>
                <span className="text-sm font-semibold text-ink-950">{count}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top cities</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topCities.length === 0 ? (
              <EmptyState title="No located prospects yet" className="border-none p-0 py-4" />
            ) : (
              <ul className="flex flex-col gap-2">
                {stats.topCities.map((city) => (
                  <li key={`${city.country}:${city.city}`} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ink-800">
                      {city.city} <span className="text-ink-500">· {city.country}</span>
                    </span>
                    <span className="font-semibold text-ink-950">{city.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By source</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.bySource.length === 0 ? (
              <EmptyState title="No source data yet" className="border-none p-0 py-4" />
            ) : (
              <ul className="flex flex-col gap-2">
                {stats.bySource.map((source) => (
                  <li key={source.sourceId} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ink-800">{source.displayName}</span>
                    <span className="font-semibold text-ink-950">{source.prospectCount}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Source health</CardTitle>
            <Link to="/platform/acquisition/sources" className="text-sm font-medium text-accent-700 underline-offset-2 hover:underline">
              Manage sources
            </Link>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {stats.sourceHealth.map((source) => (
                <li key={source.sourceId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="font-medium text-ink-950">{source.displayName}</span>
                  <div className="flex items-center gap-3">
                    {source.isPaused ? <Badge variant="warning">Paused{source.pausedReason ? `: ${source.pausedReason}` : ''}</Badge> : null}
                    <span className="text-ink-500">
                      {source.successCount} ok · {source.failureCount} failed
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function StatCard({ label, value, to, tone }: { label: string; value: number; to?: string; tone?: 'danger' }) {
  const content = (
    <>
      <p className="text-sm text-ink-500">{label}</p>
      <p className={tone === 'danger' && value > 0 ? 'mt-1 text-2xl font-semibold text-danger-700' : 'mt-1 text-2xl font-semibold text-ink-950'}>
        {value}
      </p>
    </>
  )

  if (to) {
    return (
      <Link to={to}>
        <Card className="p-4 transition-colors hover:bg-paper-50">{content}</Card>
      </Link>
    )
  }

  return <Card className="p-4">{content}</Card>
}

function OverviewSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  )
}
