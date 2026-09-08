import { getSupabase } from '@/shared/lib/supabase'

/**
 * Inscription légère DANS le tunnel — le motif F1b (join de file), repris tel
 * quel : un e-mail → un code à six chiffres → GoTrue pose la session dans le
 * même onglet, sans navigation ni rechargement. B2 a rendu l'envoi réel
 * (Resend). Dupliqué de features/queue/api/lightAuth.ts parce qu'une feature
 * n'importe jamais une autre feature (P1 §17) — deux fonctions, pas une
 * abstraction.
 */

export async function requestBookingOtp(email: string): Promise<{ ok: boolean }> {
  const { error } = await getSupabase().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  })
  return { ok: !error }
}

export async function verifyBookingOtp(email: string, code: string): Promise<{ ok: boolean }> {
  const { error } = await getSupabase().auth.verifyOtp({
    email,
    token: code,
    type: 'email',
  })
  return { ok: !error }
}
