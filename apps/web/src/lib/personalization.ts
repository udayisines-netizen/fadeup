import type { HaircutFrequency } from '@/lib/queries/customer-profile'

/**
 * Deterministic, no-AI grooming-freshness math (spec: "Use deterministic
 * product logic. NO LLM is required."). Centralized here rather than
 * scattered across React components so the "is my usual interval up"
 * calculation has exactly one implementation and one set of tests. Never
 * fabricates a fact: every field is null when there isn't enough real data
 * to support it (no completed appointment yet, or the customer answered
 * "depends" / never answered the frequency question at all).
 */

const FREQUENCY_DAYS: Partial<Record<HaircutFrequency, number>> = {
  weekly: 7,
  every_2_weeks: 14,
  every_3_weeks: 21,
  monthly: 30,
  less_often: 45,
  // 'depends' deliberately has no numeric mapping — there is no honest
  // single number to compare against, so freshness math is skipped rather
  // than guessing.
}

export interface FreshnessContext {
  /** Whole days since the customer's most recent COMPLETED appointment, or null if they have none yet. */
  daysSinceLastCut: number | null
  /** The numeric interval implied by their stated haircut_frequency, or null if unanswered/"depends". */
  preferredIntervalDays: number | null
  /** True only when both values above are real and daysSinceLastCut has reached/passed the preferred interval. */
  isOverdue: boolean
}

export function computeFreshness(
  lastCompletedAt: string | null,
  haircutFrequency: HaircutFrequency | null,
  now: Date = new Date(),
): FreshnessContext {
  const daysSinceLastCut =
    lastCompletedAt !== null ? Math.max(0, Math.floor((now.getTime() - new Date(lastCompletedAt).getTime()) / 86_400_000)) : null

  const preferredIntervalDays = haircutFrequency !== null ? (FREQUENCY_DAYS[haircutFrequency] ?? null) : null

  const isOverdue = daysSinceLastCut !== null && preferredIntervalDays !== null && daysSinceLastCut >= preferredIntervalDays

  return { daysSinceLastCut, preferredIntervalDays, isOverdue }
}
