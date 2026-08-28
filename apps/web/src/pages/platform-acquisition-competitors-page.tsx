import { useMemo } from 'react'
import { useBookingProviders, useCompetitorAnalytics } from '@/lib/queries/acquisition/competitors'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert } from '@/components/ui/alert'

/**
 * /platform/acquisition/competitors — the competitor intelligence board.
 *
 * Every number here comes from public.competitor_analytics, computed live
 * from real rows. Nothing is hardcoded, and a rate with no denominator
 * renders as "—" rather than 0%, so an untouched provider is visibly
 * untouched rather than apparently failing.
 */
export function PlatformAcquisitionCompetitorsPage() {
  const providersQuery = useBookingProviders()
  const analyticsQuery = useCompetitorAnalytics()

  const rows = useMemo(() => {
    const analyticsByKey = new Map((analyticsQuery.data ?? []).map((row) => [row.providerKey, row]))
    return (providersQuery.data ?? [])
      .filter((provider) => provider.isActive)
      .map((provider) => ({ provider, analytics: analyticsByKey.get(provider.key) }))
      .sort((a, b) => (b.analytics?.discovered ?? 0) - (a.analytics?.discovered ?? 0))
  }, [providersQuery.data, analyticsQuery.data])

  const totals = useMemo(() => {
    const source = analyticsQuery.data ?? []
    return {
      discovered: source.reduce((sum, row) => sum + row.discovered, 0),
      onCompetitor: source
        .filter((row) => !row.isSentinel && row.providerKey !== 'CUSTOM_BOOKING')
        .reduce((sum, row) => sum + row.discovered, 0),
      noBooking: source.find((row) => row.providerKey === 'NO_BOOKING')?.discovered ?? 0,
      unknown: source.find((row) => row.providerKey === 'UNKNOWN')?.discovered ?? 0,
    }
  }, [analyticsQuery.data])

  if (providersQuery.isPending || analyticsQuery.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-hidden="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (providersQuery.isError || analyticsQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load competitor intelligence"
        description={(providersQuery.error ?? analyticsQuery.error)?.message}
      />
    )
  }

  if (rows.length === 0) {
    return <EmptyState title="No booking providers registered" description="The competitor registry is empty." />
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Prospects with a booking observation" value={totals.discovered} />
        <SummaryCard label="On a competitor platform" value={totals.onCompetitor} tone="accent" />
        <SummaryCard label="Observed with no online booking" value={totals.noBooking} />
        <SummaryCard
          label="Booking status unknown"
          value={totals.unknown}
          hint="Not the same as “no booking” — enrichment has not determined these yet."
        />
      </div>

      <Alert variant="info">
        <p className="text-sm">
          A prospect appears under <strong>No online booking</strong> only after a website crawl completed and found no
          booking affordance. Prospects whose crawl failed or never ran stay <strong>Unknown</strong> and are never
          included in a “you have no online booking” campaign.
        </p>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Competitor funnel</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* Table brings its own scroll wrapper — no extra overflow container. */}
          <Table label="Competitor funnel">
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Discovered</TableHead>
                  <TableHead className="text-right">Qualified</TableHead>
                  <TableHead className="text-right">Contacted</TableHead>
                  <TableHead className="text-right">Replied</TableHead>
                  <TableHead className="text-right">Positive</TableHead>
                  <TableHead className="text-right">Claimed</TableHead>
                  <TableHead className="text-right">Activated</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Avg migration</TableHead>
                  <TableHead>Discovery</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ provider, analytics }) => (
                  <TableRow key={provider.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink-950">{provider.displayName}</span>
                        {provider.isSentinel ? <Badge variant="neutral">state</Badge> : null}
                      </div>
                      {provider.primaryMarkets.length > 0 ? (
                        <p className="mt-0.5 text-xs text-ink-500">{provider.primaryMarkets.join(', ')}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{analytics?.discovered ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{analytics?.qualified ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{analytics?.contacted ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <RateCell numerator={analytics?.replied ?? 0} denominator={analytics?.contacted ?? 0} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <RateCell numerator={analytics?.positiveReply ?? 0} denominator={analytics?.contacted ?? 0} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{analytics?.claimed ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{analytics?.activated ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{analytics?.paid ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {analytics?.avgMigrationScore === null || analytics?.avgMigrationScore === undefined
                        ? '—'
                        : Math.round(analytics.avgMigrationScore)}
                    </TableCell>
                    <TableCell>
                      <DiscoverySupport provider={provider} />
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provider discovery support</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-ink-700">
          <p>
            FadeUp detects a competitor from publicly-observable signals on a business’s own website — booking links,
            embedded widgets, iframe and script domains, and public structured data.
          </p>
          <p>
            Using a competitor as a <em>discovery source</em> (enumerating the barbers already on their platform)
            requires that provider to expose an official API or an openly accessible listing. Providers below marked{' '}
            <strong>not assessed</strong> have no confirmed compliant surface, so FadeUp does not attempt provider-side
            discovery for them. Bypassing a login, CAPTCHA or anti-bot control is not implemented and will not be.
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {(providersQuery.data ?? [])
              .filter((provider) => !provider.isSentinel && provider.discoveryNotes)
              .map((provider) => (
                <li key={provider.id} className="text-xs">
                  <strong className="text-ink-950">{provider.displayName}:</strong> {provider.discoveryNotes}
                </li>
              ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryCard({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: 'accent' }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-ink-500">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'accent' ? 'text-accent-600' : 'text-ink-950'}`}>
          {value.toLocaleString()}
        </p>
        {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

/** Renders a count with its rate, or an em dash when there is no denominator to divide by. */
function RateCell({ numerator, denominator }: { numerator: number; denominator: number }) {
  if (denominator === 0) {
    return <span className="text-ink-500">—</span>
  }
  return (
    <span>
      {numerator}
      <span className="ml-1 text-xs text-ink-500">({((numerator / denominator) * 100).toFixed(1)}%)</span>
    </span>
  )
}

function DiscoverySupport({ provider }: { provider: { isSentinel: boolean; supportsCompliantDiscovery: boolean | null } }) {
  if (provider.isSentinel) return <span className="text-xs text-ink-500">n/a</span>
  if (provider.supportsCompliantDiscovery === true) return <Badge variant="success">compliant API</Badge>
  if (provider.supportsCompliantDiscovery === false) return <Badge variant="neutral">none available</Badge>
  return <Badge variant="neutral">not assessed</Badge>
}
