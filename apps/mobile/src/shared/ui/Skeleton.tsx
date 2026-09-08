import { useEffect } from 'react'
import { type DimensionValue, type ViewStyle } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { color, radius } from '@/shared/theme/tokens'
import { usePrefersReducedMotion } from '@/shared/hooks/usePrefersReducedMotion'

/** Attente de chargement — pulsation d'opacité (pas de translation :
 *  inoffensive sous réduction d'animations, on la garde fixe alors). */
export function Skeleton({ width = '100%', height = 16, style }: { width?: DimensionValue; height?: number; style?: ViewStyle }) {
  const reduced = usePrefersReducedMotion()
  const pulse = useSharedValue(0.6)

  useEffect(() => {
    if (!reduced) {
      pulse.value = withRepeat(withTiming(1, { duration: 700 }), -1, true)
    }
  }, [reduced, pulse])

  const animated = useAnimatedStyle(() => ({ opacity: reduced ? 0.7 : pulse.value }))

  return (
    <Animated.View
      accessibilityElementsHidden
      style={[
        { width, height, borderRadius: radius.control, backgroundColor: color.surfaceSubtle },
        animated,
        style,
      ]}
    />
  )
}
