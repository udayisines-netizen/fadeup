import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from 'react-native'
import { FuText } from '@/shared/ui/Text'
import { color, duration, font, fontSize, radius, touchTarget } from '@/shared/theme/tokens'
import { usePrefersReducedMotion } from '@/shared/hooks/usePrefersReducedMotion'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

/**
 * LE bouton. `primary` = CTA transactionnel dominant : vert plein, ENCRE
 * (#080F0D sur #00C27A, 8,30:1 — blanc sur vert interdit, la loi D1 §0bis).
 * `secondary` = Follow et actions secondaires — jamais vert plein.
 * Pression : scale .985 en 120 ms (D1 §8) ; sous réduction d'animations,
 * aucun scale — l'état pressé passe par l'opacité.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'
export type ButtonSize = 'md' | 'lg'

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
}

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  ...rest
}: ButtonProps) {
  const reduced = usePrefersReducedMotion()
  const pressed = useSharedValue(0)
  const isDisabled = Boolean(disabled) || loading

  const animatedStyle = useAnimatedStyle(() => ({
    transform: reduced ? [] : [{ scale: 1 - pressed.value * 0.015 }],
    opacity: reduced ? 1 - pressed.value * 0.12 : 1,
  }))

  const textColor =
    variant === 'primary' ? color.accentFg : variant === 'ghost' ? color.accentText : color.textPrimary

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: duration.instant })
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, { duration: duration.instant })
      }}
      hitSlop={4}
      {...rest}
    >
      <Animated.View
        style={[
          styles.base,
          size === 'lg' ? styles.lg : styles.md,
          variant === 'primary' && styles.primary,
          variant === 'secondary' && styles.secondary,
          variant === 'ghost' && styles.ghost,
          fullWidth && styles.fullWidth,
          isDisabled && styles.disabled,
          animatedStyle,
        ]}
      >
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={textColor} />
          </View>
        ) : (
          <FuText
            variant={size === 'lg' ? 'bodySemibold' : 'smMedium'}
            style={{ color: textColor, fontFamily: font.semibold, fontSize: size === 'lg' ? fontSize.base : fontSize.sm }}
          >
            {label}
          </FuText>
        )}
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    minHeight: touchTarget,
    paddingHorizontal: 20,
  },
  md: { minHeight: touchTarget, paddingVertical: 10 },
  lg: { minHeight: 52, paddingVertical: 14 },
  primary: { backgroundColor: color.accent },
  secondary: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.borderStrong,
  },
  ghost: { backgroundColor: 'transparent' },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.5 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
})
