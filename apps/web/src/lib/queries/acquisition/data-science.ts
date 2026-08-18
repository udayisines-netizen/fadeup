import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import {
  asRow,
  asRows,
  bool,
  boolOrNull,
  embeddedStr,
  enumValue,
  jsonArray,
  jsonObject,
  num,
  numberMap,
  numOrNull,
  str,
  strOrNull,
} from './row'

/**
 * Data science: model registry, datasets, predictions, experiments and
 * score-health monitoring.
 *
 * Source of truth: db/migrations/20260818100100_prospect_outreach_whatsapp_ml.sql.
 *
 * Model ARTIFACTS are deliberately not reachable from here — the registry
 * exposes metadata and metrics only, never the file itself (spec §71).
 */

export type MlModelTarget = 'reply' | 'positive_reply' | 'claim' | 'activated' | 'paid' | 'expected_value'

export const ML_MODEL_TARGETS: readonly MlModelTarget[] = [
  'reply',
  'positive_reply',
  'claim',
  'activated',
  'paid',
  'expected_value',
]

export interface MlModelVersion {
  id: string
  modelKey: string
  modelVersion: string
  modelType: 'logistic_regression' | 'gradient_boosted_trees' | 'rule_baseline'
  target: MlModelTarget
  featureSchemaVersion: string
  trainingDatasetVersion: string | null
  metrics: Record<string, number>
  hyperparameters: Record<string, unknown>
  isActive: boolean
  promotedAt: string | null
  retiredAt: string | null
  evaluationNotes: string | null
  createdAt: string
}

export function useMlModelVersions() {
  return useQuery({
    queryKey: ['acquisition', 'ml-models'],
    queryFn: async (): Promise<MlModelVersion[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('ml_model_versions')
        // artifact_path/artifact_sha256 are intentionally NOT selected:
        // a filesystem path to a model belongs nowhere near a browser.
        .select(
          'id, model_key, model_version, model_type, target, feature_schema_version, training_dataset_version, metrics, hyperparameters, is_active, promoted_at, retired_at, evaluation_notes, created_at',
        )
        .order('created_at', { ascending: false })
      if (error) throw error
      return asRows(data).map((row) => ({
        id: str(row, 'id'),
        modelKey: str(row, 'model_key'),
        modelVersion: str(row, 'model_version'),
        modelType: enumValue(
          row,
          'model_type',
          ['logistic_regression', 'gradient_boosted_trees', 'rule_baseline'] as const,
          'rule_baseline',
        ),
        target: enumValue(row, 'target', ML_MODEL_TARGETS, 'positive_reply'),
        featureSchemaVersion: str(row, 'feature_schema_version'),
        trainingDatasetVersion: strOrNull(row, 'training_dataset_version'),
        metrics: numberMap(row, 'metrics'),
        hyperparameters: jsonObject(row, 'hyperparameters'),
        isActive: bool(row, 'is_active'),
        promotedAt: strOrNull(row, 'promoted_at'),
        retiredAt: strOrNull(row, 'retired_at'),
        evaluationNotes: strOrNull(row, 'evaluation_notes'),
        createdAt: str(row, 'created_at'),
      }))
    },
  })
}

/**
 * Explicit, documented promotion (spec §73). The RPC requires an
 * evaluation note — a model cannot become production without someone
 * writing down why.
 */
export function usePromoteMlModel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { modelVersionId: string; evaluationNotes: string }) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('promote_ml_model', {
        p_model_version_id: input.modelVersionId,
        p_evaluation_notes: input.evaluationNotes,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'ml-models'] })
    },
  })
}

/** Retires the active model — the "disable ML selection, fall back to rules" control. */
export function useRetireMlModel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (modelVersionId: string) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('retire_ml_model', { p_model_version_id: modelVersionId })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'ml-models'] })
    },
  })
}

export interface MlDataset {
  id: string
  version: string
  featureSchemaVersion: string
  target: MlModelTarget
  rowCount: number
  positiveCount: number
  negativeCount: number
  snapshotFrom: string | null
  snapshotTo: string
  featureCoverage: Record<string, number>
  labelDistribution: Record<string, number>
  createdAt: string
}

export function useMlDatasets() {
  return useQuery({
    queryKey: ['acquisition', 'ml-datasets'],
    queryFn: async (): Promise<MlDataset[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('ml_datasets')
        .select(
          'id, version, feature_schema_version, target, row_count, positive_count, negative_count, snapshot_from, snapshot_to, feature_coverage, label_distribution, created_at',
        )
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return asRows(data).map((row) => ({
        id: str(row, 'id'),
        version: str(row, 'version'),
        featureSchemaVersion: str(row, 'feature_schema_version'),
        target: enumValue(row, 'target', ML_MODEL_TARGETS, 'positive_reply'),
        rowCount: num(row, 'row_count'),
        positiveCount: num(row, 'positive_count'),
        negativeCount: num(row, 'negative_count'),
        snapshotFrom: strOrNull(row, 'snapshot_from'),
        snapshotTo: str(row, 'snapshot_to'),
        featureCoverage: numberMap(row, 'feature_coverage'),
        labelDistribution: numberMap(row, 'label_distribution'),
        createdAt: str(row, 'created_at'),
      }))
    },
  })
}

export interface MlTrainingRun {
  id: string
  datasetVersion: string | null
  status: 'running' | 'completed' | 'failed' | 'skipped_insufficient_data'
  skipReason: string | null
  trainRows: number | null
  validationRows: number | null
  validationMetrics: Record<string, number>
  baselineMetrics: Record<string, number>
  leakageCheckPassed: boolean | null
  startedAt: string
  finishedAt: string | null
  logExcerpt: string | null
}

export function useMlTrainingRuns() {
  return useQuery({
    queryKey: ['acquisition', 'ml-training-runs'],
    queryFn: async (): Promise<MlTrainingRun[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('ml_training_runs')
        .select(
          'id, dataset_version, status, skip_reason, train_rows, validation_rows, validation_metrics, baseline_metrics, leakage_check_passed, started_at, finished_at, log_excerpt',
        )
        .order('started_at', { ascending: false })
        .limit(25)
      if (error) throw error
      return asRows(data).map((row) => ({
        id: str(row, 'id'),
        datasetVersion: strOrNull(row, 'dataset_version'),
        status: enumValue(
          row,
          'status',
          ['running', 'completed', 'failed', 'skipped_insufficient_data'] as const,
          'failed',
        ),
        skipReason: strOrNull(row, 'skip_reason'),
        trainRows: numOrNull(row, 'train_rows'),
        validationRows: numOrNull(row, 'validation_rows'),
        validationMetrics: numberMap(row, 'validation_metrics'),
        baselineMetrics: numberMap(row, 'baseline_metrics'),
        leakageCheckPassed: boolOrNull(row, 'leakage_check_passed'),
        startedAt: str(row, 'started_at'),
        finishedAt: strOrNull(row, 'finished_at'),
        logExcerpt: strOrNull(row, 'log_excerpt'),
      }))
    },
  })
}

export interface MlPrediction {
  id: string
  prospectId: string
  prospectName: string | null
  templateKey: string | null
  modelVersion: string | null
  isFallback: boolean
  target: MlModelTarget
  predictedProbability: number
  selected: boolean
  predictedAt: string
}

/** Recent predictions — append-only, so this is a genuine audit trail, not a current-state view. */
export function useMlPredictions(limit = 100) {
  return useQuery({
    queryKey: ['acquisition', 'ml-predictions', limit],
    queryFn: async (): Promise<MlPrediction[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('ml_predictions')
        .select(
          'id, prospect_id, target, predicted_probability, selected, is_fallback, predicted_at, prospects(canonical_name), outreach_templates(key), ml_model_versions(model_version)',
        )
        .order('predicted_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return asRows(data).map((row) => ({
        id: str(row, 'id'),
        prospectId: str(row, 'prospect_id'),
        prospectName: embeddedStr(row, 'prospects', 'canonical_name'),
        templateKey: embeddedStr(row, 'outreach_templates', 'key'),
        modelVersion: embeddedStr(row, 'ml_model_versions', 'model_version'),
        isFallback: bool(row, 'is_fallback'),
        target: enumValue(row, 'target', ML_MODEL_TARGETS, 'positive_reply'),
        predictedProbability: num(row, 'predicted_probability'),
        selected: bool(row, 'selected'),
        predictedAt: str(row, 'predicted_at'),
      }))
    },
  })
}

export interface ScoreDistribution {
  scoreKind: 'fadeup_fit' | 'migration_potential'
  scored: number
  meanScore: number | null
  medianScore: number | null
  stddevScore: number | null
  p10: number | null
  p25: number | null
  p75: number | null
  p90: number | null
  hotCount: number
  warmCount: number
  coldCount: number
  /** True when a score has stopped discriminating between prospects (spec §42). */
  lowDiscriminationWarning: boolean
}

export function useProspectScoreDistribution() {
  return useQuery({
    queryKey: ['acquisition', 'score-distribution'],
    queryFn: async (): Promise<ScoreDistribution[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('prospect_score_distribution').select('*')
      if (error) throw error
      return asRows(data).map((row) => ({
        scoreKind: enumValue(row, 'score_kind', ['fadeup_fit', 'migration_potential'] as const, 'fadeup_fit'),
        scored: num(row, 'scored'),
        meanScore: numOrNull(row, 'mean_score'),
        medianScore: numOrNull(row, 'median_score'),
        stddevScore: numOrNull(row, 'stddev_score'),
        p10: numOrNull(row, 'p10'),
        p25: numOrNull(row, 'p25'),
        p75: numOrNull(row, 'p75'),
        p90: numOrNull(row, 'p90'),
        hotCount: num(row, 'hot_count'),
        warmCount: num(row, 'warm_count'),
        coldCount: num(row, 'cold_count'),
        lowDiscriminationWarning: bool(row, 'low_discrimination_warning'),
      }))
    },
  })
}

// ---------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------

export interface ExperimentResultRow {
  experimentId: string
  experimentKey: string
  experimentName: string
  status: string
  primaryMetric: MlModelTarget
  minSamplePerArm: number
  armId: string
  armKey: string
  isControl: boolean
  templateKey: string
  assigned: number
  sent: number
  replied: number
  positiveReply: number
  activated: number
  paid: number
  /** False means this arm does not yet have enough sends to be worth reading. */
  reachedMinSample: boolean
}

export function useExperimentResults() {
  return useQuery({
    queryKey: ['acquisition', 'experiment-results'],
    queryFn: async (): Promise<ExperimentResultRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('experiment_results').select('*')
      if (error) throw error
      return asRows(data).map((row) => ({
        experimentId: str(row, 'experiment_id'),
        experimentKey: str(row, 'experiment_key'),
        experimentName: str(row, 'experiment_name'),
        status: str(row, 'status'),
        primaryMetric: enumValue(row, 'primary_metric', ML_MODEL_TARGETS, 'positive_reply'),
        minSamplePerArm: num(row, 'min_sample_per_arm'),
        armId: str(row, 'arm_id'),
        armKey: str(row, 'arm_key'),
        isControl: bool(row, 'is_control'),
        templateKey: str(row, 'template_key'),
        assigned: num(row, 'assigned'),
        sent: num(row, 'sent'),
        replied: num(row, 'replied'),
        positiveReply: num(row, 'positive_reply'),
        activated: num(row, 'activated'),
        paid: num(row, 'paid'),
        reachedMinSample: bool(row, 'reached_min_sample'),
      }))
    },
  })
}

export interface OutreachExperiment {
  id: string
  key: string
  name: string
  hypothesis: string | null
  status: 'draft' | 'running' | 'paused' | 'completed' | 'abandoned'
  cohortLocale: string | null
  cohortSegmentKey: string | null
  cohortCountry: string | null
  explorationPct: number
  minSamplePerArm: number
  primaryMetric: MlModelTarget
  startedAt: string | null
  createdAt: string
}

export function useOutreachExperiments() {
  return useQuery({
    queryKey: ['acquisition', 'experiments'],
    queryFn: async (): Promise<OutreachExperiment[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('outreach_experiments')
        // assignment_seed is deliberately not selected: it is the input to
        // the assignment hash, and exposing it would let a reader predict
        // (or a writer manipulate) cohort membership.
        .select(
          'id, key, name, hypothesis, status, cohort_locale, cohort_segment_key, cohort_country, exploration_pct, min_sample_per_arm, primary_metric, started_at, created_at',
        )
        .order('created_at', { ascending: false })
      if (error) throw error
      return asRows(data).map((row) => ({
        id: str(row, 'id'),
        key: str(row, 'key'),
        name: str(row, 'name'),
        hypothesis: strOrNull(row, 'hypothesis'),
        status: enumValue(
          row,
          'status',
          ['draft', 'running', 'paused', 'completed', 'abandoned'] as const,
          'draft',
        ),
        cohortLocale: strOrNull(row, 'cohort_locale'),
        cohortSegmentKey: strOrNull(row, 'cohort_segment_key'),
        cohortCountry: strOrNull(row, 'cohort_country'),
        explorationPct: num(row, 'exploration_pct'),
        minSamplePerArm: num(row, 'min_sample_per_arm'),
        primaryMetric: enumValue(row, 'primary_metric', ML_MODEL_TARGETS, 'positive_reply'),
        startedAt: strOrNull(row, 'started_at'),
        createdAt: str(row, 'created_at'),
      }))
    },
  })
}

export function useSetExperimentStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { experimentId: string; status: OutreachExperiment['status'] }) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('outreach_experiments')
        .update({
          status: input.status,
          ...(input.status === 'running' ? { started_at: new Date().toISOString() } : {}),
        })
        .eq('id', input.experimentId)
        .select('id, status')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'experiments'] })
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'experiment-results'] })
    },
  })
}

// ---------------------------------------------------------------------------
// Prospect data quality + features
// ---------------------------------------------------------------------------

export interface ProspectDataQuality {
  identityCompleteness: number
  contactCompleteness: number
  digitalCompleteness: number
  sourceCount: number
  sourceAgreement: number | null
  conflictCount: number
  enrichmentSuccess: 'TRUE' | 'FALSE' | 'UNKNOWN' | 'NOT_APPLICABLE'
  dataFreshnessDays: number | null
  overallConfidence: number
  computedAt: string
}

export function useProspectDataQuality(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect', prospectId, 'data-quality'],
    enabled: Boolean(prospectId),
    queryFn: async (): Promise<ProspectDataQuality | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('prospect_data_quality')
        .select(
          'identity_completeness, contact_completeness, digital_completeness, source_count, source_agreement, conflict_count, enrichment_success, data_freshness_days, overall_confidence, computed_at',
        )
        .eq('prospect_id', prospectId!)
        .maybeSingle()
      if (error) throw error
      const row = asRow(data)
      if (!row) return null
      return {
        identityCompleteness: num(row, 'identity_completeness'),
        contactCompleteness: num(row, 'contact_completeness'),
        digitalCompleteness: num(row, 'digital_completeness'),
        sourceCount: num(row, 'source_count'),
        sourceAgreement: numOrNull(row, 'source_agreement'),
        conflictCount: num(row, 'conflict_count'),
        enrichmentSuccess: enumValue(
          row,
          'enrichment_success',
          ['TRUE', 'FALSE', 'UNKNOWN', 'NOT_APPLICABLE'] as const,
          'UNKNOWN',
        ),
        dataFreshnessDays: numOrNull(row, 'data_freshness_days'),
        overallConfidence: num(row, 'overall_confidence'),
        computedAt: str(row, 'computed_at'),
      }
    },
  })
}

export interface ProspectFeature {
  featureKey: string
  featureVersion: string
  valueBool: 'TRUE' | 'FALSE' | 'UNKNOWN' | 'NOT_APPLICABLE' | null
  valueNumeric: number | null
  valueText: string | null
  evidenceSource: string | null
  evidence: Record<string, unknown>
  confidence: number | null
  observedAt: string
}

export function useProspectFeatures(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect', prospectId, 'features'],
    enabled: Boolean(prospectId),
    queryFn: async (): Promise<ProspectFeature[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('prospect_features')
        .select('feature_key, feature_version, value_bool, value_numeric, value_text, evidence_source, evidence, confidence, observed_at')
        .eq('prospect_id', prospectId!)
        .order('feature_key')
      if (error) throw error
      return asRows(data).map((row) => ({
        featureKey: str(row, 'feature_key'),
        featureVersion: str(row, 'feature_version'),
        // Deliberately nullable rather than defaulted: a feature row with
        // no boolean value holds a numeric or text value instead, and
        // defaulting to UNKNOWN here would invent a tri-state that the
        // database never stored.
        valueBool:
          typeof row['value_bool'] === 'string'
            ? enumValue(row, 'value_bool', ['TRUE', 'FALSE', 'UNKNOWN', 'NOT_APPLICABLE'] as const, 'UNKNOWN')
            : null,
        valueNumeric: numOrNull(row, 'value_numeric'),
        valueText: strOrNull(row, 'value_text'),
        evidenceSource: strOrNull(row, 'evidence_source'),
        evidence: jsonObject(row, 'evidence'),
        confidence: numOrNull(row, 'confidence'),
        observedAt: str(row, 'observed_at'),
      }))
    },
  })
}

export interface ProspectFitScore {
  scoreKind: 'fadeup_fit' | 'migration_potential'
  score: number
  classification: 'HOT' | 'WARM' | 'COLD'
  breakdown: { group: string; factor: string; points: number; maxPoints: number; explanation: string }[]
  rulesetVersion: string
  scoredAt: string
}

export function useProspectFitScores(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect', prospectId, 'fit-scores'],
    enabled: Boolean(prospectId),
    queryFn: async (): Promise<ProspectFitScore[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('prospect_fit_scores')
        .select('score_kind, score, classification, breakdown, ruleset_version, scored_at')
        .eq('prospect_id', prospectId!)
        .eq('is_current', true)
      if (error) throw error
      return asRows(data).map((row) => ({
        scoreKind: enumValue(row, 'score_kind', ['fadeup_fit', 'migration_potential'] as const, 'fadeup_fit'),
        score: num(row, 'score'),
        classification: enumValue(row, 'classification', ['HOT', 'WARM', 'COLD'] as const, 'COLD'),
        breakdown: normalizeBreakdown(jsonArray(row, 'breakdown')),
        rulesetVersion: str(row, 'ruleset_version'),
        scoredAt: str(row, 'scored_at'),
      }))
    },
  })
}

/**
 * prospect_fit_scores.breakdown is written by the Worker as camelCase
 * JSON; tolerate snake_case too, since the Worker is a separate codebase
 * whose serialization this app does not control.
 */
function normalizeBreakdown(raw: unknown): ProspectFitScore['breakdown'] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      group: typeof item['group'] === 'string' ? item['group'] : 'OTHER',
      factor: typeof item['factor'] === 'string' ? item['factor'] : 'unknown',
      points: typeof item['points'] === 'number' ? item['points'] : 0,
      maxPoints:
        typeof item['maxPoints'] === 'number'
          ? item['maxPoints']
          : typeof item['max_points'] === 'number'
            ? item['max_points']
            : 0,
      explanation: typeof item['explanation'] === 'string' ? item['explanation'] : '',
    }))
}

export interface ProspectSegment {
  segmentKey: string
  rationale: Record<string, unknown>
  assignedAt: string
}

export function useProspectSegments(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect', prospectId, 'segments'],
    enabled: Boolean(prospectId),
    queryFn: async (): Promise<ProspectSegment[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('prospect_segments')
        .select('segment_key, rationale, assigned_at')
        .eq('prospect_id', prospectId!)
        .order('segment_key')
      if (error) throw error
      return asRows(data).map((row) => ({
        segmentKey: str(row, 'segment_key'),
        rationale: jsonObject(row, 'rationale'),
        assignedAt: str(row, 'assigned_at'),
      }))
    },
  })
}

export interface SegmentDefinition {
  key: string
  displayName: string
  description: string
  sortOrder: number
}

export function useSegmentDefinitions() {
  return useQuery({
    queryKey: ['acquisition', 'segment-definitions'],
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<SegmentDefinition[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('prospect_segment_definitions')
        .select('key, display_name, description, sort_order')
        .order('sort_order')
      if (error) throw error
      return asRows(data).map((row) => ({
        key: str(row, 'key'),
        displayName: str(row, 'display_name'),
        description: str(row, 'description'),
        sortOrder: num(row, 'sort_order'),
      }))
    },
  })
}

export interface ProspectLocale {
  detectedCountry: string | null
  detectedLanguage: string | null
  locale: string | null
  languageSource: string | null
  languageConfidence: number | null
  languageReviewRequired: boolean
  overrideLocale: string | null
  evidence: Record<string, unknown>
}

export function useProspectLocale(prospectId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'prospect', prospectId, 'locale'],
    enabled: Boolean(prospectId),
    queryFn: async (): Promise<ProspectLocale | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('prospect_locales')
        .select(
          'detected_country, detected_language, locale, language_source, language_confidence, language_review_required, override_locale, evidence',
        )
        .eq('prospect_id', prospectId!)
        .maybeSingle()
      if (error) throw error
      const row = asRow(data)
      if (!row) return null
      return {
        detectedCountry: strOrNull(row, 'detected_country'),
        detectedLanguage: strOrNull(row, 'detected_language'),
        locale: strOrNull(row, 'locale'),
        languageSource: strOrNull(row, 'language_source'),
        languageConfidence: numOrNull(row, 'language_confidence'),
        languageReviewRequired: bool(row, 'language_review_required'),
        overrideLocale: strOrNull(row, 'override_locale'),
        evidence: jsonObject(row, 'evidence'),
      }
    },
  })
}

/** Human locale override — always wins over detection (spec §72). */
export function useOverrideProspectLocale() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { prospectId: string; locale: string | null }) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('override_prospect_locale', {
        p_prospect_id: input.prospectId,
        p_locale: input.locale,
      })
      if (error) throw error
      return data
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'prospect', variables.prospectId] })
    },
  })
}
