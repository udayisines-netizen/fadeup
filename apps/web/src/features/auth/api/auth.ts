import { getSupabase } from '@/shared/lib/supabase'

/**
 * L'API d'authentification V2 — le SEUL endroit du feature auth qui touche
 * le client Supabase. Chaque échec devient une clé i18n actionnable ; le
 * texte brut de GoTrue (« Invalid login credentials ») ne remonte jamais.
 */

interface AuthErrorLike {
  code?: string
  status?: number
  message?: string
}

/** Clé v2:auth.errors.* pour une erreur GoTrue. */
export function authErrorKey(raw: unknown): string {
  const err = (typeof raw === 'object' && raw !== null ? raw : {}) as AuthErrorLike
  const code = err.code ?? ''
  const message = err.message ?? ''

  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) return 'auth.errors.invalidCredentials'
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) return 'auth.errors.emailNotConfirmed'
  if (code === 'user_already_exists' || code === 'email_exists' || /already registered/i.test(message))
    return 'auth.errors.userExists'
  if (code === 'weak_password' || /password should be/i.test(message)) return 'auth.errors.weakPassword'
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || err.status === 429)
    return 'auth.errors.rateLimited'
  if (code === 'otp_expired' || /token has expired/i.test(message)) return 'auth.errors.otpExpired'
  if (code === 'otp_disabled' || /invalid|not found/i.test(message)) return 'auth.errors.otpInvalid'
  if (/error sending|smtp|email/i.test(message) && err.status === 500) return 'auth.errors.emailSendFailed'
  return 'auth.errors.generic'
}

function callbackUrl(redirect?: string | null): string {
  const base = `${window.location.origin}/auth/callback`
  return redirect ? `${base}?redirect=${encodeURIComponent(redirect)}` : base
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signUpWithPassword(email: string, password: string, redirect?: string | null): Promise<void> {
  const { error } = await getSupabase().auth.signUp({
    email,
    password,
    options: { emailRedirectTo: callbackUrl(redirect) },
  })
  if (error) throw error
}

/** Lien magique (l'e-mail GoTrue contient aussi le code OTP à 6 chiffres). */
export async function sendMagicLink(email: string, redirect?: string | null): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callbackUrl(redirect) },
  })
  if (error) throw error
}

export async function verifyEmailOtp(email: string, token: string): Promise<void> {
  const { error } = await getSupabase().auth.verifyOtp({ email, token, type: 'email' })
  if (error) throw error
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/reset`,
  })
  if (error) throw error
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await getSupabase().auth.updateUser({ password })
  if (error) throw error
}

export async function hasOpenSession(): Promise<boolean> {
  const { data } = await getSupabase().auth.getSession()
  return Boolean(data.session)
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut()
  if (error) throw error
}

/**
 * Destination post-connexion quand aucune destination initiale n'existe :
 * `/dashboard` pour un professionnel, `/` sinon (`get_my_access`).
 */
export async function resolveDestination(): Promise<string> {
  try {
    const { data, error } = await getSupabase().rpc('get_my_access')
    if (error) return '/'
    const row = Array.isArray(data) ? data[0] : data
    return row?.professional_available ? '/dashboard' : '/'
  } catch {
    return '/'
  }
}
