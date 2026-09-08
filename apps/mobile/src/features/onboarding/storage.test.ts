import { describe, expect, it } from 'vitest'
import { GENDER_ANSWERS, HAIRCUT_FREQUENCIES } from '@/features/onboarding/storage'
import type { Database } from '@/shared/lib/database.types'

/**
 * Les valeurs locales de fréquence DOIVENT rester l'enum base
 * `customer_haircut_frequency` tel quel — c'est ce qui permettra à M1b de
 * synchroniser vers customer_profiles sans table de traduction.
 */
describe('onboarding — alignement des valeurs sur les contrats base', () => {
  it('fréquences = enum customer_haircut_frequency, verbatim', () => {
    type DbFrequency = Database['public']['Enums']['customer_haircut_frequency']
    // Assignabilité dans les deux sens : toute dérive casse la compilation.
    const toDb: readonly DbFrequency[] = HAIRCUT_FREQUENCIES
    expect(toDb).toEqual(['weekly', 'every_2_weeks', 'every_3_weeks', 'monthly', 'less_often', 'depends'])
  })

  it("genre : « peu importe » est une réponse à part entière (aucune colonne base — manque déclaré)", () => {
    expect(GENDER_ANSWERS).toContain('no_preference')
  })
})
