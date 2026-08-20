/**
 * Postgres errors, turned into something a customer can act on.
 *
 * `book_public_appointment` raises plain-text exceptions, and the GiST
 * exclusion constraint raises its own when two people take the same slot in
 * the same instant. Those messages are written for an operator reading a log,
 * not for someone standing on a pavement with one hand on their phone.
 *
 * This maps them to translation KEYS rather than to English sentences, which
 * is the whole point: the previous version returned hardcoded English at the
 * exact moment the flow fails, so a Japanese customer who had read a fully
 * translated booking flow hit a wall of English the one time it mattered.
 *
 * Anything unrecognised becomes `errors.generic`. The raw text is NOT shown —
 * a customer cannot use "conflicting key value violates exclusion constraint",
 * and echoing database internals to the public is a small leak with no upside.
 * The caller logs it instead, so nothing is silently swallowed.
 */

/** Ordered: the first pattern that matches wins. */
const PATTERNS: Array<[RegExp, string]> = [
  // The race we deliberately allow the database to arbitrate.
  [/exclusion|conflicting key value|duplicate key/, 'errors.slotTaken'],
  [/starts_at must be in the future/, 'errors.slotPast'],
  [/outside available hours|closed at the requested time/, 'errors.outsideHours'],
  [/unavailable on the requested date|does not work on the requested date/, 'errors.barberUnavailable'],
  [/at least one of customer_phone or customer_email/, 'validation.contactRequired'],
  [/customer_name is required/, 'validation.nameRequired'],
  [/location is not available for booking/, 'errors.locationUnavailable'],
  [/service is not available for booking/, 'errors.serviceUnavailable'],
  [/barber is not available for this service/, 'errors.barberServiceMismatch'],
]

/** Returns a key inside the `booking` namespace. */
export function bookingErrorKey(rawMessage: string): string {
  const message = rawMessage.toLowerCase()
  for (const [pattern, key] of PATTERNS) {
    if (pattern.test(message)) return key
  }
  return 'errors.generic'
}

/**
 * True when the failure means the chosen slot is gone. The flow uses this to
 * send the customer back to the time step with fresh availability instead of
 * leaving them on a form whose submit button can no longer succeed.
 */
export function isSlotUnavailable(key: string): boolean {
  return key === 'errors.slotTaken' || key === 'errors.slotPast' || key === 'errors.outsideHours' || key === 'errors.barberUnavailable'
}
