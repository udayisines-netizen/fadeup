/**
 * The analytics session handle.
 *
 * WHAT THIS IS: a random opaque string, generated fresh per browser tab
 * session, held in sessionStorage, used ONLY so that "roughly how many
 * different anonymous people looked at this shop" is answerable in aggregate
 * (§13).
 *
 * WHAT THIS IS NOT, DELIBERATELY:
 *
 *  - Not a device identifier. Nothing about the device contributes to it: no
 *    user agent, no screen size, no canvas, no font list, no timezone. §12
 *    forbids invasive fingerprinting, and the way that rule gets broken is
 *    never on purpose — it is by deriving a "stable id" from things that
 *    happen to be stable.
 *  - Not persistent. sessionStorage, not localStorage: it dies with the tab.
 *    A handle that outlives the visit is a tracking identifier that outlives
 *    consent, which docs/v2/ANALYTICS_DRAFT.md §7 raised as an open question
 *    and this answers by not creating one.
 *  - Never joined to an account. The server stores it beside actor_user_id but
 *    no read contract in R3 projects either, and the aggregation functions
 *    count DISTINCT session_id only for rows where actor_user_id IS NULL.
 *
 * The consequence — one person across two days counts as two sessions — is
 * accepted and documented rather than engineered away. The alternative is
 * exactly the durable identifier this refuses to create.
 */

const STORAGE_KEY = 'fadeup.analytics.session'

/** Matches the database's `session_id` length constraint (8..64). */
function generateSessionId(): string {
  const cryptoRef = globalThis.crypto

  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID().replace(/-/g, '')
  }

  if (cryptoRef && typeof cryptoRef.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    cryptoRef.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  // Last resort. Weak randomness only degrades the precision of a
  // distinct-sessions estimate; it can never leak anything, because there is
  // nothing personal in the input.
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.padEnd(24, '0').slice(0, 32)
}

/**
 * Returns this tab's analytics session handle, creating one on first use.
 * Returns null when storage is unavailable — a private-mode browser, a
 * server render, a locked-down embed — and the caller simply sends no
 * session, which costs an estimate and breaks nothing.
 */
export function getAnalyticsSessionId(): string | null {
  try {
    const storage = globalThis.sessionStorage
    if (!storage) return null

    const existing = storage.getItem(STORAGE_KEY)
    if (existing && existing.length >= 8 && existing.length <= 64) {
      return existing
    }

    const fresh = generateSessionId()
    storage.setItem(STORAGE_KEY, fresh)
    return fresh
  } catch {
    // sessionStorage throws rather than returning null under some privacy
    // settings. Analytics never gets to be the reason a page fails to render.
    return null
  }
}

/** Test seam, and the hook a future "clear my data" control would call. */
export function resetAnalyticsSessionId(): void {
  try {
    globalThis.sessionStorage?.removeItem(STORAGE_KEY)
  } catch {
    /* nothing to clear */
  }
}
