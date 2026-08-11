import { useMemo } from 'react'
import { useRecentApiUsage } from '@/lib/queries/acquisition/api-usage'
import { useApiSourceHealth, useProspectSources } from '@/lib/queries/acquisition/sources'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'

/** /platform/acquisition/api-usage — per-source aggregate request stats + recent api_usage log (last 50 calls). */
export function PlatformAcquisitionApiUsagePage() {
  const sourcesQuery = useProspectSources()
  const healthQuery = useApiSourceHealth()
  const usageQuery = useRecentApiUsage()

  const isSummaryLoading = sourcesQuery.isPending || healthQuery.isPending
  const summaryError = sourcesQuery.error ?? healthQuery.error
  const isSummaryError = sourcesQuery.isError || healthQuery.isError

  const summaryRows = useMemo(() => {
    if (!sourcesQuery.data || !healthQuery.data) return []
    const healthMap = new Map(healthQuery.data.map((row) => [row.sourceId, row]))
    return sourcesQuery.data.map((source) => {
      const health = healthMap.get(source.id)
      const total = (health?.successCount ?? 0) + (health?.failureCount ?? 0)
      const successRate = total > 0 ? Math.round(((health?.successCount ?? 0) / total) * 100) : null
      return {
        source,
        requestsToday: health?.requestsToday ?? 0,
        requestsThisMonth: health?.requestsThisMonth ?? 0,
        successRate,
        avgLatencyMs: health?.avgLatencyMs ?? null,
        lastRequestAt: health?.lastRequestAt ?? null,
      }
    })
  }, [sourcesQuery.data, healthQuery.data])

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Per-source summary</h2>
        <div className="mt-3">
          {isSummaryLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : isSummaryError ? (
            <ErrorState title="Couldn't load source usage" description={summaryError?.message} />
          ) : summaryRows.length === 0 ? (
            <EmptyState title="No sources configured" />
          ) : (
            <Table label="Per-source usage summary">
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Requests today</TableHead>
                  <TableHead>Requests this month</TableHead>
                  <TableHead>Success rate</TableHead>
                  <TableHead>Avg latency</TableHead>
                  <TableHead>Last request</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaryRows.map((row) => (
                  <TableRow key={row.source.id}>
                    <TableCell className="font-medium text-ink-950">{row.source.displayName}</TableCell>
                    <TableCell className="text-ink-700">{row.requestsToday}</TableCell>
                    <TableCell className="text-ink-700">{row.requestsThisMonth}</TableCell>
                    <TableCell>
                      {row.successRate === null ? (
                        <span className="text-ink-500">No calls yet</span>
                      ) : (
                        <Badge variant={row.successRate >= 90 ? 'success' : row.successRate >= 50 ? 'warning' : 'danger'}>
                          {row.successRate}%
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-ink-700">{row.avgLatencyMs != null ? `${Math.round(row.avgLatencyMs)} ms` : '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-ink-500">
                      {row.lastRequestAt ? new Date(row.lastRequestAt).toLocaleString() : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Recent calls</h2>
        <div className="mt-3">
          {usageQuery.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : usageQuery.isError ? (
            <ErrorState title="Couldn't load API usage log" description={usageQuery.error.message} />
          ) : usageQuery.data.length === 0 ? (
            <EmptyState title="No API calls logged yet" />
          ) : (
            <Table label="Recent API calls">
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Status code</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usageQuery.data.length === 0 ? (
                  <TableStateRow colSpan={6}>
                    <EmptyState title="No API calls logged yet" className="border-none" />
                  </TableStateRow>
                ) : (
                  usageQuery.data.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium text-ink-950">{entry.sourceDisplayName}</TableCell>
                      <TableCell className="max-w-[14rem] truncate text-ink-500">{entry.endpoint ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={entry.success ? 'success' : 'danger'}>{entry.success ? 'Success' : 'Failed'}</Badge>
                      </TableCell>
                      <TableCell className="text-ink-500">{entry.statusCode ?? '—'}</TableCell>
                      <TableCell className="text-ink-500">{entry.latencyMs != null ? `${entry.latencyMs} ms` : '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-ink-500">{new Date(entry.requestedAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
    </div>
  )
}
