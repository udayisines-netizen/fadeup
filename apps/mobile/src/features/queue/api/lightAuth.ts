import { getSupabase } from '@/shared/lib/supabase'

/**
 * Inscription ultra-légère du flux de file : un e-mail, un code à usage
 * unique, pas de mot de passe (MASTER_SPEC §6, canal d'envoi B2). Le client
 * Supabase reste confiné aux modules api des features — les composants
 * passent ici.
 */

export async function requestQueueOtp(email: string): Promise<{ ok: boolean }> {
  const { error } = await getSupabase().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  })
  return { ok: !error }
}

export async function verifyQueueOtp(email: string, code: string): Promise<{ ok: boolean }> {
  const { error } = await getSupabase().auth.verifyOtp({ email, token: code, type: 'email' })
  return { ok: !error }
}
