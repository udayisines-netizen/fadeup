import { normalizeBusinessName } from '../normalize/name.js'
import { normalizePhoneE164 } from '../normalize/phone.js'
import type { PlanityEstablishment } from './planity.js'

/**
 * Does this Planity page describe the prospect we think it does?
 *
 * WHY THIS EXISTS EVEN THOUGH THE URL CAME FROM A FIRST-PARTY LINK
 *
 * The Planity URLs this worker reads are taken from links on the business's
 * OWN website, which is about as good a provenance as exists. It is still not
 * proof. Real cases that break the assumption:
 *
 *   * A group site listing several salons links all of their Planity pages;
 *     the crawler attributes whichever it saw first.
 *   * A web agency's template leaves a demo Planity link in the footer.
 *   * A business moved, kept the domain, and the old link points at the
 *     previous owner's listing.
 *
 * Attaching the wrong provider evidence is not a cosmetic error: it feeds
 * migration_potential and would put a barber in a campaign about migrating off
 * a platform they have never used. So the page has to corroborate the prospect
 * before its evidence is accepted.
 *
 * PURE. Takes what it compares, returns why it decided.
 */

export interface MatchSubject {
  canonicalName: string
  country: string
  postalCode: string | null
  city: string | null
  phoneE164: string | null
}

export interface MatchVerdict {
  matched: boolean
  /** Signals that agreed, for the log and the stored evidence. */
  reasons: string[]
  /** Why it was rejected. Null when matched. */
  rejection: string | null
}

/**
 * Requires at least one STRONG signal, or two weak ones that together are not
 * plausibly coincidental.
 *
 * Strong: identical E.164 phone, or identical postcode plus a matching name.
 * A postcode alone is not strong — a dense arrondissement holds hundreds of
 * salons — and a name alone is never sufficient at any strength, which is the
 * brief's explicit rule.
 */
export function matchPlanityEstablishment(
  subject: MatchSubject,
  page: PlanityEstablishment,
): MatchVerdict {
  const reasons: string[] = []

  const subjectPhone = subject.phoneE164
  const pagePhone = normalizePhoneE164(page.phone, page.countryCode ?? subject.country)
  const phoneAgrees = subjectPhone !== null && pagePhone !== null && subjectPhone === pagePhone
  const phoneConflicts = subjectPhone !== null && pagePhone !== null && subjectPhone !== pagePhone

  const subjectName = normalizeBusinessName(subject.canonicalName)
  const pageName = normalizeBusinessName(page.name)
  const nameAgrees = subjectName.length >= 3 && pageName.length >= 3 && namesAgree(subjectName, pageName)

  const postcodeAgrees =
    subject.postalCode !== null &&
    page.postalCode !== null &&
    normalizePostcode(subject.postalCode) === normalizePostcode(page.postalCode)
  const postcodeConflicts =
    subject.postalCode !== null &&
    page.postalCode !== null &&
    normalizePostcode(subject.postalCode) !== normalizePostcode(page.postalCode)

  const cityAgrees =
    subject.city !== null &&
    page.city !== null &&
    normalizeBusinessName(subject.city) === normalizeBusinessName(page.city)

  if (phoneAgrees) reasons.push('phone_e164')
  if (postcodeAgrees) reasons.push('postal_code')
  if (nameAgrees) reasons.push('business_name')
  if (cityAgrees) reasons.push('city')

  // A hard contradiction outranks any amount of agreement. Two salons in one
  // small chain can share a name and a city; they do not share a phone number.
  if (phoneConflicts) {
    return { matched: false, reasons, rejection: 'phone_conflict' }
  }
  if (postcodeConflicts && !phoneAgrees) {
    return { matched: false, reasons, rejection: 'postal_code_conflict' }
  }

  if (phoneAgrees) {
    return { matched: true, reasons, rejection: null }
  }
  if (postcodeAgrees && nameAgrees) {
    return { matched: true, reasons, rejection: null }
  }
  if (nameAgrees && cityAgrees) {
    return { matched: true, reasons, rejection: null }
  }

  return {
    matched: false,
    reasons,
    rejection: reasons.length === 0 ? 'no_corroborating_signal' : 'ambiguous',
  }
}

/**
 * Names agree when one contains the other after normalisation.
 *
 * Containment rather than equality because Planity listings routinely carry a
 * suffix the registry name does not ("La Loge" vs "La Loge Coiffure"). The
 * >= 3 character floor on both sides stops "Le" matching everything.
 */
function namesAgree(a: string, b: string): boolean {
  if (a === b) return true
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  return shorter.length >= 4 && longer.includes(shorter)
}

function normalizePostcode(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}
