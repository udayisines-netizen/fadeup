import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  useCampaignRecipients,
  useOutreachCampaign,
  type OutreachRecipientState,
} from '@/lib/queries/acquisition/outreach'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SelectField } from '@/components/ui/select-field'

const STATE_VARIANT: Partial<Record<OutreachRecipientState, BadgeVariant>> = {
  blocked: 'danger',
  pending: 'neutral',
  queued: 'info',
  sent: 'accent',
  delivered: 'accent',
  read: 'accent',
  replied: 'success',
  positive_reply: 'success',
  negative_reply: 'warning',
  failed: 'danger',
  opted_out: 'danger',
  claimed: 'success',
  activated: 'success',
  paid: 'success',
}

const STATE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All recipients' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'pending', label: 'Pending' },
  { value: 'queued', label: 'Queued' },
  { value: 'sent', label: 'Sent' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'read', label: 'Read' },
  { value: 'replied', label: 'Replied' },
  { value: 'positive_reply', label: 'Positive reply' },
  { value: 'failed', label: 'Failed' },
  { value: 'opted_out', label: 'Opted out' },
]

/**
 * /platform/outreach/whatsapp/:campaignId — recipient-level detail.
 *
 * The blocked list is the important half of this screen: when an owner
 * selects 500 prospects and 180 do not get messaged, this is where they
 * see exactly why, one reason per recipient. Nothing is silently dropped.
 */
export function PlatformOutreachCampaignDetailPage() {
  const { campaignId } = useParams<{ campaignId: string }>()
  const [stateFilter, setStateFilter] = useState<string>('all')

  const campaignQuery = useOutreachCampaign(campaignId)
  const recipientsQuery = useCampaignRecipients(
    campaignId,
    stateFilter === 'all' ? undefined : (stateFilter as OutreachRecipientState),
  )

  const blockedReasonCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const recipient of recipientsQuery.data ?? []) {
      if (recipient.state !== 'blocked' || !recipient.blockedReason) continue
      counts.set(recipient.blockedReason, (counts.get(recipient.blockedReason) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [recipientsQuery.data])

  if (campaignQuery.isPending) {
    return <Skeleton className="h-96 w-full" />
  }

  if (campaignQuery.isError) {
    return <ErrorState title="Couldn't load campaign" description={campaignQuery.error?.message} />
  }

  const campaign = campaignQuery.data

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/platform/outreach/whatsapp" className="text-sm text-ink-500 underline-offset-2 hover:underline">
          ← All campaigns
        </Link>
        <h2 className="mt-2 text-lg font-semibold text-ink-950">{campaign.name}</h2>
        <p className="mt-1 text-sm text-ink-500">
          {campaign.status} · created {new Date(campaign.createdAt).toLocaleString()}
          {campaign.approvedAt ? ` · approved ${new Date(campaign.approvedAt).toLocaleString()}` : ''}
        </p>
      </div>

      {blockedReasonCounts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Why recipients were blocked</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1.5">
              {blockedReasonCounts.map(([reason, count]) => (
                <li key={reason} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs text-ink-700">{reason}</span>
                  <span className="tabular-nums text-ink-950">{count}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-500">
              These prospects were never messaged. Each reason is produced by the same server-side gate that the send
              path enforces, so this list is the real explanation, not an estimate.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Recipients</CardTitle>
          <div className="w-full sm:w-56">
            <SelectField
              label="Filter by state"
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value)}
              options={STATE_OPTIONS}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {recipientsQuery.isPending ? (
            <div className="p-4">
              <Skeleton className="h-40 w-full" />
            </div>
          ) : recipientsQuery.data && recipientsQuery.data.length > 0 ? (
            <Table label="Campaign recipients">
              <TableHeader>
                <TableRow>
                  <TableHead>Prospect</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Locale</TableHead>
                  <TableHead>Selection</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipientsQuery.data.map((recipient) => (
                  <TableRow key={recipient.id}>
                    <TableCell>
                      <Link
                        to={`/platform/acquisition/prospects/${recipient.prospectId}`}
                        className="text-ink-950 underline-offset-2 hover:underline"
                      >
                        {recipient.prospectName ?? recipient.prospectId.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATE_VARIANT[recipient.state] ?? 'neutral'}>{recipient.state}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{recipient.templateKey ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{recipient.locale ?? '—'}</TableCell>
                    <TableCell className="text-xs">
                      {recipient.selectionMethod ? (
                        <div className="flex flex-col">
                          <span>{recipient.selectionMethod}</span>
                          {recipient.experimentArm ? (
                            <span className="text-ink-500">arm {recipient.experimentArm}</span>
                          ) : null}
                        </div>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs text-xs text-ink-600">
                      {recipient.blockedReason ? (
                        <span className="font-mono text-danger-700">{recipient.blockedReason}</span>
                      ) : recipient.lastError ? (
                        <span className="text-danger-700">{recipient.lastError}</span>
                      ) : recipient.renderedBody ? (
                        <span className="line-clamp-2">{recipient.renderedBody}</span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-6">
              <EmptyState title="No recipients in this state" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
