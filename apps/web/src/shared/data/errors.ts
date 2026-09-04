/**
 * Error mapping for the whole V2 data layer: every raw failure (Supabase,
 * PostgREST, fetch) becomes ONE closed union the UI can translate. Raw
 * backend messages ("Invalid login credentials", "new row violates…") never
 * reach a user.
 */

export type AppError =
  | { kind: 'network' }
  | { kind: 'auth' }
  | { kind: 'forbidden' } // 42501 — RLS
  | { kind: 'conflict'; detail: string } // 23505
  | { kind: 'validation'; field?: string; detail: string } // 23514
  | { kind: 'not-found' }
  | { kind: 'unknown'; raw: unknown }

interface PostgrestLikeError {
  code?: string
  message?: string
  details?: string
  status?: number
}

function asPostgrestLike(raw: unknown): PostgrestLikeError | null {
  if (typeof raw !== 'object' || raw === null) return null
  return raw as PostgrestLikeError
}

/**
 * A `42501` means an RLS policy refused the row. That is almost never an RLS
 * bug — it is a call that should not have been made from this session. The
 * user-facing message says "no access", never the policy detail.
 */
export function toAppError(raw: unknown): AppError {
  if (raw instanceof TypeError) {
    // fetch() network failures surface as TypeError in every browser.
    return { kind: 'network' }
  }

  const err = asPostgrestLike(raw)
  if (err) {
    const message = err.message ?? ''
    if (err.code === '42501') return { kind: 'forbidden' }
    if (err.code === '23505') return { kind: 'conflict', detail: err.details ?? message }
    if (err.code === '23514') return { kind: 'validation', detail: err.details ?? message }
    if (err.code === 'PGRST116') return { kind: 'not-found' }
    if (err.status === 401 || err.code === '401') return { kind: 'auth' }
    if (err.status === 403) return { kind: 'forbidden' }
    if (err.status === 404) return { kind: 'not-found' }
    if (/JWT|token|session/i.test(message) && (err.status === 401 || err.code === 'PGRST301')) {
      return { kind: 'auth' }
    }
    if (/Failed to fetch|NetworkError|fetch failed/i.test(message)) {
      return { kind: 'network' }
    }
  }

  return { kind: 'unknown', raw }
}

/** i18n key (namespace `v2`) for an AppError — the UI translates, never echoes. */
export function errorMessageKey(error: AppError): string {
  switch (error.kind) {
    case 'network':
      return 'errors.data.network'
    case 'auth':
      return 'errors.data.auth'
    case 'forbidden':
      return 'errors.data.forbidden'
    case 'conflict':
      return 'errors.data.conflict'
    case 'validation':
      return 'errors.data.validation'
    case 'not-found':
      return 'errors.data.notFound'
    case 'unknown':
      return 'errors.data.unknown'
  }
}
