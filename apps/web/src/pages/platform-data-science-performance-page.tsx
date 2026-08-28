import { useMemo, useState } from 'react'
import { useOutreachFunnelStats, useTemplatePerformance } from '@/lib/queries/acquisition/outreach'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SelectField } from '@/components/ui/select-field'

type Dimension = 'templateKey' | 'locale' | 'salesAngle' | 'bookingProviderKey' | 'country' | 'campaignName'

const DIMENSION_OPTIONS: { value: Dimension; label: string }[] = [
  { value: 'campaignName', label: 'Campaign' },
  { value: 'templateKey', label: 'Template' },
  { value: 'locale', label: 'Locale' },
  { value: 'salesAngle', label: 'Sales angle' },
  { value: 'bookingProviderKey', label: 'Competitor' },
  { value: 'country', label: 'Country' },
]

/**
 * /platform/data-science/performance — the acquisition funnel, sliced.
 *
 * The funnel deliberately runs all the way to PAID. Reply and read rates
 * are shown, but the columns that decide whether a template or an angle is
 * actually working are activation and paid — optimising for replies
 * optimises for curiosity, not revenue (spec §70).
 */
export function PlatformDataSciencePerformancePage() {
  const [dimension, setDimension] = useState<Dimension>('campaignName')

  const funnelQuery = useOutreachFunnelStats()
  const templateQuery = useTemplatePerformance()

  const grouped = useMemo(() => {
    const totals = new Map<
      string,
      {
        recipients: number
        blocked: number
        sent: number
        delivered: number
        read: number
        replied: number
        positive: number
        claimed: number
        activated: number
        paid: number
      }
    >()

    for (const row of funnelQuery.data ?? []) {
      const key = String(row[dimension] ?? '—')
      const existing = totals.get(key) ?? {
        recipients: 0,
        blocked: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        replied: 0,
        positive: 0,
        claimed: 0,
        activated: 0,
        paid: 0,
      }
      totals.set(key, {
        recipients: existing.recipients + row.recipients,
        blocked: existing.blocked + row.blocked,
        sent: existing.sent + row.sent,
        delivered: existing.delivered + row.delivered,
        read: existing.read + row.read,
        replied: existing.replied + row.replied,
        positive: existing.positive + row.positiveReply,
        claimed: existing.claimed + row.claimed,
        activated: existing.activated + row.activated,
        paid: existing.paid + row.paid,
      })
    }

    return [...totals.entries()].sort((a, b) => b[1].sent - a[1].sent)
  }, [funnelQuery.data, dimension])

  const overall = useMemo(() => {
    return grouped.reduce(
      (acc, [, value]) => ({
        recipients: acc.recipients + value.recipients,
        blocked: acc.blocked + value.blocked,
        sent: acc.sent + value.sent,
        delivered: acc.delivered + value.delivered,
        read: acc.read + value.read,
        replied: acc.replied + value.replied,
        positive: acc.positive + value.positive,
        claimed: acc.claimed + value.claimed,
        activated: acc.activated + value.activated,
        paid: acc.paid + value.paid,
      }),
      {
        recipients: 0,
        blocked: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        replied: 0,
        positive: 0,
        claimed: 0,
        activated: 0,
        paid: 0,
      },
    )
  }, [grouped])

  if (funnelQuery.isPending || templateQuery.isPending) {
    return <Skeleton className="h-96 w-full" />
  }

  if (funnelQuery.isError) {
    return <ErrorState title="Couldn't load funnel analytics" description={funnelQuery.error?.message} />
  }

  if (grouped.length === 0) {
    return (
      <EmptyState
        title="No outreach data yet"
        description="The funnel populates once a campaign has been prepared and sent."
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Overall funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <FunnelStat label="Selected" value={overall.recipients} />
            <FunnelStat label="Blocked" value={overall.blocked} tone="warning" />
            <FunnelStat label="Sent" value={overall.sent} />
            <FunnelStat label="Delivered" value={overall.delivered} of={overall.sent} />
            <FunnelStat label="Read" value={overall.read} of={overall.sent} />
            <FunnelStat label="Replied" value={overall.replied} of={overall.sent} />
            <FunnelStat label="Positive" value={overall.positive} of={overall.sent} />
            <FunnelStat label="Claimed" value={overall.claimed} of={overall.sent} />
            <FunnelStat label="Activated" value={overall.activated} of={overall.sent} tone="accent" />
            <FunnelStat label="Paid" value={overall.paid} of={overall.sent} tone="accent" />
          </div>
        </CardContent>
      </Card>

      <Alert variant="info">
        <p className="text-sm">
          Delivered and read are diagnostic, not goals. Compare slices on <strong>activated</strong> and{' '}
          <strong>paid</strong> — those are the only columns that correspond to business value.
        </p>
      </Alert>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Breakdown</CardTitle>
          <div className="w-full sm:w-56">
            <SelectField
              label="Group by"
              value={dimension}
              onChange={(event) => setDimension(event.target.value as Dimension)}
              options={DIMENSION_OPTIONS}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table label="Funnel breakdown">
            <TableHeader>
              <TableRow>
                <TableHead>{DIMENSION_OPTIONS.find((option) => option.value === dimension)?.label}</TableHead>
                <TableHead className="text-right">Selected</TableHead>
                <TableHead className="text-right">Blocked</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Replied</TableHead>
                <TableHead className="text-right">Positive</TableHead>
                <TableHead className="text-right">Activated</TableHead>
                <TableHead className="text-right">Paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grouped.map(([key, value]) => (
                <TableRow key={key}>
                  <TableCell className="font-mono text-xs">{key}</TableCell>
                  <TableCell className="text-right tabular-nums">{value.recipients}</TableCell>
                  <TableCell className="text-right tabular-nums">{value.blocked}</TableCell>
                  <TableCell className="text-right tabular-nums">{value.sent}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Rate value={value.replied} of={value.sent} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Rate value={value.positive} of={value.sent} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Rate value={value.activated} of={value.sent} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Rate value={value.paid} of={value.sent} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function FunnelStat({
  label,
  value,
  of,
  tone,
}: {
  label: string
  value: number
  of?: number
  tone?: 'accent' | 'warning'
}) {
  const toneClass = tone === 'accent' ? 'text-accent-600' : tone === 'warning' ? 'text-warning-700' : 'text-ink-950'
  return (
    <div>
      <p className="text-xs text-ink-500">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${toneClass}`}>{value.toLocaleString()}</p>
      {of !== undefined && of > 0 ? (
        <p className="text-xs text-ink-500">{((value / of) * 100).toFixed(1)}% of sent</p>
      ) : null}
    </div>
  )
}

/** A count plus its rate, or an em dash when the denominator is zero. */
function Rate({ value, of }: { value: number; of: number }) {
  if (of === 0) return <span className="text-ink-500">—</span>
  return (
    <span>
      {value}
      <span className="ml-1 text-xs text-ink-500">({((value / of) * 100).toFixed(1)}%)</span>
    </span>
  )
}
