import { useState } from 'react'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { OptionRow, QuestionScreen } from '@/features/onboarding/QuestionScreen'
import { draft } from '@/features/onboarding/draft'
import { GENDER_ANSWERS, type GenderAnswer } from '@/features/onboarding/storage'

/**
 * Question 2/3 — le genre, OPTIONNEL, avec « peu importe » (M1a §7).
 * Finalité déclarée à l'écran (donnée personnelle) ; AUCUNE colonne en base
 * aujourd'hui — stockage local seulement, manque déclaré au rapport.
 */
export default function OnboardingGender() {
  const { t } = useTranslation('v2')
  const router = useRouter()
  const [gender, setGender] = useState<GenderAnswer | null>(draft.gender)

  const advance = (value: GenderAnswer | null) => {
    draft.gender = value
    router.push('/frequency')
  }

  const labels: Record<GenderAnswer, string> = {
    man: t('mobile.onboarding.gender.man'),
    woman: t('mobile.onboarding.gender.woman'),
    no_preference: t('mobile.onboarding.gender.noPreference'),
  }

  return (
    <QuestionScreen
      step={2}
      title={t('mobile.onboarding.gender.title')}
      why={t('mobile.onboarding.gender.why')}
      nextLabel={t('mobile.onboarding.next')}
      nextDisabled={gender === null}
      onNext={() => advance(gender)}
      onSkip={() => advance(null)}
    >
      {GENDER_ANSWERS.map((value) => (
        <OptionRow
          key={value}
          label={labels[value]}
          selected={gender === value}
          onPress={() => setGender(value)}
        />
      ))}
    </QuestionScreen>
  )
}
