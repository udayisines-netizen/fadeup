import { draft, resetDraft } from '@/features/onboarding/draft'
import { saveOnboarding } from '@/features/onboarding/storage'

/**
 * Termine l'onboarding : persiste les réponses (y compris toutes nulles si
 * tout a été passé) puis referme la porte — le résultat s'affiche
 * IMMÉDIATEMENT (l'accueil), jamais un écran de connexion (M1a §7).
 */
export async function completeOnboarding(markOnboarded: () => void): Promise<void> {
  await saveOnboarding({
    firstName: draft.firstName,
    gender: draft.gender,
    frequency: draft.frequency,
  })
  resetDraft()
  markOnboarded()
}
