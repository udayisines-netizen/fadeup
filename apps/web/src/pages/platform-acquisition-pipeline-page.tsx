import { Link } from 'react-router-dom'
import { useProspectStageCounts } from '@/lib/queries/acquisition/overview'
import { pipelineStageLabel } from '@/components/acquisition/labels'
import { Card } from '@/components/ui/card'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PROSPECT_PIPELINE_STAGES } from '@/lib/queries/acquisition/types'

/** /platform/acquisition/pipeline — prospect count per sales pipeline stage. A clean stage-count view, not a drag-and-drop kanban (V1 scope). */
export function PlatformAcquisitionPipelinePage() {
  const stageCountsQuery = useProspectStageCounts()

  if (stageCountsQuery.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        {PROSPECT_PIPELINE_STAGES.map((stage) => (
          <Skeleton key={stage} className="h-14 w-full" />
        ))}
      </div>
    )
  }

  if (stageCountsQuery.isError) {
    return <ErrorState title="Couldn't load pipeline stages" description={stageCountsQuery.error.message} />
  }

  const counts = stageCountsQuery.data
  const maxCount = Math.max(1, ...PROSPECT_PIPELINE_STAGES.map((stage) => counts[stage]))

  return (
    <div className="flex flex-col gap-3">
      {PROSPECT_PIPELINE_STAGES.map((stage) => {
        const count = counts[stage]
        const widthPercent = Math.round((count / maxCount) * 100)
        return (
          <Link
            key={stage}
            to={`/platform/acquisition/prospects?status=${stage}`}
            className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
          >
            <Card className="p-4 transition-colors hover:bg-paper-50">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-ink-950">{pipelineStageLabel(stage)}</span>
                <span className="text-sm font-semibold text-ink-950">{count}</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-paper-100">
                <div className="h-full rounded-full bg-accent-600" style={{ width: `${count === 0 ? 0 : Math.max(widthPercent, 4)}%` }} />
              </div>
            </Card>
          </Link>
        )
      })}
    </div>
  )
}
