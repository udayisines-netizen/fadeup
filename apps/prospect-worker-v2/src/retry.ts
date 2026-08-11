/**
 * Retry classification + backoff. The classification decides retryable vs
 * terminal (see spec: "do not endlessly retry invalid credentials, bad
 * request, or permission failure" — those go straight to `failed`
 * regardless of attempts remaining). Backoff is exponential with full
 * jitter (Marc Brooker's "Exponential Backoff And Jitter" AWS post) —
 * avoids every retrying job waking up at exactly the same instant.
 */

export interface ClassifiedError {
  retryable: boolean
  reason: string
}

/** HTTP status code (if any) + error → retryable/terminal classification. */
export function classifyError(error: unknown, statusCode?: number): ClassifiedError {
  if (statusCode === 401 || statusCode === 403) {
    return { retryable: false, reason: 'invalid credentials or permission denied' }
  }
  if (statusCode === 400 || statusCode === 404 || statusCode === 422) {
    return { retryable: false, reason: 'bad request — will not succeed on retry' }
  }
  if (statusCode === 429) {
    return { retryable: true, reason: 'rate limited' }
  }
  if (statusCode !== undefined && statusCode >= 500) {
    return { retryable: true, reason: `upstream server error (${statusCode})` }
  }

  if (error instanceof Error) {
    const name = error.name
    if (name === 'AbortError' || name === 'TimeoutError') {
      return { retryable: true, reason: 'timeout' }
    }
    // Node's fetch throws TypeError for network-level failures (DNS, connection reset, ...).
    if (name === 'TypeError' || /network|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(error.message)) {
      return { retryable: true, reason: 'temporary network error' }
    }
  }

  // Unknown failure shape — default to retryable so a transient issue we
  // failed to classify doesn't silently become permanent, but max_attempts
  // still bounds the damage.
  return { retryable: true, reason: 'unclassified error' }
}

export interface BackoffOptions {
  baseMs?: number
  maxMs?: number
  attempt: number
}

/** Full-jitter exponential backoff: random(0, min(maxMs, baseMs * 2^attempt)). */
export function computeBackoffMs({ baseMs = 1000, maxMs = 5 * 60_000, attempt }: BackoffOptions): number {
  const cap = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt))
  return Math.floor(Math.random() * cap)
}

export function computeNextAttemptAt(attempt: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + computeBackoffMs({ attempt }))
}
