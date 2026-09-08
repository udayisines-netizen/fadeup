import { Children, type ReactNode } from 'react'
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { color, radius, spacing, touchTarget } from '@/shared/theme/tokens'
import { FuText } from '@/shared/ui/Text'

/**
 * La carte-liste du tunnel et de « Mes réservations » — l'équivalent natif
 * du `Row` web dans son conteneur bordé (une seule bordure autour, un filet
 * entre les lignes, jamais de bordure sous la dernière).
 *
 * Le natif change la DÉCLARATION, pas l'intention : le filet est un
 * `borderTopWidth` hairline, la cible tactile reste ≥ 44 px, et l'état
 * pressé passe par l'opacité (pas de survol sur un doigt).
 *
 * `dark` bascule sur les tokens `moment` — les DEUX moments sombres du
 * produit (confirmation, suivi de file) rendent la même carte.
 */

export function palette(dark: boolean) {
  return dark ? color.moment : color
}

export function CardList({ children, dark = false, style }: { children: ReactNode; dark?: boolean; style?: ViewStyle }) {
  const p = palette(dark)
  const rows = Children.toArray(children).filter(Boolean)
  return (
    <View
      style={[
        styles.card,
        { borderColor: p.border, backgroundColor: dark ? p.surface : color.surface },
        style,
      ]}
    >
      {rows.map((row, index) => (
        <View
          // Les lignes d'une carte sont positionnelles et stables le temps
          // d'un rendu : l'index est ici l'identité réelle.
          key={index}
          style={index > 0 ? [styles.divider, { borderTopColor: p.border }] : undefined}
        >
          {row}
        </View>
      ))}
    </View>
  )
}

export interface BookingRowProps {
  /** Le contenu principal : une valeur (nom, horaire, prix) — jamais l'étiquette. */
  title: ReactNode
  /** L'étiquette sous la valeur (correctif F4 : à 390 px, la valeur d'abord). */
  subtitle?: ReactNode
  trailing?: ReactNode
  /** Une ligne supplémentaire pleine largeur (l'échéance, qui ne doit pas tronquer). */
  footer?: ReactNode
  onPress?: () => void
  accessibilityLabel?: string
  chevron?: boolean
  dark?: boolean
}

export function BookingRow({
  title,
  subtitle,
  trailing,
  footer,
  onPress,
  accessibilityLabel,
  chevron = false,
  dark = false,
}: BookingRowProps) {
  const p = palette(dark)

  const content = (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        {typeof title === 'string' ? (
          <FuText variant="bodyMedium" style={{ color: p.textPrimary }} numberOfLines={2}>
            {title}
          </FuText>
        ) : (
          title
        )}
        {typeof subtitle === 'string' ? (
          <FuText variant="sm" style={{ color: p.textSecondary }}>
            {subtitle}
          </FuText>
        ) : (
          subtitle
        )}
        {footer}
      </View>
      {trailing ? <View style={styles.rowTrailing}>{trailing}</View> : null}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={p.textTertiary} /> : null}
    </View>
  )

  if (!onPress) return content

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      {content}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.card,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    minHeight: touchTarget + 8,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2.5),
  },
  rowMain: { flex: 1, gap: 2 },
  rowTrailing: { flexShrink: 0, alignItems: 'flex-end' },
  pressed: { opacity: 0.65 },
})
