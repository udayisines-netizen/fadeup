import { Image, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'
import { FuText } from '@/shared/ui/Text'
import { Button } from '@/shared/ui/Button'
import { color, spacing } from '@/shared/theme/tokens'
import { usePrefersReducedMotion } from '@/shared/hooks/usePrefersReducedMotion'
import { useOnboardingGate } from '@/features/onboarding/gate'
import { completeOnboarding } from '@/features/onboarding/complete'

/**
 * Accueil de l'onboarding — le logo (seul dégradé de l'interface), la
 * promesse, et deux chemins : répondre, ou explorer directement. Jamais un
 * mur (M1a §7).
 */
export default function OnboardingWelcome() {
  const { t } = useTranslation('v2')
  const router = useRouter()
  const reduced = usePrefersReducedMotion()
  const { markOnboarded } = useOnboardingGate()

  const enter = (delay: number) =>
    reduced ? FadeIn.duration(90) : FadeInDown.springify().stiffness(420).damping(36).delay(delay)

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <Animated.View entering={enter(0)} style={styles.brand}>
          <Image
            source={require('../../../assets/images/icon.png')}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="FadeUp"
          />
        </Animated.View>
        <Animated.View entering={enter(80)}>
          <FuText variant="display" style={styles.center}>
            {t('mobile.onboarding.welcome.title')}
          </FuText>
          <FuText variant="body" tone="secondary" style={[styles.center, styles.subtitle]}>
            {t('mobile.onboarding.welcome.subtitle')}
          </FuText>
        </Animated.View>
      </View>
      <Animated.View entering={enter(160)} style={styles.footer}>
        <Button
          label={t('mobile.onboarding.start')}
          size="lg"
          fullWidth
          onPress={() => router.push('/name')}
        />
        <Button
          label={t('mobile.onboarding.skipAll')}
          variant="ghost"
          fullWidth
          onPress={() => {
            void completeOnboarding(markOnboarded)
          }}
        />
      </Animated.View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing(6) },
  brand: { marginBottom: spacing(8) },
  logo: { width: 96, height: 96 },
  center: { textAlign: 'center' },
  subtitle: { marginTop: spacing(3) },
  footer: { paddingHorizontal: spacing(5), paddingBottom: spacing(2), gap: spacing(2) },
})
