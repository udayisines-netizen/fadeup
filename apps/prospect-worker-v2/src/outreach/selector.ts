import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'

/**
 * Template selection.
 *
 * The layering the spec demands (§23/§26/§31/§36/§67):
 *
 *   1. ELIGIBILITY decides WHETHER we may contact at all. That is
 *      server-side SQL (public.outreach_block_reason) and ML never touches
 *      it.
 *   2. RULES decide WHICH approved templates are candidates, based on
 *      locale, competitor and segment. Deterministic, always available.
 *   3. EXPERIMENT (when one is running for this cohort) picks among the
 *      candidates by reproducible hash.
 *   4. ML, when a model is promoted, RANKS the already-eligible candidates.
 *      It can only reorder a list the rules produced — it can never
 *      introduce a template, bypass a locale, or write a word of copy.
 *
 * If anything in step 3 or 4 is unavailable or fails, step 2's answer is
 * used. Outreach never stops because ML is down.
 */

export type SalesAngle =
  | 'ONLINE_BOOKING'
  | 'MARKETPLACE_ACQUISITION'
  | 'LIVE_QUEUE'
  | 'BARBER_MANAGEMENT'
  | 'SHOP_OS'
  | 'CUSTOMER_RETENTION'
  | 'COMPETITOR_MIGRATION'
  | 'MULTI_LOCATION'
  | 'DIGITAL_MODERNIZATION'

export interface CandidateTemplate {
  id: string
  key: string
  locale: string
  segmentKey: string | null
  bookingProviderId: string | null
  bookingProviderKey: string | null
  salesAngle: SalesAngle | null
  allowedVariables: string[]
  body: string
}

export interface SelectionContext {
  prospectId: string
  locale: string
  bookingProviderKey: string
  segmentKeys: string[]
  fadeUpFitScore: number | null
  migrationPotentialScore: number | null
  campaignId: string | null
}

export interface SelectionResult {
  template: CandidateTemplate
  method: 'rule' | 'ml' | 'experiment'
  reason: Record<string, unknown>
  salesAngle: SalesAngle | null
  /** Every candidate considered, in the order they were ranked. */
  rankedCandidates: { templateId: string; score: number }[]
  mlPredictionId: string | null
}

export class NoEligibleTemplateError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message)
    this.name = 'NoEligibleTemplateError'
  }
}

/**
 * Candidate sales angles for a prospect, in priority order. Pure rules —
 * ML may later re-rank the templates carrying these angles, but the angle
 * taxonomy itself is deterministic.
 */
export function candidateSalesAngles(ctx: SelectionContext): SalesAngle[] {
  const angles: SalesAngle[] = []
  const onCompetitor = !['NO_BOOKING', 'UNKNOWN', 'CUSTOM_BOOKING'].includes(ctx.bookingProviderKey)

  if (onCompetitor) {
    angles.push('COMPETITOR_MIGRATION')
    if ((ctx.migrationPotentialScore ?? 0) >= 70) {
      angles.push('MARKETPLACE_ACQUISITION', 'LIVE_QUEUE')
    }
  } else if (ctx.bookingProviderKey === 'NO_BOOKING') {
    angles.push('ONLINE_BOOKING')
  }

  if (ctx.segmentKeys.includes('MULTI_BARBER_SHOP')) angles.push('BARBER_MANAGEMENT', 'LIVE_QUEUE')
  if (ctx.segmentKeys.includes('HIGH_REPUTATION')) angles.push('MARKETPLACE_ACQUISITION')
  if (ctx.segmentKeys.includes('HIGH_DIGITAL_GAP')) angles.push('DIGITAL_MODERNIZATION')
  if (ctx.segmentKeys.includes('INDEPENDENT_BARBER')) angles.push('MARKETPLACE_ACQUISITION')

  // Always a valid last resort.
  angles.push('SHOP_OS')

  return [...new Set(angles)]
}

/**
 * Loads the approved templates that are valid for this prospect.
 *
 * The locale match is EXACT and non-negotiable — there is no en-US ->
 * en-GB fallback, because "close enough" language is exactly the failure
 * spec §25 says must block outreach instead.
 */
export async function loadCandidateTemplates(pool: DbPool, ctx: SelectionContext): Promise<CandidateTemplate[]> {
  const result = await pool.query<{
    id: string
    key: string
    locale: string
    segment_key: string | null
    booking_provider_id: string | null
    booking_provider_key: string | null
    sales_angle: string | null
    allowed_variables: string[]
    body: string
  }>(
    `select t.id, t.key, t.locale, t.segment_key, t.booking_provider_id,
            bp.key as booking_provider_key, t.sales_angle, t.allowed_variables, t.body
     from public.outreach_templates t
     left join public.booking_providers bp on bp.id = t.booking_provider_id
     where t.status = 'approved'
       and t.channel = 'whatsapp'
       and t.locale = $1
       -- Provider targeting: a template either targets no provider (generic)
       -- or exactly this prospect's current provider.
       and (t.booking_provider_id is null or bp.key = $2)
       -- Segment targeting: same rule.
       and (t.segment_key is null or t.segment_key = any($3::text[]))
     order by t.key`,
    [ctx.locale, ctx.bookingProviderKey, ctx.segmentKeys],
  )

  return result.rows.map((row) => ({
    id: row.id,
    key: row.key,
    locale: row.locale,
    segmentKey: row.segment_key,
    bookingProviderId: row.booking_provider_id,
    bookingProviderKey: row.booking_provider_key,
    salesAngle: row.sales_angle as SalesAngle | null,
    allowedVariables: row.allowed_variables ?? [],
    body: row.body,
  }))
}

/**
 * Deterministic rule ranking: how well does each candidate match this
 * prospect? Specificity wins — a Planity-targeted, multi-barber-targeted
 * French template beats a generic French one.
 */
export function rankByRules(candidates: CandidateTemplate[], ctx: SelectionContext): { templateId: string; score: number }[] {
  const angles = candidateSalesAngles(ctx)

  const scored = candidates.map((candidate) => {
    let score = 0

    // Exact competitor targeting is the strongest signal.
    if (candidate.bookingProviderKey === ctx.bookingProviderKey) score += 50

    // Segment targeting.
    if (candidate.segmentKey && ctx.segmentKeys.includes(candidate.segmentKey)) score += 30

    // Sales-angle priority: earlier in the list is a better fit.
    if (candidate.salesAngle) {
      const angleRank = angles.indexOf(candidate.salesAngle)
      if (angleRank >= 0) score += Math.max(0, 20 - angleRank * 3)
    }

    return { templateId: candidate.id, score }
  })

  // Stable tiebreak on template id so the ranking is fully reproducible
  // for the same inputs — required for auditability.
  return scored.sort((a, b) => b.score - a.score || a.templateId.localeCompare(b.templateId))
}

/**
 * The complete selection flow. Never throws for an ML problem — only when
 * there is genuinely no approved template in the prospect's language, which
 * is a real, reportable configuration gap that must block the send.
 */
export async function selectTemplate(
  pool: DbPool,
  ctx: SelectionContext,
  log: Logger,
  hooks: {
    /** Returns an experiment arm's template id, or null when no experiment applies. */
    assignExperiment?: (candidates: CandidateTemplate[]) => Promise<{ templateId: string; experimentId: string; armKey: string } | null>
    /** Returns ML-ranked candidates, or null when no model is promoted / inference failed. */
    rankWithModel?: (candidates: CandidateTemplate[]) => Promise<{ ranked: { templateId: string; score: number }[]; predictionId: string | null } | null>
  } = {},
): Promise<SelectionResult> {
  const candidates = await loadCandidateTemplates(pool, ctx)

  if (candidates.length === 0) {
    throw new NoEligibleTemplateError(
      `no approved WhatsApp template exists for locale ${ctx.locale} (provider ${ctx.bookingProviderKey})`,
      'no_template_for_locale',
    )
  }

  const ruleRanking = rankByRules(candidates, ctx)
  const ruleWinnerId = ruleRanking[0]?.templateId
  const ruleWinner = candidates.find((c) => c.id === ruleWinnerId)
  if (!ruleWinner) {
    throw new NoEligibleTemplateError('rule ranking produced no winner', 'rule_ranking_empty')
  }

  // --- Experiment ------------------------------------------------------
  if (hooks.assignExperiment) {
    try {
      const assignment = await hooks.assignExperiment(candidates)
      if (assignment) {
        const template = candidates.find((c) => c.id === assignment.templateId)
        if (template) {
          return {
            template,
            method: 'experiment',
            reason: {
              experiment_id: assignment.experimentId,
              arm: assignment.armKey,
              rule_winner: ruleWinner.key,
              note: 'Experiment assignment overrode the rule winner; assignment is reproducible from the experiment seed.',
            },
            salesAngle: template.salesAngle,
            rankedCandidates: ruleRanking,
            mlPredictionId: null,
          }
        }
      }
    } catch (error) {
      // An experiment failure must never stop a send.
      log.warn('selector: experiment assignment failed, falling through to rules/ML', {
        prospect_id: ctx.prospectId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // --- ML ranking ------------------------------------------------------
  if (hooks.rankWithModel) {
    try {
      const mlResult = await hooks.rankWithModel(candidates)
      const topId = mlResult?.ranked[0]?.templateId
      const template = topId ? candidates.find((c) => c.id === topId) : undefined

      if (mlResult && template) {
        return {
          template,
          method: 'ml',
          reason: {
            rule_winner: ruleWinner.key,
            ml_winner: template.key,
            note: 'ML ranked the rule-eligible candidates. It could not introduce a template outside this set.',
          },
          salesAngle: template.salesAngle,
          rankedCandidates: mlResult.ranked,
          mlPredictionId: mlResult.predictionId,
        }
      }
    } catch (error) {
      log.warn('selector: ML ranking failed, falling back to deterministic rules', {
        prospect_id: ctx.prospectId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // --- Deterministic fallback (always available) -----------------------
  return {
    template: ruleWinner,
    method: 'rule',
    reason: {
      rule_score: ruleRanking[0]?.score ?? 0,
      candidates_considered: candidates.length,
      angles: candidateSalesAngles(ctx),
    },
    salesAngle: ruleWinner.salesAngle,
    rankedCandidates: ruleRanking,
    mlPredictionId: null,
  }
}
