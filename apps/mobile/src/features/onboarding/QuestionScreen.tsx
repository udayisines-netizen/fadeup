import { type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'
import { FuText } from '@/shared/ui/Text'
import { Button } from '@/shared/ui/Button'
import { color, spacing, touchTarget } from '@/shared/theme/tokens'
import { usePrefersReducedMotion } from '@/shared/hooks/usePrefersReducedMotion'
export { OptionRow } from '@/shared/ui/OptionRow'

/**
 * Gabarit d'une question d'onboarding — une question PAR ÉCRAN, progression
 * visible, passable (M1a §7 : une personnalisation, pas un formulaire).
 * Apparition décalée (D1 §8) ; fondus seuls sous réduction d'animations.
 */

export const TOTAL_STEPS = 3

export interface QuestionScreenProps {
  step: 1 | 2 | 3
  title: string
  why: string
  children: ReactNode
  nextLabel: string
  nextDisabled?: boolean
  onNext: () => void
  onSkip: () => void
}

function Progress({ step }: { step: number }) {
  const { t } = useTranslation('v2')
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={t('mobile.onboarding.progress', { step, total: TOTAL_STEPS })}
      style={styles.progressRow}
    >
      {Array.from({ length: TOTAL_STEPS }, (_, index) => (
        <View
          key={index}
          style={[styles.progressSegment, index < step ? styles.progressDone : styles.progressTodo]}
        />
      ))}
    </View>
  )
}

export function QuestionScreen({
  step,
  title,
  why,
  children,
  nextLabel,
  nextDisabled = false,
  onNext,
  onSkip,
}: QuestionScreenProps) {
  const { t } = useTranslation('v2')
  const reduced = usePrefersReducedMotion()

  const enter = (delay: number) =>
    reduced ? FadeIn.duration(90) : FadeInDown.springify().stiffness(420).damping(36).delay(delay)

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Progress step={step} />
        <Pressable
          accessibilityRole="button"
          onPress={onSkip}
          hitSlop={8}
          style={styles.skip}
        >
          <FuText variant="smMedium" tone="secondary">
            {t('mobile.onboarding.skip')}
          </FuText>
        </Pressable>
      </View>

      <View style={styles.body}>
        <Animated.View entering={enter(0)}>
          <FuText variant="heading">{title}</FuText>
          <FuText variant="sm" tone="secondary" style={styles.why}>
            {why}
          </FuText>
        </Animated.View>
        <Animated.View entering={enter(60)} style={styles.answers}>
          {children}
        </Animated.View>
      </View>

      <Animated.View entering={enter(120)} style={styles.footer}>
        <Button label={nextLabel} size="lg" fullWidth disabled={nextDisabled} onPress={onNext} />
      </Animated.View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing(5),
    paddingTop: spacing(2),
    gap: spacing(4),
  },
  progressRow: { flexDirection: 'row', gap: spacing(1.5), flex: 1, maxWidth: 160 },
  progressSegment: { flex: 1, height: 4, borderRadius: 2 },
  progressDone: { backgroundColor: color.accent },
  progressTodo: { backgroundColor: color.border },
  skip: { minHeight: touchTarget, justifyContent: 'center' },
  body: { flex: 1, paddingHorizontal: spacing(5), paddingTop: spacing(8) },
  why: { marginTop: spacing(2) },
  answers: { marginTop: spacing(6), gap: spacing(2.5) },
  footer: { paddingHorizontal: spacing(5), paddingBottom: spacing(2) },
})
