import { getSupabaseClient } from '@/lib/supabase'
import { safeInternalPath } from '@/lib/safe-redirect'

/**
 * Google and Apple sign-in for FadeUp.
 *
 * ONE Supabase Auth instance, ONE auth.users namespace, ONE provider
 * configuration — shared by /login, /register, /pro/login, /pro/register and
 * /platform/login. There is deliberately no per-surface provider app and no
 * "customer Google" versus "platform Google": a FadeUp identity is a single
 * auth.users row that may simultaneously be a customer, a professional, a
 * business owner and platform staff.
 *
 * Signing in with Google or Apple proves WHO someone is. It grants nothing.
 * What they may do is decided entirely by the database — platform_members
 * for platform access, memberships for professional access — and re-checked
 * server-side on every request by RLS. See get_my_access() in
 * db/migrations/20260818210000_identity_and_access_resolution.sql.
 */

export type OAuthProvider = 'google' | 'apple'

export const OAUTH_PROVIDERS: OAuthProvider[] = ['google', 'apple']

/**
 * Which door someone came through. Carried across the provider round trip so
 * the callback can prefer the workspace they were actually asking for when
 * their identity has more than one.
 *
 * This is a PREFERENCE, never a permission. Arriving with intent='platform'
 * does not make anybody platform staff; if the database says they are not,
 * the callback sends them somewhere else. Test coverage for exactly that is
 * in auth-callback-page.test.tsx.
 */
export type AuthIntent = 'customer' | 'pro' | 'platform'

export const AUTH_INTENTS: AuthIntent[] = ['customer', 'pro', 'platform']

export function parseAuthIntent(value: string | null | undefined): AuthIntent | null {
  return AUTH_INTENTS.includes(value as AuthIntent) ? (value as AuthIntent) : null
}

/** The single route every provider redirect comes back to. */
export const OAUTH_CALLBACK_PATH = '/auth/callback'

/**
 * Builds the absolute URL Supabase sends the browser back to after the
 * provider round trip.
 *
 * `next` is validated with the same safeInternalPath used everywhere else
 * BEFORE it is attached, so a crafted `?redirect=https://evil.example` is
 * dropped here rather than being handed to the provider and echoed back as a
 * real navigation target. The callback validates it a second time on arrival
 * — the value travels through systems we do not control in between.
 */
export function buildOAuthRedirectUrl(options: { intent: AuthIntent; next?: string | null }): string {
  const url = new URL(OAUTH_CALLBACK_PATH, window.location.origin)
  url.searchParams.set('intent', options.intent)

  const next = safeInternalPath(options.next)
  if (next) url.searchParams.set('next', next)

  return url.toString()
}

export interface StartOAuthOptions {
  provider: OAuthProvider
  intent: AuthIntent
  /** Optional internal path to return to; anything external is discarded. */
  next?: string | null
}

/**
 * Starts the provider redirect. Resolves only if it FAILED — on success the
 * browser has already navigated away.
 *
 * No provider secret is involved: the client only ever names the provider,
 * and GoTrue holds the client id and secret server-side. That is why
 * enabling a provider is an infrastructure change (infra/supabase/.env) and
 * never a frontend one.
 */
export async function startOAuth({ provider, intent, next }: StartOAuthOptions): Promise<void> {
  const supabase = getSupabaseClient()

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: buildOAuthRedirectUrl({ intent, next }),
      // Apple returns the user's name at most once, on the very first
      // authorization, and only with the name scope requested. Asking for it
      // is worth doing; NOT getting it is a normal outcome, not an error —
      // handle_new_user() stores NULL and onboarding asks later.
      ...(provider === 'apple' ? { scopes: 'name email' } : {}),
    },
  })

  if (error) throw error
}
