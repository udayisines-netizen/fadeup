import { useMemo } from 'react'
import {
  useExperimentResults,
  useOutreachExperiments,
  useSetExperimentStatus,
  type ExperimentResultRow,
} from '@/lib/queries/acquisition/data-science'
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

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: 'neutral',
  running: 'success',
  paused: 'warning',
  completed: 'neutral',
  abandoned: 'neutral',
}

/**
 * /platform/outreach/experiments — A/B experiment control and results.
 *
 * The `reached_min_sample` column is the guard that matters: it stops a
 * winner being declared on four sends. An arm that has not reached its
 * minimum sample is shown greyed with an explicit note rather than with a
 * tempting-looking conversion rate.
 */
export function PlatformDataScienceExperimentsPage() {
  const role = usePlatformRole()
  const canManage = WRITE_ROLES.has(role)
  const { toast } = useToast()

  const experimentsQuery = useOutreachExperiments()
  const resultsQuery = useExperimentResults()
  const setStatus = useSetExperimentStatus()

  const armsByExperiment = useMemo(() => {
    const map = new Map<string, ExperimentResultRow[]>()
    for (const row of resultsQuery.data ?? []) {
      const existing = map.get(row.experimentId) ?? []
      existing.push(row)
      map.set(row.experimentId, existing)
    }
    for (const arms of map.values()) {
      arms.sort((a, b) => (a.isControl === b.isControl ? a.armKey.localeCompare(b.armKey) : a.isControl ? -1 : 1))
    }
    return map
  }, [resultsQuery.data])

  async function handleStatus(experimentId: string, status: 'running' | 'paused' | 'completed') {
    try {
      await setStatus.mutateAsync({ experimentId, status })
      toast({ title: `Experiment ${status}`, variant: 'success' })
    } catch (error) {
      toast({ title: "Couldn't update experiment", description: getErrorMessage(error), variant: 'error' })
    }
  }

  if (experimentsQuery.isPending) {
    return <Skeleton className="h-96 w-full" />
  }

  if (experimentsQuery.isError) {
    return <ErrorState title="Couldn't load experiments" description={experimentsQuery.error?.message} />
  }

  return (
    <div className="flex flex-col gap-6">
      <Alert variant="info">
        <p className="text-sm">
          Arm assignment is a deterministic hash of the experiment seed and the prospect id, so it is reproducible and
          auditable. A prospect is assigned to an arm once and never re-randomised, and cannot be enrolled in more
          simultaneous experiments than the experiment allows. Eligibility and locale rules always override an
          experiment.
        </p>
      </Alert>

      {experimentsQuery.data.length === 0 ? (
        <EmptyState
          title="No experiments defined"
          description="Controlled A/B testing is the right step before supervised ML — it is how the labelled outcomes a model needs get created."
        />
      ) : (
        experimentsQuery.data.map((experiment) => {
          const arms = armsByExperiment.get(experiment.id) ?? []
          return (
            <Card key={experiment.id}>
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-base">{experiment.name}</CardTitle>
                  <p className="mt-1 font-mono text-xs text-ink-500">{experiment.key}</p>
                  {experiment.hypothesis ? (
                    <p className="mt-1 max-w-2xl text-sm text-ink-700">{experiment.hypothesis}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-ink-500">
                    Optimising <strong>{experiment.primaryMetric}</strong> · {experiment.explorationPct}% exploration ·
                    min {experiment.minSamplePerArm} per arm
                    {experiment.cohortLocale ? ` · ${experiment.cohortLocale}` : ''}
                    {experiment.cohortSegmentKey ? ` · ${experiment.cohortSegmentKey}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANT[experiment.status] ?? 'neutral'}>{experiment.status}</Badge>
                  {canManage ? (
                    <div className="flex gap-2">
                      {experiment.status === 'draft' || experiment.status === 'paused' ? (
                        <Button size="sm" onClick={() => void handleStatus(experiment.id, 'running')}>
                          {experiment.status === 'paused' ? 'Resume' : 'Start'}
                        </Button>
                      ) : null}
                      {experiment.status === 'running' ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => void handleStatus(experiment.id, 'paused')}>
                            Pause
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleStatus(experiment.id, 'completed')}
                          >
                            Complete
                          </Button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {arms.length === 0 ? (
                  <div className="p-6">
                    <EmptyState title="No arms configured" description="An experiment needs at least two arms." />
                  </div>
                ) : (
                  <Table label={`Arms for ${experiment.key}`}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Arm</TableHead>
                        <TableHead>Template</TableHead>
                        <TableHead className="text-right">Assigned</TableHead>
                        <TableHead className="text-right">Sent</TableHead>
                        <TableHead className="text-right">Replied</TableHead>
                        <TableHead className="text-right">Positive</TableHead>
                        <TableHead className="text-right">Activated</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead>Readable?</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {arms.map((arm) => (
                        <TableRow key={arm.armId}>
                          <TableCell>
                            <span className="font-mono text-xs text-ink-950">{arm.armKey}</span>
                            {arm.isControl ? (
                              <Badge variant="neutral" className="ml-2">
                                control
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{arm.templateKey}</TableCell>
                          <TableCell className="text-right tabular-nums">{arm.assigned}</TableCell>
                          <TableCell className="text-right tabular-nums">{arm.sent}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            <ArmRate value={arm.replied} sent={arm.sent} readable={arm.reachedMinSample} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <ArmRate value={arm.positiveReply} sent={arm.sent} readable={arm.reachedMinSample} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <ArmRate value={arm.activated} sent={arm.sent} readable={arm.reachedMinSample} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <ArmRate value={arm.paid} sent={arm.sent} readable={arm.reachedMinSample} />
                          </TableCell>
                          <TableCell>
                            {arm.reachedMinSample ? (
                              <Badge variant="success">yes</Badge>
                            ) : (
                              <span className="text-xs text-ink-500">
                                needs {Math.max(0, arm.minSamplePerArm - arm.sent)} more
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}

/**
 * A rate is only rendered once the arm has enough sends to mean anything.
 * Below the minimum, the raw count is shown greyed and no percentage is
 * offered — a 100% conversion on 2 sends is not a result.
 */
function ArmRate({ value, sent, readable }: { value: number; sent: number; readable: boolean }) {
  if (sent === 0) return <span className="text-ink-500">—</span>
  if (!readable) return <span className="text-ink-500">{value}</span>
  return (
    <span>
      {value}
      <span className="ml-1 text-xs text-ink-500">({((value / sent) * 100).toFixed(1)}%)</span>
    </span>
  )
}
