import { useMemo, useState } from 'react'
import {
  useMlModelVersions,
  useMlTrainingRuns,
  usePromoteMlModel,
  useRetireMlModel,
  type MlModelVersion,
} from '@/lib/queries/acquisition/data-science'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import { usePlatformRole } from '@/routes/require-platform-role'

const WRITE_ROLES = new Set(['platform_owner', 'platform_admin'])

/** Metrics worth showing. Accuracy is absent on purpose — at a single-digit reply rate it is actively misleading. */
const HEADLINE_METRICS = ['pr_auc', 'roc_auc', 'lift_at_10pct', 'brier_score', 'log_loss', 'base_rate']

/**
 * /platform/data-science/models — the model registry and the promotion
 * control.
 *
 * Two things this screen is built to make impossible to miss:
 *   1. What is ACTUALLY deciding template selection right now (very often:
 *      the deterministic rules, which is the correct Phase 0 answer).
 *   2. That promoting a model is a deliberate, documented act — the dialog
 *      will not submit without an evaluation note.
 */
export function PlatformDataScienceModelsPage() {
  const role = usePlatformRole()
  const canManage = WRITE_ROLES.has(role)
  const { toast } = useToast()

  const modelsQuery = useMlModelVersions()
  const runsQuery = useMlTrainingRuns()
  const promote = usePromoteMlModel()
  const retire = useRetireMlModel()

  const [promoting, setPromoting] = useState<MlModelVersion | null>(null)
  const [evaluationNotes, setEvaluationNotes] = useState('')

  const activeModel = useMemo(
    () => (modelsQuery.data ?? []).find((model) => model.isActive && model.modelType !== 'rule_baseline') ?? null,
    [modelsQuery.data],
  )

  const latestRun = runsQuery.data?.[0] ?? null

  async function handlePromote() {
    if (!promoting || evaluationNotes.trim().length === 0) return
    try {
      await promote.mutateAsync({ modelVersionId: promoting.id, evaluationNotes: evaluationNotes.trim() })
      toast({ title: `${promoting.modelVersion} promoted`, variant: 'success' })
      setPromoting(null)
      setEvaluationNotes('')
    } catch (error) {
      toast({ title: "Couldn't promote model", description: getErrorMessage(error), variant: 'error' })
    }
  }

  async function handleRetire(model: MlModelVersion) {
    try {
      await retire.mutateAsync(model.id)
      toast({ title: `${model.modelVersion} retired — selection falls back to rules`, variant: 'success' })
    } catch (error) {
      toast({ title: "Couldn't retire model", description: getErrorMessage(error), variant: 'error' })
    }
  }

  if (modelsQuery.isPending) {
    return <Skeleton className="h-96 w-full" />
  }

  if (modelsQuery.isError) {
    return <ErrorState title="Couldn't load the model registry" description={modelsQuery.error?.message} />
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>What is selecting templates right now</CardTitle>
        </CardHeader>
        <CardContent>
          {activeModel ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="success">ML active</Badge>
                <span className="font-mono text-sm text-ink-950">
                  {activeModel.modelKey}:{activeModel.modelVersion}
                </span>
              </div>
              <p className="text-sm text-ink-600">
                Predicting <strong>{activeModel.target}</strong>, feature schema {activeModel.featureSchemaVersion}.
                Promoted {activeModel.promotedAt ? new Date(activeModel.promotedAt).toLocaleString() : 'unknown'}.
              </p>
              <p className="text-xs text-ink-500">
                If inference fails or the artifact cannot be loaded, selection falls back to the deterministic rules
                automatically. Outreach never stops because of a model problem.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="accent">Deterministic rules</Badge>
              </div>
              <p className="text-sm text-ink-600">
                No model is promoted. Template selection uses the deterministic rule ranking: locale match, then
                competitor targeting, then segment targeting, then sales-angle priority.
              </p>
              <p className="text-xs text-ink-500">
                This is the correct state until enough labelled outcomes exist. Training will refuse to fit a model
                before then rather than produce a meaningless one.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {latestRun ? (
        <Alert variant={latestRun.status === 'skipped_insufficient_data' ? 'info' : 'success'}>
          <div className="text-sm">
            <p>
              <strong>Latest training run:</strong> {latestRun.status.replace(/_/g, ' ')}
              {latestRun.finishedAt ? ` · ${new Date(latestRun.finishedAt).toLocaleString()}` : ''}
            </p>
            {latestRun.skipReason ? <p className="mt-1">{latestRun.skipReason}</p> : null}
            {latestRun.leakageCheckPassed === true ? (
              <p className="mt-1 text-xs">Data-leakage check passed: no post-outcome feature reached the matrix.</p>
            ) : null}
          </div>
        </Alert>
      ) : null}

      {modelsQuery.data.length === 0 ? (
        <EmptyState title="No models registered" description="Run the training pipeline to register a model version." />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Model registry</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table label="ML model registry">
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Dataset</TableHead>
                  <TableHead>Validation metrics</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modelsQuery.data.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell>
                      <span className="font-mono text-xs text-ink-950">
                        {model.modelKey}:{model.modelVersion}
                      </span>
                      <p className="mt-0.5 text-xs text-ink-500">{new Date(model.createdAt).toLocaleDateString()}</p>
                    </TableCell>
                    <TableCell className="text-xs">{model.modelType.replace(/_/g, ' ')}</TableCell>
                    <TableCell className="text-xs">{model.target}</TableCell>
                    <TableCell className="font-mono text-xs">{model.trainingDatasetVersion ?? '—'}</TableCell>
                    <TableCell>
                      <MetricList metrics={model.metrics} />
                    </TableCell>
                    <TableCell>
                      {model.isActive ? (
                        <Badge variant="success">active</Badge>
                      ) : model.retiredAt ? (
                        <Badge variant="neutral">retired</Badge>
                      ) : (
                        <Badge variant="neutral">registered</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {canManage && model.modelType !== 'rule_baseline' ? (
                        model.isActive ? (
                          <Button size="sm" variant="ghost" onClick={() => void handleRetire(model)}>
                            Retire
                          </Button>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => setPromoting(model)}>
                            Promote
                          </Button>
                        )
                      ) : (
                        <span className="text-xs text-ink-400">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={promoting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPromoting(null)
            setEvaluationNotes('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promote {promoting?.modelVersion}</DialogTitle>
            <DialogDescription>
              Promotion is a deliberate decision, recorded against your account. Write down what you evaluated and why
              this model should replace what is currently selecting templates.
            </DialogDescription>
          </DialogHeader>

          {promoting ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-md bg-paper-100 p-3">
                <p className="text-xs font-medium text-ink-700">Validation metrics</p>
                <MetricList metrics={promoting.metrics} />
              </div>

              <Textarea
                label="Evaluation notes"
                value={evaluationNotes}
                onChange={(event) => setEvaluationNotes(event.target.value)}
                rows={4}
                placeholder="PR-AUC 0.21 vs 0.09 baseline on 1,340 sent messages; calibration MAE 0.03; lift 2.1x at the top decile."
              />
            </div>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={() => void handlePromote()} disabled={evaluationNotes.trim().length === 0}>
              Promote model
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MetricList({ metrics }: { metrics: Record<string, number> }) {
  const entries = HEADLINE_METRICS.filter((key) => typeof metrics[key] === 'number').map(
    (key) => [key, metrics[key]!] as const,
  )

  if (entries.length === 0) {
    return <span className="text-xs text-ink-400">no metrics recorded</span>
  }

  return (
    <dl className="flex flex-col gap-0.5">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-baseline gap-2 text-xs">
          <dt className="font-mono text-ink-500">{key}</dt>
          <dd className="tabular-nums text-ink-950">{value.toFixed(4)}</dd>
        </div>
      ))}
    </dl>
  )
}
