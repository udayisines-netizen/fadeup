import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { QuestionScreen } from '@/features/onboarding/QuestionScreen'
import { draft } from '@/features/onboarding/draft'
import { color, font, fontSize, radius } from '@/shared/theme/tokens'

/** Question 1/3 — le prénom (→ customer_profiles.display_name en M1b). */
export default function OnboardingName() {
  const { t } = useTranslation('v2')
  const router = useRouter()
  const [name, setName] = useState(draft.firstName ?? '')

  const advance = (value: string | null) => {
    draft.firstName = value && value.trim().length > 0 ? value.trim() : null
    router.push('/gender')
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <QuestionScreen
        step={1}
        title={t('mobile.onboarding.name.title')}
        why={t('mobile.onboarding.name.why')}
        nextLabel={t('mobile.onboarding.next')}
        nextDisabled={name.trim().length === 0}
        onNext={() => advance(name)}
        onSkip={() => advance(null)}
      >
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t('mobile.onboarding.name.placeholder')}
          placeholderTextColor={color.textTertiary}
          autoFocus
          autoCapitalize="words"
          autoComplete="given-name"
          returnKeyType="next"
          onSubmitEditing={() => {
            if (name.trim().length > 0) advance(name)
          }}
          accessibilityLabel={t('mobile.onboarding.name.title')}
          style={styles.input}
        />
      </QuestionScreen>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  input: {
    minHeight: 56,
    paddingHorizontal: 16,
    borderRadius: radius.card,
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.border,
    fontFamily: font.medium,
    fontSize: fontSize.lg,
    color: color.textPrimary,
  },
})
