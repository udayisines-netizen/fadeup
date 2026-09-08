import type { GenderAnswer, HaircutFrequency } from '@/features/onboarding/storage'

/**
 * Brouillon d'onboarding — l'état des trois réponses PENDANT le flux
 * (module simple : le flux est linéaire, court, et jamais re-monté en
 * parallèle). La persistance n'a lieu qu'à la fin (storage.saveOnboarding).
 */
export interface OnboardingDraft {
  firstName: string | null
  gender: GenderAnswer | null
  frequency: HaircutFrequency | null
}

export const draft: OnboardingDraft = {
  firstName: null,
  gender: null,
  frequency: null,
}

export function resetDraft(): void {
  draft.firstName = null
  draft.gender = null
  draft.frequency = null
}
