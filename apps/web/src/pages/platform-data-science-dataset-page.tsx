import { useMemo } from 'react'
import {
  useMlDatasets,
  useMlPredictions,
  useProspectScoreDistribution,
} from '@/lib/queries/acquisition/data-science'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Link } from 'react-router-dom'

/**
 * /platform/data-science/dataset — dataset health, score distributions and
 * the prediction audit trail.
 *
 * The score-distribution card is the one that catches the failure mode
 * spec §42 names: a score that assigns nearly everyone 85–95 is not a
 * score, it is a constant, and the operator needs to be told rather than
 * left to infer it from a list.
 */
export function PlatformDataScienceDatasetPage() {
  const datasetsQuery = useMlDatasets()
  const distributionQuery = useProspectScoreDistribution()
  const predictionsQuery = useMlPredictions(50)

  const latestDataset = datasetsQuery.data?.[0] ?? null

  /** Features with the worst coverage — where the dataset is thinnest. */
  const worstCoverage = useMemo(() => {
    if (!latestDataset) return []
    return Object.entries(latestDataset.featureCoverage)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 12)
  }, [latestDataset])

  if (datasetsQuery.isPending || distributionQuery.isPending) {
    return <Skeleton className="h-96 w-full" />
  }

  if (datasetsQuery.isError || distributionQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load data science metrics"
        description={(datasetsQuery.error ?? distributionQuery.error)?.message}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Score health</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {distributionQuery.data.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No scored prospects yet" description="Scores appear once feature computation runs." />
            </div>
          ) : (
            <Table label="Score distribution">
              <TableHeader>
                <TableRow>
                  <TableHead>Score</TableHead>
                  <TableHead className="text-right">Scored</TableHead>
                  <TableHead className="text-right">Mean</TableHead>
                  <TableHead className="text-right">Median</TableHead>
                  <TableHead className="text-right">Std dev</TableHead>
                  <TableHead className="text-right">p10 / p90</TableHead>
                  <TableHead className="text-right">HOT / WARM / COLD</TableHead>
                  <TableHead>Health</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {distributionQuery.data.map((row) => {
                  const total = row.hotCount + row.warmCount + row.coldCount
                  return (
                    <TableRow key={row.scoreKind}>
                      <TableCell className="font-mono text-xs">{row.scoreKind}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.scored}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.meanScore ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.medianScore ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.stddevScore ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {row.p10 ?? '—'} / {row.p90 ?? '—'}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {row.hotCount} / {row.warmCount} / {row.coldCount}
                        {total > 0 ? (
                          <div className="text-ink-500">
                            {((row.hotCount / total) * 100).toFixed(0)}% HOT
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {row.lowDiscriminationWarning ? (
                          <Badge variant="warning">not discriminative</Badge>
                        ) : (
                          <Badge variant="success">healthy spread</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {distributionQuery.data.some((row) => row.lowDiscriminationWarning) ? (
        <Alert variant="warning">
          <p className="text-sm">
            A score’s standard deviation has collapsed below 5 points across a meaningful sample. When almost every
            prospect receives the same score, the score is no longer ranking anything — review the ruleset weights
            before running more campaigns off it.
          </p>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Training dataset</CardTitle>
        </CardHeader>
        <CardContent>
          {!latestDataset ? (
            <EmptyState
              title="No dataset built yet"
              description="Datasets are built from sent messages with recorded outcomes. Until outreach has run, there is nothing to learn from."
            />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Version" value={latestDataset.version} mono />
                <Stat label="Rows" value={latestDataset.rowCount.toLocaleString()} />
                <Stat label="Positive labels" value={latestDataset.positiveCount.toLocaleString()} />
                <Stat label="Negative labels" value={latestDataset.negativeCount.toLocaleString()} />
              </div>

              <div>
                <p className="text-sm font-medium text-ink-950">Lowest feature coverage</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  Coverage is the share of rows where the feature was actually observed. A low number is not a bug — it
                  means enrichment has not reached those prospects, and the value is UNKNOWN rather than fabricated.
                </p>
                <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {worstCoverage.map(([feature, coverage]) => (
                    <li key={feature} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate font-mono text-ink-700">{feature}</span>
                      <span className="tabular-nums text-ink-950">{(coverage * 100).toFixed(0)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent predictions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {predictionsQuery.isPending ? (
            <div className="p-4">
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (predictionsQuery.data?.length ?? 0) === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No predictions recorded"
                description="Predictions are written during campaign preparation when a model is promoted."
              />
            </div>
          ) : (
            <Table label="Recent ML predictions">
              <TableHeader>
                <TableRow>
                  <TableHead>Prospect</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">P(target)</TableHead>
                  <TableHead>Selected</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {predictionsQuery.data!.map((prediction) => (
                  <TableRow key={prediction.id}>
                    <TableCell>
                      <Link
                        to={`/platform/acquisition/prospects/${prediction.prospectId}`}
                        className="text-ink-950 underline-offset-2 hover:underline"
                      >
                        {prediction.prospectName ?? prediction.prospectId.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{prediction.templateKey ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {prediction.isFallback ? (
                        <Badge variant="neutral">rules fallback</Badge>
                      ) : (
                        (prediction.modelVersion ?? '—')
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {prediction.predictedProbability.toFixed(4)}
                    </TableCell>
                    <TableCell>{prediction.selected ? <Badge variant="accent">selected</Badge> : null}</TableCell>
                    <TableCell className="text-xs text-ink-500">
                      {new Date(prediction.predictedAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-ink-500">{label}</p>
      <p className={`mt-0.5 text-sm text-ink-950 ${mono ? 'font-mono' : 'font-medium'}`}>{value}</p>
    </div>
  )
}
