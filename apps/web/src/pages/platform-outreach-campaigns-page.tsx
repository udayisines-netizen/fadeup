import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  useEnqueueWhatsAppSend,
  useOutreachCampaigns,
  useOutreachFunnelStats,
  usePrepareOutreachCampaign,
  useSetOutreachCampaignStatus,
  useWhatsAppAccounts,
  type OutreachCampaign,
  type OutreachCampaignStatus,
} from '@/lib/queries/acquisition/outreach'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import { usePlatformRole } from '@/routes/require-platform-role'

const WRITE_ROLES = new Set(['platform_owner', 'platform_admin'])

const STATUS_VARIANT: Record<OutreachCampaignStatus, BadgeVariant> = {
  draft: 'neutral',
  preparing: 'info',
  ready: 'accent',
  running: 'success',
  paused: 'warning',
  completed: 'neutral',
  cancelled: 'neutral',
  failed: 'danger',
}

/**
 * /platform/outreach/whatsapp — campaign list and lifecycle control.
 *
 * The workflow the spec requires: draft -> prepare -> ready -> approve &
 * run -> pause/resume -> completed. Preparation is where the eligibility
 * gate, template selection and rendering happen, and it is deliberately a
 * separate, explicit step from sending.
 */
export function PlatformOutreachCampaignsPage() {
  const role = usePlatformRole()
  const canManage = WRITE_ROLES.has(role)
  const { toast } = useToast()

  const campaignsQuery = useOutreachCampaigns()
  const accountsQuery = useWhatsAppAccounts()
  const funnelQuery = useOutreachFunnelStats()

  const setStatus = useSetOutreachCampaignStatus()
  const prepare = usePrepareOutreachCampaign()
  const enqueueSend = useEnqueueWhatsAppSend()

  /** Aggregate the per-slice funnel view down to one row per campaign. */
  const totalsByCampaign = useMemo(() => {
    const totals = new Map<string, { recipients: number; blocked: number; sent: number; replied: number; positive: number; activated: number }>()
    for (const row of funnelQuery.data ?? []) {
      const existing = totals.get(row.campaignId) ?? { recipients: 0, blocked: 0, sent: 0, replied: 0, positive: 0, activated: 0 }
      totals.set(row.campaignId, {
        recipients: existing.recipients + row.recipients,
        blocked: existing.blocked + row.blocked,
        sent: existing.sent + row.sent,
        replied: existing.replied + row.replied,
        positive: existing.positive + row.positiveReply,
        activated: existing.activated + row.activated,
      })
    }
    return totals
  }, [funnelQuery.data])

  const liveAccounts = useMemo(
    () => (accountsQuery.data ?? []).filter((account) => account.providerMode === 'live' && account.isActive),
    [accountsQuery.data],
  )

  async function runAction(label: string, action: () => Promise<unknown>) {
    try {
      await action()
      toast({ title: label, variant: 'success' })
    } catch (error) {
      toast({ title: "Couldn't complete the action", description: getErrorMessage(error), variant: 'error' })
    }
  }

  if (campaignsQuery.isPending) {
    return <Skeleton className="h-96 w-full" />
  }

  if (campaignsQuery.isError) {
    return <ErrorState title="Couldn't load campaigns" description={campaignsQuery.error?.message} />
  }

  return (
    <div className="flex flex-col gap-6">
      {liveAccounts.length === 0 ? (
        <Alert variant="info">
          <p className="text-sm">
            No WhatsApp account is in <strong>live</strong> mode. Campaigns will run through the mock provider: the full
            pipeline executes, recipients advance through the funnel, and message ids are prefixed{' '}
            <code className="font-mono text-xs">wamid.MOCK.</code> — but nothing is sent to any real number.
          </p>
        </Alert>
      ) : (
        <Alert variant="warning">
          <p className="text-sm">
            {liveAccounts.length} WhatsApp account{liveAccounts.length === 1 ? ' is' : 's are'} in <strong>live</strong>{' '}
            mode. Running a campaign will send real messages to real businesses.
          </p>
        </Alert>
      )}

      {campaignsQuery.data.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="Select prospects from the Prospects screen and create a campaign to get started."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Campaigns</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table label="Outreach campaigns">
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Recipients</TableHead>
                  <TableHead className="text-right">Blocked</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Replied</TableHead>
                  <TableHead className="text-right">Positive</TableHead>
                  <TableHead className="text-right">Activated</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaignsQuery.data.map((campaign) => {
                  const totals = totalsByCampaign.get(campaign.id)
                  return (
                    <TableRow key={campaign.id}>
                      <TableCell>
                        <Link
                          to={`/platform/outreach/whatsapp/${campaign.id}`}
                          className="font-medium text-ink-950 underline-offset-2 hover:underline"
                        >
                          {campaign.name}
                        </Link>
                        <p className="mt-0.5 text-xs text-ink-500">
                          {new Date(campaign.createdAt).toLocaleDateString()} · max {campaign.maxSendsPerHour}/h
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[campaign.status]}>{campaign.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{totals?.recipients ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {totals?.blocked ? <span className="text-warning-700">{totals.blocked}</span> : 0}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{totals?.sent ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{totals?.replied ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{totals?.positive ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{totals?.activated ?? 0}</TableCell>
                      <TableCell>
                        {canManage ? (
                          <CampaignActions
                            campaign={campaign}
                            onPrepare={() => runAction('Preparation queued', () => prepare.mutateAsync(campaign.id))}
                            onRun={() =>
                              runAction('Campaign running', () =>
                                setStatus.mutateAsync({ campaignId: campaign.id, status: 'running' }),
                              )
                            }
                            onPause={() =>
                              runAction('Campaign paused', () =>
                                setStatus.mutateAsync({ campaignId: campaign.id, status: 'paused' }),
                              )
                            }
                            onCancel={() =>
                              runAction('Campaign cancelled', () =>
                                setStatus.mutateAsync({ campaignId: campaign.id, status: 'cancelled' }),
                              )
                            }
                            onSend={() => runAction('Send batch queued', () => enqueueSend.mutateAsync(campaign.id))}
                          />
                        ) : (
                          <span className="text-xs text-ink-400">read only</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function CampaignActions({
  campaign,
  onPrepare,
  onRun,
  onPause,
  onCancel,
  onSend,
}: {
  campaign: OutreachCampaign
  onPrepare: () => void
  onRun: () => void
  onPause: () => void
  onCancel: () => void
  onSend: () => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {['draft', 'ready', 'paused'].includes(campaign.status) ? (
        <Button size="sm" variant="secondary" onClick={onPrepare}>
          Prepare
        </Button>
      ) : null}

      {campaign.status === 'ready' || campaign.status === 'paused' ? (
        <Button size="sm" onClick={onRun}>
          {campaign.status === 'paused' ? 'Resume' : 'Approve & run'}
        </Button>
      ) : null}

      {campaign.status === 'running' ? (
        <>
          <Button size="sm" variant="secondary" onClick={onSend}>
            Send batch
          </Button>
          <Button size="sm" variant="ghost" onClick={onPause}>
            Pause
          </Button>
        </>
      ) : null}

      {!['completed', 'cancelled'].includes(campaign.status) ? (
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      ) : null}
    </div>
  )
}
