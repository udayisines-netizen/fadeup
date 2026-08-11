import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { PIPELINE_STAGE_LABELS, PROSPECT_TYPE_LABELS } from '@/components/acquisition/labels'
import type {
  ProspectJobSourceStatus,
  ProspectJobStatus,
  ProspectPipelineStage,
  ProspectScoreBucket,
  ProspectType,
} from '@/lib/queries/acquisition/types'

/** Small shared status pills for the Acquisition section — kept in one place so every page (Prospects, Jobs, Pipeline, Prospect 360, ...) renders the same enum consistently. */

const JOB_STATUS_LABELS: Record<ProspectJobStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  retry: 'Retry pending',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const JOB_STATUS_VARIANTS: Record<ProspectJobStatus, BadgeVariant> = {
  queued: 'neutral',
  running: 'info',
  retry: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
}

export function JobStatusBadge({ status }: { status: ProspectJobStatus }) {
  return <Badge variant={JOB_STATUS_VARIANTS[status]}>{JOB_STATUS_LABELS[status]}</Badge>
}

const JOB_SOURCE_STATUS_LABELS: Record<ProspectJobSourceStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  skipped: 'Skipped',
}

const JOB_SOURCE_STATUS_VARIANTS: Record<ProspectJobSourceStatus, BadgeVariant> = {
  pending: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'danger',
  skipped: 'neutral',
}

export function JobSourceStatusBadge({ status }: { status: ProspectJobSourceStatus }) {
  return <Badge variant={JOB_SOURCE_STATUS_VARIANTS[status]}>{JOB_SOURCE_STATUS_LABELS[status]}</Badge>
}

const SCORE_BUCKET_VARIANTS: Record<ProspectScoreBucket, BadgeVariant> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  HOT: 'danger',
}

export function ScoreBucketBadge({ bucket }: { bucket: ProspectScoreBucket | null }) {
  if (!bucket) return <Badge variant="neutral">Unscored</Badge>
  return <Badge variant={SCORE_BUCKET_VARIANTS[bucket]}>{bucket}</Badge>
}

const PIPELINE_STAGE_VARIANTS: Record<ProspectPipelineStage, BadgeVariant> = {
  discovered: 'neutral',
  enriched: 'neutral',
  qualified: 'info',
  selected: 'info',
  contacted: 'warning',
  replied: 'warning',
  demo: 'accent',
  trial: 'accent',
  customer: 'success',
  lost: 'danger',
}

export function PipelineStageBadge({ stage }: { stage: ProspectPipelineStage }) {
  return <Badge variant={PIPELINE_STAGE_VARIANTS[stage]}>{PIPELINE_STAGE_LABELS[stage]}</Badge>
}

export function ProspectTypeBadge({ type }: { type: ProspectType }) {
  return <Badge variant="neutral">{PROSPECT_TYPE_LABELS[type]}</Badge>
}
