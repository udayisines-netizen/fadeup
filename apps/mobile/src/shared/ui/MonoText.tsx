import { Text, type TextProps } from 'react-native'
import { color, font, fontSize } from '@/shared/theme/tokens'

/**
 * Donnée numérique alignée — Geist Mono + tabular-nums, OBLIGATOIRE pour
 * prix, horaires, positions, distances, identifiants (D1 §1). Poppins ne
 * porte jamais un chiffre aligné.
 */
export interface MonoTextProps extends TextProps {
  size?: 'sm' | 'base' | 'lg' | 'display'
  tone?: 'primary' | 'secondary' | 'accent'
  weight?: 'regular' | 'medium'
}

const SIZES = {
  sm: fontSize.sm,
  base: fontSize.base,
  lg: fontSize.lg,
  display: fontSize.display,
} as const

const TONES = {
  primary: color.textPrimary,
  secondary: color.textSecondary,
  accent: color.accentText,
} as const

export function MonoText({ size = 'sm', tone = 'primary', weight = 'regular', style, ...rest }: MonoTextProps) {
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: weight === 'medium' ? font.monoMedium : font.mono,
          fontSize: SIZES[size],
          color: TONES[tone],
          fontVariant: ['tabular-nums'],
        },
        style,
      ]}
    />
  )
}
