import { Pressable, StyleSheet, type PressableProps } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import { usePrefersReducedMotion } from '@/shared/hooks/usePrefersReducedMotion'
import { color, duration, font, fontSize, radius, touchTarget } from '@/shared/theme/tokens'
import { FuText } from '@/shared/ui/Text'

/**
 * M1b — le bouton du SUIVI, seul écran client en fond sombre (thème
 * `moment`, D1 §9). Même contrat que `shared/ui/Button` (cible 44 px, échelle
 * de pression 120 ms, neutralisée sous réduction d'animations) mais sur la
 * palette `color.moment` : sur #071310 le vert TEXTE clair (#2FE59B, 11,5:1)
 * remplace le vert profond du thème clair (#007A52, 3,5:1 — sous le seuil).
 *
 * Pourquoi ici et pas dans `shared/ui/Button` : `Button` ne prend pas encore
 * de palette (contrairement à `StateBadge`, qui a son `dark`), et shared/ui
 * n'est pas dans le périmètre de ce lot. Le jour où `Button` reçoit un
 * `dark`, CE fichier disparaît — il n'introduit aucune règle nouvelle.
 *
 * Trois registres, aucun vert plein (le vert plein du suivi est le panneau
 * d'appel lui-même, pas une action) :
 *  - `outline` : action secondaire posée sur le fond sombre ;
 *  - `quiet`   : registre tertiaire (quitter la file) ;
 *  - `onAccent`: action posée SUR le panneau vert — texte encre, jamais blanc.
 */

export type MomentButtonVariant = 'outline' | 'quiet' | 'onAccent'

export interface MomentButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string
  variant?: MomentButtonVariant
  fullWidth?: boolean
}

export function MomentButton({
  label,
  variant = 'outline',
  fullWidth = false,
  disabled,
  ...rest
}: MomentButtonProps) {
  const reduced = usePrefersReducedMotion()
  const pressed = useSharedValue(0)

  const animatedStyle = useAnimatedStyle(() => ({
    transform: reduced ? [] : [{ scale: 1 - pressed.value * 0.015 }],
    opacity: reduced ? 1 - pressed.value * 0.12 : 1,
  }))

  const textColor =
    variant === 'onAccent'
      ? color.moment.accentFg
      : variant === 'quiet'
        ? color.moment.textSecondary
        : color.moment.textPrimary

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={4}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: duration.instant })
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, { duration: duration.instant })
      }}
      {...rest}
    >
      <Animated.View
        style={[
          styles.base,
          variant === 'outline' && styles.outline,
          fullWidth && styles.fullWidth,
          Boolean(disabled) && styles.disabled,
          animatedStyle,
        ]}
      >
        <FuText
          variant="smMedium"
          style={{ color: textColor, fontFamily: font.semibold, fontSize: fontSize.sm }}
        >
          {label}
        </FuText>
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touchTarget,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radius.control,
  },
  outline: {
    borderWidth: 1,
    borderColor: color.moment.borderStrong,
    backgroundColor: color.moment.surface,
  },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.5 },
})
