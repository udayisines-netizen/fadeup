import { Text, type TextProps, type TextStyle } from 'react-native'
import { color, font, fontSize } from '@/shared/theme/tokens'

/**
 * LE composant texte — Poppins partout, rien de lisible sous 14 px (D1 §1).
 * `badge` (12 px) est réservé aux badges/puces, jamais à une phrase.
 * Les petits libellés (sm) portent Medium ≥ 500, les titres 600.
 */

export type TextVariant =
  | 'badge'
  | 'sm'
  | 'smMedium'
  | 'body'
  | 'bodyMedium'
  | 'bodySemibold'
  | 'title'
  | 'heading'
  | 'display'

const VARIANTS: Record<TextVariant, TextStyle> = {
  badge: { fontFamily: font.medium, fontSize: fontSize.badge, lineHeight: 16 },
  sm: { fontFamily: font.regular, fontSize: fontSize.sm, lineHeight: 20 },
  smMedium: { fontFamily: font.medium, fontSize: fontSize.sm, lineHeight: 20 },
  body: { fontFamily: font.regular, fontSize: fontSize.base, lineHeight: 24 },
  bodyMedium: { fontFamily: font.medium, fontSize: fontSize.base, lineHeight: 24 },
  bodySemibold: { fontFamily: font.semibold, fontSize: fontSize.base, lineHeight: 24 },
  title: { fontFamily: font.semibold, fontSize: fontSize.lg, lineHeight: 28 },
  heading: { fontFamily: font.semibold, fontSize: fontSize.xl, lineHeight: 32 },
  display: { fontFamily: font.bold, fontSize: fontSize.display, lineHeight: 40 },
}

export type TextTone = 'primary' | 'secondary' | 'tertiary' | 'accent' | 'danger' | 'inverse'

const TONES: Record<TextTone, string> = {
  primary: color.textPrimary,
  secondary: color.textSecondary,
  tertiary: color.textTertiary,
  accent: color.accentText,
  danger: color.danger,
  /** Encre sur vert — le texte des CTA pleins (jamais du blanc). */
  inverse: color.accentFg,
}

export interface FuTextProps extends TextProps {
  variant?: TextVariant
  tone?: TextTone
}

export function FuText({ variant = 'body', tone = 'primary', style, ...rest }: FuTextProps) {
  return <Text {...rest} style={[VARIANTS[variant], { color: TONES[tone] }, style]} />
}
