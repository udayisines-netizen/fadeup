import { getSupabase } from '@/shared/lib/supabase'

/**
 * L'e-mail de la session COURANTE, lu au client Supabase à l'instant du
 * geste — pas à l'état React.
 *
 * Motif : quand la session vient d'être posée (code e-mail, ou retour de
 * Google), `onAuthStateChange` n'a pas encore traversé le contexte ; la
 * `session` capturée par le rendu en cours est PÉRIMÉE. Envoyer la
 * réservation avec cet e-mail-là, c'est l'envoyer sans e-mail — et se faire
 * refuser sur `missing_contact` alors que tout était bon.
 *
 * Le client Supabase, lui, détient déjà la nouvelle session : c'est lui la
 * source de vérité à cet instant précis.
 */
export async function currentSessionEmail(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession()
  return data.session?.user.email ?? null
}
