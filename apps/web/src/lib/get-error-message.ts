/**
 * Extracts a human-readable message from a thrown value.
 *
 * `error instanceof Error` is NOT sufficient to detect Supabase errors:
 * `.rpc()`/`.from(...).select()` etc. resolve `{ error }` as a PostgrestError
 * whose TypeScript type extends `Error`, but the object actually returned at
 * runtime by @supabase/supabase-js is a plain object — `instanceof Error` is
 * `false` for it (verified directly against a live RPC error response).
 * Every callsite that used `error instanceof Error ? error.message : '...'`
 * was silently discarding the real RLS/constraint/RAISE EXCEPTION message
 * and always falling back to the generic string, including "friendly error"
 * mappers (e.g. detecting a specific constraint name in the message) that
 * never actually matched anything in production. Checking for a string
 * `message` property instead of using `instanceof` covers both real `Error`
 * instances and Supabase's error shape.
 */
export function getErrorMessage(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return undefined
}
