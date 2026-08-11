import type { ProspectPipelineStage, ProspectType } from '@/lib/queries/acquisition/types'

/** Plain label lookups, split out of badges.tsx (a .tsx component file) so non-component exports don't trip react/only-export-components. */

export const PIPELINE_STAGE_LABELS: Record<ProspectPipelineStage, string> = {
  discovered: 'Discovered',
  enriched: 'Enriched',
  qualified: 'Qualified',
  selected: 'Selected',
  contacted: 'Contacted',
  replied: 'Replied',
  demo: 'Demo',
  trial: 'Trial',
  customer: 'Customer',
  lost: 'Lost',
}

export function pipelineStageLabel(stage: ProspectPipelineStage): string {
  return PIPELINE_STAGE_LABELS[stage]
}

export const PROSPECT_TYPE_LABELS: Record<ProspectType, string> = {
  barbershop: 'Barbershop',
  independent_barber: 'Independent barber',
}

export function prospectTypeLabel(type: ProspectType): string {
  return PROSPECT_TYPE_LABELS[type]
}
