import { type ReactNode } from 'react'
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Button } from '@/shared/ui/Button'
import { Skeleton } from '@/shared/ui/Skeleton'
import { FuText } from '@/shared/ui/Text'
import { color, radius, shadow, spacing, touchTarget } from '@/shared/theme/tokens'

/**
 * Les pièces visuelles COMMUNES de l'onglet Compte — un seul registre pour
 * les six sections : titre de section, carte blanche sur le papier teinté,
 * séparateur en cheveu, erreur honnête, attente en Skeleton.
 *
 * Rien ici n'est une deuxième version d'une primitive partagée : ce sont
 * des assemblages locaux de FuText / Button / Skeleton.
 */

export function Section({
  title,
  children,
  style,
}: {
  title: string
  children: ReactNode
  style?: ViewStyle
}) {
  return (
    <View style={[styles.section, style]}>
      <FuText variant="title" accessibilityRole="header">
        {title}
      </FuText>
      {children}
    </View>
  )
}

/** La surface blanche qui se détache du papier (D1) — rayon carte. */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, shadow.card, style]}>{children}</View>
}

export function Divider() {
  return <View style={styles.divider} accessibilityElementsHidden />
}

/**
 * Action de rangée (Retirer, Ne plus suivre) — registre TEXTE, cible 44 px.
 * Jamais un bouton plein : la rangée n'est pas un appel à l'action.
 */
export function RowAction({
  label,
  onPress,
  busy = false,
  tone = 'secondary',
}: {
  label: string
  onPress: () => void
  busy?: boolean
  tone?: 'secondary' | 'danger'
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.rowAction, (pressed || busy) && styles.rowActionPressed]}
    >
      <FuText variant="smMedium" tone={tone}>
        {label}
      </FuText>
    </Pressable>
  )
}

/**
 * Erreur de données : on DIT que le chargement a échoué et on propose de
 * réessayer — jamais une liste vide qui ferait passer une panne pour un
 * « vous n'avez rien ».
 */
export function DataError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('v2')
  return (
    <Card style={styles.errorCard}>
      <FuText variant="sm" tone="danger" accessibilityRole="alert">
        {t('errors.data.unknown')}
      </FuText>
      <Button label={t('common.action.retry')} variant="secondary" onPress={onRetry} />
    </Card>
  )
}

/** Attente : des rangées grises, jamais un chiffre ni un nom provisoire. */
export function RowsSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <Card style={styles.skeletonCard}>
      {Array.from({ length: rows }).map((_, index) => (
        <View key={index} style={styles.skeletonRow} accessibilityElementsHidden>
          <Skeleton width={44} height={44} style={styles.skeletonAvatar} />
          <View style={styles.skeletonLines}>
            <Skeleton width="55%" height={16} />
            <Skeleton width="35%" height={14} />
          </View>
        </View>
      ))}
    </Card>
  )
}

const styles = StyleSheet.create({
  section: { gap: spacing(3) },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.border,
    marginVertical: spacing(1),
  },
  rowAction: {
    minHeight: touchTarget,
    minWidth: touchTarget,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingStart: spacing(2),
  },
  rowActionPressed: { opacity: 0.55 },
  errorCard: { gap: spacing(3), alignItems: 'flex-start' },
  skeletonCard: { gap: spacing(3) },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(3), minHeight: touchTarget },
  skeletonAvatar: { borderRadius: radius.avatar },
  skeletonLines: { flex: 1, gap: spacing(1.5) },
})
