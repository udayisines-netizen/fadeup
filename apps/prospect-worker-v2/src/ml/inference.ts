import { readFile } from 'node:fs/promises'
import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import type { CandidateTemplate, SelectionContext } from '../outreach/selector.js'
import { toModelValue, type Tribool } from '../features/tribool.js'

/**
 * ML inference for template ranking.
 *
 * Design constraints, all from the spec:
 *   - Low latency and fault tolerant (§67). Inference is a dot product
 *     over a coefficient vector loaded from a JSON artifact — no Python
 *     process, no HTTP call, no external AI API.
 *   - Fallback is unconditional (§36). Every failure path returns null and
 *     the caller uses deterministic rules. Outreach never stops because a
 *     model is missing, stale, corrupt, or slow.
 *   - ML only RANKS already-eligible candidates (§23/§28). It cannot admit
 *     a template, override a locale, or influence eligibility.
 *
 * The artifact format is produced by ml/train.py: a plain JSON export of a
 * fitted scikit-learn LogisticRegression (coefficients + intercept +
 * feature order + scaler statistics). Exporting coefficients rather than
 * pickling the estimator means the Worker never deserializes untrusted
 * Python objects, which would be remote code execution by design.
 */

export interface ModelArtifact {
  modelKey: string
  modelVersion: string
  modelType: 'logistic_regression'
  target: string
  featureSchemaVersion: string
  /** Ordered feature names; the coefficient at index i belongs to featureNames[i]. */
  featureNames: string[]
  coefficients: number[]
  intercept: number
  /** Per-feature mean/scale from the training StandardScaler, and the imputation value for NaN. */
  featureMeans: number[]
  featureScales: number[]
  /** Value substituted for a NaN/UNKNOWN feature at inference time — must match training. */
  featureImputations: number[]
}

export interface LoadedModel {
  modelVersionId: string
  artifact: ModelArtifact
}

/** Feature snapshot for one (prospect, template) pair, matching ml/features.py's contract. */
export interface InferenceFeatures {
  rating: number | null
  reviewCount: number | null
  estimatedBarberCount: number | null
  fadeUpFitScore: number | null
  migrationPotentialScore: number | null
  digitalGapScore: number | null
  websiteQualityScore: number | null
  hasWebsite: Tribool
  mobileReady: Tribool
  bookingDetected: Tribool
  instagramPresence: Tribool
  multiBarber: Tribool
  /** One-hot-ish categorical values, hashed into the feature vector by name. */
  country: string
  shopType: string
  bookingProvider: string
  locale: string
  templateKey: string
  salesAngle: string | null
  sendWeekday: number
  sendHour: number
}

export class ModelCache {
  private loaded: LoadedModel | null = null
  private loadedAtMs = 0
  private readonly ttlMs: number

  constructor(private readonly artifactDir: string, ttlMs = 5 * 60_000) {
    this.ttlMs = ttlMs
  }

  /**
   * Returns the promoted model, or null.
   *
   * Null is a completely normal answer: in Phase 0 no model is promoted at
   * all, and the caller must handle that without degradation.
   */
  async getPromotedModel(pool: DbPool, target: string, log: Logger): Promise<LoadedModel | null> {
    if (this.loaded && Date.now() - this.loadedAtMs < this.ttlMs) {
      return this.loaded
    }

    try {
      const result = await pool.query<{
        id: string
        model_key: string
        model_version: string
        model_type: string
        artifact_path: string | null
        feature_schema_version: string
      }>(
        `select id, model_key, model_version, model_type, artifact_path, feature_schema_version
         from public.ml_model_versions
         where is_active and target = $1::public.ml_model_target and model_type <> 'rule_baseline'
         limit 1`,
        [target],
      )

      const row = result.rows[0]
      if (!row || !row.artifact_path) {
        this.loaded = null
        this.loadedAtMs = Date.now()
        return null
      }

      // Path containment: artifact_path comes from the database, which
      // platform admins can write. Refuse anything that escapes the
      // configured artifact directory.
      if (row.artifact_path.includes('..') || !row.artifact_path.startsWith(this.artifactDir)) {
        log.error('ml: promoted model artifact_path is outside the artifact directory — refusing to load', undefined, {
          model_version: row.model_version,
        })
        this.loaded = null
        this.loadedAtMs = Date.now()
        return null
      }

      const raw = await readFile(row.artifact_path, 'utf-8')
      const artifact = JSON.parse(raw) as ModelArtifact

      if (!validateArtifact(artifact)) {
        log.error('ml: promoted model artifact failed validation — falling back to rules', undefined, {
          model_version: row.model_version,
        })
        this.loaded = null
        this.loadedAtMs = Date.now()
        return null
      }

      this.loaded = { modelVersionId: row.id, artifact }
      this.loadedAtMs = Date.now()
      log.info('ml: promoted model loaded', { model_key: artifact.modelKey, model_version: artifact.modelVersion, target })
      return this.loaded
    } catch (error) {
      log.warn('ml: could not load a promoted model — deterministic rules will be used', {
        error: error instanceof Error ? error.message : String(error),
      })
      this.loaded = null
      this.loadedAtMs = Date.now()
      return null
    }
  }

  /** Test/ops hook: drops the cache so the next call re-reads the registry. */
  invalidate(): void {
    this.loaded = null
    this.loadedAtMs = 0
  }
}

function validateArtifact(artifact: unknown): artifact is ModelArtifact {
  if (!artifact || typeof artifact !== 'object') return false
  const a = artifact as Partial<ModelArtifact>
  return (
    a.modelType === 'logistic_regression' &&
    Array.isArray(a.featureNames) &&
    Array.isArray(a.coefficients) &&
    Array.isArray(a.featureMeans) &&
    Array.isArray(a.featureScales) &&
    Array.isArray(a.featureImputations) &&
    typeof a.intercept === 'number' &&
    a.featureNames.length === a.coefficients.length &&
    a.featureNames.length === a.featureMeans.length &&
    a.featureNames.length === a.featureScales.length &&
    a.featureNames.length === a.featureImputations.length &&
    a.featureNames.length > 0
  )
}

/**
 * Builds the raw feature map for a (prospect, template) pair.
 *
 * Categorical values become `name=value` indicator features, exactly as
 * ml/features.py does at training time — the two must agree or the model
 * is being fed a different space than it learned.
 *
 * NOTHING observable only after the send appears here (spec §68). There is
 * no `delivered`, no `replied`, no `read`.
 */
export function buildFeatureMap(features: InferenceFeatures): Record<string, number> {
  const map: Record<string, number> = {
    rating: features.rating ?? Number.NaN,
    review_count: features.reviewCount ?? Number.NaN,
    estimated_barber_count: features.estimatedBarberCount ?? Number.NaN,
    fadeup_fit_score: features.fadeUpFitScore ?? Number.NaN,
    migration_potential_score: features.migrationPotentialScore ?? Number.NaN,
    digital_gap_score: features.digitalGapScore ?? Number.NaN,
    website_quality_score: features.websiteQualityScore ?? Number.NaN,
    has_website: toModelValue(features.hasWebsite),
    mobile_ready: toModelValue(features.mobileReady),
    booking_detected: toModelValue(features.bookingDetected),
    instagram_presence: toModelValue(features.instagramPresence),
    multi_barber: toModelValue(features.multiBarber),
    send_hour: features.sendHour,
  }

  const categorical: [string, string][] = [
    ['country', features.country],
    ['shop_type', features.shopType],
    ['booking_provider', features.bookingProvider],
    ['locale', features.locale],
    ['template_key', features.templateKey],
    ['sales_angle', features.salesAngle ?? 'UNKNOWN'],
    ['send_weekday', String(features.sendWeekday)],
  ]

  for (const [name, value] of categorical) {
    map[`${name}=${value}`] = 1
  }

  return map
}

/**
 * Scores a feature map with a logistic-regression artifact.
 *
 * Features the model never saw are simply absent from featureNames and are
 * ignored; features the model expects but the map lacks (including NaN)
 * use the training-time imputation value. Both behaviours match how
 * scikit-learn's pipeline handles unseen/missing columns, which is what
 * keeps offline metrics comparable to online behaviour.
 */
export function scoreLogisticRegression(artifact: ModelArtifact, featureMap: Record<string, number>): number {
  let z = artifact.intercept

  for (let i = 0; i < artifact.featureNames.length; i++) {
    const name = artifact.featureNames[i]!
    const raw = featureMap[name]
    const value = raw === undefined || Number.isNaN(raw) ? artifact.featureImputations[i]! : raw

    const mean = artifact.featureMeans[i]!
    const scale = artifact.featureScales[i]!
    // A zero scale means the feature was constant in training and carries
    // no information; treat it as centred rather than dividing by zero.
    const standardized = scale === 0 ? 0 : (value - mean) / scale

    z += artifact.coefficients[i]! * standardized
  }

  return sigmoid(z)
}

function sigmoid(z: number): number {
  // Numerically stable for large |z|.
  if (z >= 0) {
    const e = Math.exp(-z)
    return 1 / (1 + e)
  }
  const e = Math.exp(z)
  return e / (1 + e)
}

export interface RankedCandidate {
  templateId: string
  score: number
}

/**
 * Ranks candidate templates with the promoted model, recording every
 * prediction (spec §37 — prediction history is append-only and never
 * overwritten).
 *
 * Returns null on ANY problem, which the selector treats as "use rules".
 */
export async function rankCandidatesWithModel(
  pool: DbPool,
  cache: ModelCache,
  ctx: SelectionContext,
  candidates: CandidateTemplate[],
  baseFeatures: Omit<InferenceFeatures, 'templateKey' | 'salesAngle'>,
  target: string,
  log: Logger,
): Promise<{ ranked: RankedCandidate[]; predictionId: string | null } | null> {
  const model = await cache.getPromotedModel(pool, target, log)
  if (!model) return null

  try {
    const scored = candidates.map((candidate) => {
      const featureMap = buildFeatureMap({
        ...baseFeatures,
        templateKey: candidate.key,
        salesAngle: candidate.salesAngle,
      })
      return { candidate, probability: scoreLogisticRegression(model.artifact, featureMap), featureMap }
    })

    // Stable tiebreak on template id keeps ranking reproducible.
    scored.sort((a, b) => b.probability - a.probability || a.candidate.id.localeCompare(b.candidate.id))

    const winnerId = scored[0]?.candidate.id ?? null
    let winnerPredictionId: string | null = null

    // Every candidate's prediction is stored, not just the winner — that
    // is what makes "template A 0.13 / B 0.21 / C 0.07, selected B"
    // reconstructable later.
    for (const entry of scored) {
      const inserted = await pool.query<{ id: string }>(
        `insert into public.ml_predictions
           (prospect_id, template_id, model_version_id, is_fallback, target, predicted_probability,
            feature_schema_version, features_snapshot, selected, campaign_id)
         values ($1, $2, $3, false, $4::public.ml_model_target, $5, $6, $7, $8, $9)
         returning id`,
        [
          ctx.prospectId,
          entry.candidate.id,
          model.modelVersionId,
          target,
          entry.probability.toFixed(5),
          model.artifact.featureSchemaVersion,
          JSON.stringify(entry.featureMap),
          entry.candidate.id === winnerId,
          ctx.campaignId,
        ],
      )
      if (entry.candidate.id === winnerId) {
        winnerPredictionId = inserted.rows[0]?.id ?? null
      }
    }

    return {
      ranked: scored.map((s) => ({ templateId: s.candidate.id, score: s.probability })),
      predictionId: winnerPredictionId,
    }
  } catch (error) {
    log.warn('ml: inference failed — deterministic rules will be used', {
      prospect_id: ctx.prospectId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
