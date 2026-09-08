import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OptionRow, QuestionScreen } from '@/features/onboarding/QuestionScreen'
import { draft } from '@/features/onboarding/draft'
import { HAIRCUT_FREQUENCIES, type HaircutFrequency } from '@/features/onboarding/storage'
import { useOnboardingGate } from '@/features/onboarding/gate'
import { completeOnboarding } from '@/features/onboarding/complete'

/**
 * Question 3/3 — la fréquence de coupe. Collectée MAINTENANT même sans usage
 * immédiat (M1a §7 : le rappel de rebooking viendra — sans la donnée, il
 * naîtra aveugle). Valeurs = l'enum customer_haircut_frequency, telles
 * quelles, pour une synchro M1b sans traduction.
 *
 * Puis le RÉSULTAT, immédiatement — la porte se referme, l'accueil s'ouvre.
 */
export default function OnboardingFrequency() {
  const { t } = useTranslation('v2')
  const { markOnboarded } = useOnboardingGate()
  const [frequency, setFrequency] = useState<HaircutFrequency | null>(draft.frequency)

  const finish = (value: HaircutFrequency | null) => {
    draft.frequency = value
    void completeOnboarding(markOnboarded)
  }

  return (
    <QuestionScreen
      step={3}
      title={t('mobile.onboarding.frequency.title')}
      why={t('mobile.onboarding.frequency.why')}
      nextLabel={t('mobile.onboarding.start')}
      nextDisabled={frequency === null}
      onNext={() => finish(frequency)}
      onSkip={() => finish(null)}
    >
      {HAIRCUT_FREQUENCIES.map((value) => (
        <OptionRow
          key={value}
          label={t(`mobile.onboarding.frequency.${value}`)}
          selected={frequency === value}
          onPress={() => setFrequency(value)}
        />
      ))}
    </QuestionScreen>
  )
}
