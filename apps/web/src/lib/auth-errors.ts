import { getErrorMessage } from '@/lib/get-error-message'

/**
 * Turns a Supabase Auth failure into something a FadeUp visitor can act on.
 *
 * The case that made this necessary: someone who already has a FadeUp account
 * starts the professional journey, reaches a create-account form, and is shown
 * the raw string
 *
 *     "User already registered"
 *
 * which tells them they have an account but not what to do about it, and reads
 * like a bug rather than a signpost. Worse, it is a dead end in the middle of
 * a flow they were part-way through.
 *
 * The kinds below map to translated copy in the `auth` namespace, and
 * `alreadyRegistered` additionally drives a "sign in instead" affordance that
 * PRESERVES where the person was heading.
 *
 * On enumeration: mapping this particular error reveals nothing Supabase was
 * not already returning to the same unauthenticated caller — the address is
 * one the visitor just typed, and the answer is the one they need. What this
 * deliberately does NOT do is say which provider the existing account uses,
 * which really would be new information about somebody else's account.
 */
export type AuthErrorKind =
  | 'alreadyRegistered'
  | 'invalidCredentials'
  | 'emailNotConfirmed'
  | 'rateLimited'
  | 'weakPassword'
  | 'unknown'

/**
 * GoTrue's wording has changed across versions and is not localized, so this
 * matches on stable substrings rather than exact equality. `unknown` falls
 * back to the original message: a wrong guess that swallowed a real error
 * would be worse than showing it.
 */
export function classifyAuthError(error: unknown): AuthErrorKind {
  const message = (getErrorMessage(error) ?? '').toLowerCase()
  if (!message) return 'unknown'

  if (
    message.includes('already registered') ||
    message.includes('already been registered') ||
    message.includes('user already exists')
  ) {
    return 'alreadyRegistered'
  }
  if (message.includes('invalid login credentials') || message.includes('invalid credentials')) {
    return 'invalidCredentials'
  }
  if (message.includes('email not confirmed') || message.includes('not confirmed')) {
    return 'emailNotConfirmed'
  }
  if (message.includes('rate limit') || message.includes('too many requests')) {
    return 'rateLimited'
  }
  if (message.includes('password should be') || message.includes('weak password')) {
    return 'weakPassword'
  }
  return 'unknown'
}

/** True when the failure means "this identity exists, sign in instead". */
export function isAlreadyRegistered(error: unknown): boolean {
  return classifyAuthError(error) === 'alreadyRegistered'
}

/**
 * The `auth` translation key for a classified failure, or null for `unknown`
 * — where the caller should show the provider's own message rather than
 * inventing one.
 */
export function authErrorKey(kind: AuthErrorKind): string | null {
  return kind === 'unknown' ? null : `errors.${kind}`
}
