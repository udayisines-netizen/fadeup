import { createHash } from 'node:crypto'
import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import type { CandidateTemplate, SelectionContext } from './selector.js'

/**
 * A/B experiment assignment (spec §32).
 *
 * Assignment is a pure hash of (experiment seed, prospect id) — no random
 * number generator, no timestamp. The same prospect in the same experiment
 * always lands in the same arm, forever, on any machine. That is what
 * makes an experiment auditable and what prevents a re-run of the
 * preparation step from silently re-randomizing a cohort mid-experiment.
 */

export interface ExperimentArm {
  id: string
  armKey: string
  templateId: string
  weight: number
  isControl: boolean
}

export interface RunningExperiment {
  id: string
  key: string
  explorationPct: number
  arms: ExperimentArm[]
}

export interface ExperimentAssignment {
  experimentId: string
  armId: string
  armKey: string
  templateId: string
  assignmentHash: string
}

/**
 * Deterministic bucket in [0, 1) for a (seed, prospect) pair. SHA-256 of
 * the concatenation, first 8 hex digits as an integer — uniform enough for
 * cohort splitting and trivially reproducible in SQL or Python for
 * after-the-fact verification.
 */
export function assignmentBucket(seed: string, prospectId: string): { bucket: number; hash: string } {
  const hash = createHash('sha256').update(`${seed}:${prospectId}`).digest('hex')
  const slice = hash.slice(0, 8)
  const value = Number.parseInt(slice, 16)
  return { bucket: value / 0xffffffff, hash }
}

/**
 * Picks an arm by weighted deterministic bucketing. A separate hash
 * namespace ('arm') from the exploration decision, so changing exploration
 * percentage does not reshuffle everyone's arm.
 */
export function pickArm(arms: ExperimentArm[], seed: string, prospectId: string): ExperimentArm | null {
  if (arms.length === 0) return null

  const totalWeight = arms.reduce((sum, arm) => sum + arm.weight, 0)
  if (totalWeight <= 0) return null

  const { bucket } = assignmentBucket(`${seed}:arm`, prospectId)
  const target = bucket * totalWeight

  let cumulative = 0
  for (const arm of [...arms].sort((a, b) => a.armKey.localeCompare(b.armKey))) {
    cumulative += arm.weight
    if (target < cumulative) return arm
  }

  return arms[arms.length - 1] ?? null
}

/**
 * Finds a running experiment whose cohort matches this prospect. Cohort
 * dimensions are ANDed and a NULL dimension means "any", matching the
 * table's semantics.
 */
export async function findMatchingExperiment(pool: DbPool, ctx: SelectionContext): Promise<{ experiment: RunningExperiment; seed: string } | null> {
  const result = await pool.query<{
    id: string
    key: string
    assignment_seed: string
    exploration_pct: string
    arm_id: string
    arm_key: string
    template_id: string
    weight: number
    is_control: boolean
  }>(
    `select e.id, e.key, e.assignment_seed, e.exploration_pct,
            a.id as arm_id, a.arm_key, a.template_id, a.weight, a.is_control
     from public.outreach_experiments e
     join public.outreach_experiment_arms a on a.experiment_id = e.id
     join public.outreach_templates t on t.id = a.template_id
     where e.status = 'running'
       -- Every arm's template must itself still be approved and in the
       -- right language: an experiment cannot smuggle a paused or
       -- wrong-locale template past the eligibility rules.
       and t.status = 'approved'
       and t.locale = $2
       and (e.cohort_locale is null or e.cohort_locale = $2)
       and (e.cohort_segment_key is null or e.cohort_segment_key = any($3::text[]))
       and (e.cohort_booking_provider_id is null
            or e.cohort_booking_provider_id = (select id from public.booking_providers where key = $4))
       and (e.cohort_country is null or e.cohort_country = (select country from public.prospects where id = $1))
     order by e.created_at, a.arm_key`,
    [ctx.prospectId, ctx.locale, ctx.segmentKeys, ctx.bookingProviderKey],
  )

  if (result.rows.length === 0) return null

  // Take the oldest matching experiment; the DB exposure trigger enforces
  // the per-prospect concurrency limit on insert.
  const firstId = result.rows[0]!.id
  const rows = result.rows.filter((row) => row.id === firstId)

  return {
    seed: rows[0]!.assignment_seed,
    experiment: {
      id: firstId,
      key: rows[0]!.key,
      explorationPct: Number(rows[0]!.exploration_pct),
      arms: rows.map((row) => ({
        id: row.arm_id,
        armKey: row.arm_key,
        templateId: row.template_id,
        weight: row.weight,
        isControl: row.is_control,
      })),
    },
  }
}

/**
 * Assigns a prospect to an arm, persisting the decision.
 *
 * Returns null (not an error) whenever the prospect should not be
 * experimented on: no matching experiment, the exploration draw excluded
 * them, the arm's template is not in the eligible candidate set, or the
 * database's exposure/cooldown limits rejected the enrolment. In every one
 * of those cases the caller proceeds with deterministic rule selection.
 */
export async function assignToExperiment(
  pool: DbPool,
  ctx: SelectionContext,
  candidates: CandidateTemplate[],
  log: Logger,
): Promise<ExperimentAssignment | null> {
  const match = await findMatchingExperiment(pool, ctx)
  if (!match) return null

  const { experiment, seed } = match

  // Already assigned? Honour the existing arm — re-randomizing a prospect
  // mid-experiment is statistical contamination.
  const existing = await pool.query<{ arm_id: string; arm_key: string; template_id: string; assignment_hash: string }>(
    `select a.id as arm_id, a.arm_key, a.template_id, asg.assignment_hash
     from public.outreach_assignments asg
     join public.outreach_experiment_arms a on a.id = asg.arm_id
     where asg.experiment_id = $1 and asg.prospect_id = $2`,
    [experiment.id, ctx.prospectId],
  )

  const existingRow = existing.rows[0]
  if (existingRow) {
    return {
      experimentId: experiment.id,
      armId: existingRow.arm_id,
      armKey: existingRow.arm_key,
      templateId: existingRow.template_id,
      assignmentHash: existingRow.assignment_hash,
    }
  }

  // Exploration gate: only this share of the cohort is experimented on;
  // everyone else gets the deterministic rule winner. Capping experimental
  // exposure is spec §69.
  const { bucket, hash } = assignmentBucket(`${seed}:explore`, ctx.prospectId)
  if (bucket * 100 >= experiment.explorationPct) {
    return null
  }

  const arm = pickArm(experiment.arms, seed, ctx.prospectId)
  if (!arm) return null

  // The arm's template must be among the candidates the RULES already
  // deemed eligible. An experiment can choose between valid options; it
  // cannot authorise an invalid one.
  if (!candidates.some((c) => c.id === arm.templateId)) {
    log.debug('experiments: arm template is not rule-eligible for this prospect, skipping experiment', {
      experiment_id: experiment.id,
      prospect_id: ctx.prospectId,
      arm: arm.armKey,
    })
    return null
  }

  try {
    await pool.query(
      `insert into public.outreach_assignments (experiment_id, prospect_id, arm_id, assignment_hash)
       values ($1, $2, $3, $4)
       on conflict (experiment_id, prospect_id) do nothing`,
      [experiment.id, ctx.prospectId, arm.id, hash],
    )
  } catch (error) {
    // The exposure/cooldown trigger raises here when the prospect is
    // already in too many running experiments. That is a correct refusal,
    // not a failure — fall back to rules.
    log.debug('experiments: enrolment refused by exposure limits, falling back to rules', {
      experiment_id: experiment.id,
      prospect_id: ctx.prospectId,
      reason: error instanceof Error ? error.message : String(error),
    })
    return null
  }

  return {
    experimentId: experiment.id,
    armId: arm.id,
    armKey: arm.armKey,
    templateId: arm.templateId,
    assignmentHash: hash,
  }
}
