import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Réponses d'onboarding — stockées LOCALEMENT (M1a §7).
 *
 * Pourquoi local : M1a n'a aucune connexion (elle arrive en M1b — « aucun mur
 * de connexion »), il n'existe donc aucun compte où écrire. Les VALEURS sont
 * alignées sur les contrats base pour que M1b synchronise sans traduction :
 *   - `firstName`  → `customer_profiles.display_name` ;
 *   - `frequency`  → `customer_profiles.haircut_frequency`
 *     (enum customer_haircut_frequency, valeurs reprises telles quelles) ;
 *   - `gender`     → AUCUNE COLONNE en base (mesuré sur customer_profiles —
 *     manque déclaré au rapport M1a) : local jusqu'à un contrat.
 *
 * `null` = question passée — une réponse absente n'est jamais inventée.
 */

export const HAIRCUT_FREQUENCIES = [
  'weekly',
  'every_2_weeks',
  'every_3_weeks',
  'monthly',
  'less_often',
  'depends',
] as const
export type HaircutFrequency = (typeof HAIRCUT_FREQUENCIES)[number]

export const GENDER_ANSWERS = ['man', 'woman', 'no_preference'] as const
export type GenderAnswer = (typeof GENDER_ANSWERS)[number]

export interface OnboardingAnswers {
  firstName: string | null
  gender: GenderAnswer | null
  frequency: HaircutFrequency | null
  /** ISO — l'onboarding a été terminé (ou passé en entier). */
  completedAt: string
}

const STORAGE_KEY = 'fu.onboarding.v1'

export async function readOnboarding(): Promise<OnboardingAnswers | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const answers = parsed as Partial<OnboardingAnswers>
    if (typeof answers.completedAt !== 'string') return null
    return {
      firstName: typeof answers.firstName === 'string' ? answers.firstName : null,
      gender: GENDER_ANSWERS.includes(answers.gender as GenderAnswer) ? (answers.gender as GenderAnswer) : null,
      frequency: HAIRCUT_FREQUENCIES.includes(answers.frequency as HaircutFrequency)
        ? (answers.frequency as HaircutFrequency)
        : null,
      completedAt: answers.completedAt,
    }
  } catch {
    return null
  }
}

export async function saveOnboarding(answers: Omit<OnboardingAnswers, 'completedAt'>): Promise<void> {
  try {
    const record: OnboardingAnswers = { ...answers, completedAt: new Date().toISOString() }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    /* le stockage n'est jamais bloquant : l'app reste utilisable sans */
  }
}
