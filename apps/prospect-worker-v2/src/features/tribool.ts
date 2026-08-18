/**
 * TRUE / FALSE / UNKNOWN / NOT_APPLICABLE.
 *
 * The single most important invariant in the feature layer: a value we
 * never managed to observe is UNKNOWN, and UNKNOWN is NOT false. A website
 * crawl that timed out tells us nothing about whether the business has
 * online booking — recording that as `booking_detected = FALSE` would
 * manufacture a signal out of an infrastructure failure and then feed it
 * to scoring and to the ML dataset.
 *
 * Mirrors public.prospect_tribool (db/migrations/20260818100000_...).
 */

export type Tribool = 'TRUE' | 'FALSE' | 'UNKNOWN' | 'NOT_APPLICABLE'

export const TRIBOOL_VALUES: readonly Tribool[] = ['TRUE', 'FALSE', 'UNKNOWN', 'NOT_APPLICABLE']

/** Strictly TRUE. */
export function isTrue(value: Tribool): boolean {
  return value === 'TRUE'
}

/**
 * Strictly FALSE. Deliberately NOT `!isTrue(value)` — that is exactly the
 * bug this module exists to prevent, and the asymmetry is the point.
 */
export function isFalse(value: Tribool): boolean {
  return value === 'FALSE'
}

/** TRUE or FALSE — i.e. we actually observed something either way. */
export function isKnown(value: Tribool): boolean {
  return value === 'TRUE' || value === 'FALSE'
}

/**
 * Converts an observation into a Tribool. `observed` is whether the
 * enrichment step that would have produced this signal actually RAN
 * successfully; when it did not, the answer is UNKNOWN regardless of what
 * `value` happens to be.
 */
export function fromObservation(observed: boolean, value: boolean | null | undefined): Tribool {
  if (!observed) return 'UNKNOWN'
  if (value === null || value === undefined) return 'UNKNOWN'
  return value ? 'TRUE' : 'FALSE'
}

/** Parses a database value back into a Tribool, defaulting to UNKNOWN rather than throwing. */
export function parseTribool(raw: unknown): Tribool {
  return typeof raw === 'string' && (TRIBOOL_VALUES as readonly string[]).includes(raw) ? (raw as Tribool) : 'UNKNOWN'
}

/**
 * Numeric encoding for the ML feature matrix. UNKNOWN and NOT_APPLICABLE
 * become NaN (not 0), so a model that needs to learn "we don't know" gets a
 * genuinely missing value rather than a fabricated negative. The Python
 * training pipeline treats NaN as its own category / imputes it explicitly.
 */
export function toModelValue(value: Tribool): number {
  if (value === 'TRUE') return 1
  if (value === 'FALSE') return 0
  return Number.NaN
}
