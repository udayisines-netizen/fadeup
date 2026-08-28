import { useMemo, useState } from 'react'
import {
  useApiSourceHealth,
  useApiSourceLimits,
  useProspectSources,
  useSetProspectSourceEnabled,
  useSetProspectSourcePaused,
  type ApiSourceHealth,
  type ApiSourceLimits,
  type ProspectSource,
} from '@/lib/queries/acquisition/sources'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import { usePlatformRole } from '@/routes/require-platform-role'
import type { ProspectSourceKey } from '@/lib/queries/acquisition/types'

const WRITE_ROLES = new Set(['platform_owner', 'platform_admin'])

/** /platform/acquisition/sources — the 6 discovery/enrichment adapters: enable toggle, rolling health, configured budgets, manual pause. */
export function PlatformAcquisitionSourcesPage() {
  const role = usePlatformRole()
  const canManage = WRITE_ROLES.has(role)

  const sourcesQuery = useProspectSources()
  const healthQuery = useApiSourceHealth()
  const limitsQuery = useApiSourceLimits()

  const healthBySourceId = useMemo(() => {
    const map = new Map<string, ApiSourceHealth>()
    for (const row of healthQuery.data ?? []) map.set(row.sourceId, row)
    return map
  }, [healthQuery.data])

  const limitsBySourceId = useMemo(() => {
    const map = new Map<string, ApiSourceLimits>()
    for (const row of limitsQuery.data ?? []) map.set(row.sourceId, row)
    return map
  }, [limitsQuery.data])

  const isLoading = sourcesQuery.isPending || healthQuery.isPending || limitsQuery.isPending
  const loadError = sourcesQuery.error ?? healthQuery.error ?? limitsQuery.error
  const isError = sourcesQuery.isError || healthQuery.isError || limitsQuery.isError

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-hidden="true">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (isError) {
    return <ErrorState title="Couldn't load sources" description={loadError?.message} />
  }

  if (sourcesQuery.data.length === 0) {
    return <EmptyState title="No sources configured" />
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {sourcesQuery.data.map((source) => (
        <SourceCard
          key={source.id}
          source={source}
          health={healthBySourceId.get(source.id)}
          limits={limitsBySourceId.get(source.id)}
          canManage={canManage}
        />
      ))}
    </div>
  )
}

function SourceCard({
  source,
  health,
  limits,
  canManage,
}: {
  source: ProspectSource
  health: ApiSourceHealth | undefined
  limits: ApiSourceLimits | undefined
  canManage: boolean
}) {
  const { toast } = useToast()
  const setEnabled = useSetProspectSourceEnabled()
  const setPaused = useSetProspectSourcePaused()
  const [isPauseDialogOpen, setIsPauseDialogOpen] = useState(false)

  async function handleToggleEnabled(enabled: boolean) {
    try {
      await setEnabled.mutateAsync({ key: source.key, enabled })
      toast({ title: enabled ? `${source.displayName} enabled` : `${source.displayName} disabled`, variant: 'success' })
    } catch (error) {
      toast({ title: "Couldn't update source", description: getErrorMessage(error), variant: 'error' })
    }
  }

  async function handleResume() {
    try {
      await setPaused.mutateAsync({ key: source.key, paused: false })
      toast({ title: `${source.displayName} resumed`, variant: 'success' })
    } catch (error) {
      toast({ title: "Couldn't resume source", description: getErrorMessage(error), variant: 'error' })
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{source.displayName}</CardTitle>
          <p className="mt-0.5 font-mono text-xs text-ink-500">{source.key}</p>
        </div>
        <Switch
          label={`Enable ${source.displayName}`}
          hideLabel
          checked={source.isEnabled}
          disabled={!canManage || setEnabled.isPending}
          onChange={(event) => void handleToggleEnabled(event.target.checked)}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {health?.isPaused ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning-100 bg-warning-100/40 px-3 py-2">
            <div>
              <Badge variant="warning">Paused</Badge>
              {health.pausedReason ? <p className="mt-1 text-xs text-ink-500">{health.pausedReason}</p> : null}
            </div>
            {canManage ? (
              <Button variant="secondary" size="sm" isLoading={setPaused.isPending} onClick={() => void handleResume()}>
                Resume
              </Button>
            ) : null}
          </div>
        ) : canManage ? (
          <Button variant="secondary" size="sm" className="self-start" onClick={() => setIsPauseDialogOpen(true)}>
            Pause source
          </Button>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <Metric label="Requests today" value={health?.requestsToday ?? 0} />
          <Metric label="Requests this month" value={health?.requestsThisMonth ?? 0} />
          <Metric label="Rate limited" value={health?.rateLimitedCount ?? 0} />
          <Metric label="Succeeded" value={health?.successCount ?? 0} />
          <Metric label="Failed" value={health?.failureCount ?? 0} />
          <Metric label="Avg latency" value={health?.avgLatencyMs != null ? `${Math.round(health.avgLatencyMs)} ms` : '—'} />
        </dl>

        <div className="border-t border-border pt-3 text-xs text-ink-500">
          <p className="font-medium text-ink-700">Configured budget</p>
          <p className="mt-1">
            {limits?.maxRequestsPerMinute ?? '—'}/min · {limits?.maxRequestsPerDay ?? '—'}/day · {limits?.maxRequestsPerMonth ?? '—'}/month
          </p>
        </div>

        {health?.lastError ? (
          <p className="text-xs text-danger-700">Last error: {health.lastError}</p>
        ) : null}
      </CardContent>

      {isPauseDialogOpen ? (
        <PauseSourceDialog sourceKey={source.key} displayName={source.displayName} onClose={() => setIsPauseDialogOpen(false)} />
      ) : null}
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-ink-500">{label}</dt>
      <dd className="font-semibold text-ink-950">{value}</dd>
    </div>
  )
}

function PauseSourceDialog({
  sourceKey,
  displayName,
  onClose,
}: {
  sourceKey: ProspectSourceKey
  displayName: string
  onClose: () => void
}) {
  const { toast } = useToast()
  const setPaused = useSetProspectSourcePaused()
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  async function handlePause() {
    setFormError(null)
    try {
      await setPaused.mutateAsync({ key: sourceKey, paused: true, reason: reason.trim() || null })
      toast({ title: `${displayName} paused`, variant: 'success' })
      onClose()
    } catch (error) {
      setFormError(getErrorMessage(error) ?? 'Failed to pause source.')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pause {displayName}</DialogTitle>
          <DialogDescription>Stops the Worker from calling this source until resumed. Existing jobs may still show it as skipped.</DialogDescription>
        </DialogHeader>
        {formError ? <p className="text-sm text-danger-700">{formError}</p> : null}
        <Textarea label="Reason (optional)" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" variant="danger" isLoading={setPaused.isPending} onClick={() => void handlePause()}>
            Pause
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
