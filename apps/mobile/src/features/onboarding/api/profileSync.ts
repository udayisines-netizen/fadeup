/**
 * M1b — la synchronisation onboarding local → `customer_profiles`, le point
 * n°1 laissé par M1a (rapport §13.1). À la première session :
 *
 *  - `firstName` → `display_name`, `frequency` → `haircut_frequency`
 *    (valeurs enum VERBATIM, verrouillées par storage.test.ts) ;
 *  - `completedAt` → `onboarding_completed_at` ;
 *  - `gender` reste LOCAL — aucune colonne en base (manque déclaré M1a §12).
 *
 * `upsert` sur `user_id`, jamais `update` : la ligne n'existe pas tant que le
 * client n'a pas touché l'app cliente (état légitime). Effet de bord assumé
 * et documenté en base : créer la ligne émet le Fade Passport (trigger
 * `customer_profiles_issue_passport` — « devenir client FadeUp, C'EST avoir
 * un Passport »).
 *
 * La synchro ne REMPLIT que les trous : un profil déjà nommé en base n'est
 * jamais écrasé par la réponse locale d'onboarding.
 */
import { getSupabase } from '@/shared/lib/supabase'
import { readOnboarding } from '../storage'

export async function syncOnboardingToCustomerProfile(): Promise<void> {
  const answers = await readOnboarding()
  if (!answers) return
  const supabase = getSupabase()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return

  const { data: existing, error: readError } = await supabase
    .from('customer_profiles')
    .select('id, display_name, haircut_frequency, onboarding_completed_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (readError) return

  const patch = {
    user_id: userId,
    display_name: existing?.display_name ?? answers.firstName,
    haircut_frequency: existing?.haircut_frequency ?? answers.frequency,
    onboarding_completed_at: existing?.onboarding_completed_at ?? answers.completedAt,
  }
  // Rien à écrire si la base est déjà complète.
  if (
    existing &&
    existing.display_name === patch.display_name &&
    existing.haircut_frequency === patch.haircut_frequency &&
    existing.onboarding_completed_at === patch.onboarding_completed_at
  ) {
    return
  }
  await supabase.from('customer_profiles').upsert(patch, { onConflict: 'user_id' })
}
