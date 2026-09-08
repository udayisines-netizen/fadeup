/**
 * M1b — l'auth légère du mobile. Trois pièces :
 *
 *  - `useSession()` : LA source de vérité de session de l'app (getSession +
 *    onAuthStateChange, partagée par contexte depuis la racine) ;
 *  - OTP e-mail : le motif F1b/F4 repris verbatim du web — un e-mail, un code
 *    à six chiffres, GoTrue pose la session SUR PLACE, sans navigation. C'est
 *    ce qui garantit que le parcours reprend exactement où il était ;
 *  - Google : `signInWithOAuth` + navigateur système (`expo-web-browser`),
 *    retour par lien profond. Sign in with Apple est M1c — aucune fondation
 *    posée ici, à dessein.
 *
 * Le mappage d'erreurs est celui du web (`features/auth/api/auth.ts`) : le
 * texte brut de GoTrue ne remonte JAMAIS — chaque échec devient une clé i18n.
 */
import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState } from 'react'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'

import { getSupabase } from '@/shared/lib/supabase'

interface AuthErrorLike {
  code?: string
  message?: string
  status?: number
}

/** Copie conforme du mappage web — chaque échec GoTrue devient une clé i18n. */
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

export interface SessionState {
  session: Session | null
  /** false tant que getSession() n'a pas répondu — ne rien affirmer avant. */
  ready: boolean
}

export const SessionContext = createContext<SessionState>({ session: null, ready: false })

/** L'état de session partagé — fourni par la racine, consommé partout. */
export function useSession(): SessionState {
  return useContext(SessionContext)
}

/**
 * Branchement racine : session initiale + abonnement aux changements.
 * Un seul abonnement pour toute l'app (le contexte diffuse).
 */
export function useProvideSession(): SessionState {
  const [state, setState] = useState<SessionState>({ session: null, ready: false })

  useEffect(() => {
    let alive = true
    const supabase = getSupabase()
    void supabase.auth.getSession().then(({ data }) => {
      if (alive) setState({ session: data.session, ready: true })
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) setState({ session, ready: true })
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return state
}

/** Un e-mail → un code à six chiffres (crée le compte au besoin). */
export async function requestEmailOtp(email: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  })
  if (error) throw error
}

/** Le code pose la session sur place — aucune navigation. */
export async function verifyEmailOtp(email: string, code: string): Promise<void> {
  const { error } = await getSupabase().auth.verifyOtp({
    email,
    token: code,
    type: 'email',
  })
  if (error) throw error
}

/**
 * Google via le navigateur système. Le retour passe par le lien profond de
 * l'app (schéma Expo Go en développement, schéma `fadeup` en build). GoTrue
 * doit connaître cette URL de retour (allow-list) — exigence d'exploitation
 * déclarée au rapport M1b, non vérifiable sans appareil.
 */
export async function signInWithGoogle(): Promise<{ ok: boolean }> {
  const supabase = getSupabase()
  const redirectTo = Linking.createURL('auth/callback')
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  })
  if (error) throw error
  if (!data.url) return { ok: false }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
  if (result.type !== 'success') return { ok: false }

  // GoTrue renvoie les jetons dans le fragment (#access_token=…) en flux
  // implicite, ou un `code` en PKCE — on gère les deux, sans rien inventer.
  const url = new URL(result.url)
  const fragment = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
  const accessToken = fragment.get('access_token')
  const refreshToken = fragment.get('refresh_token')
  if (accessToken && refreshToken) {
    const { error: setError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
    if (setError) throw setError
    return { ok: true }
  }
  const code = url.searchParams.get('code')
  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError) throw exchangeError
    return { ok: true }
  }
  return { ok: false }
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut()
  if (error) throw error
}
