import { StyleSheet, View } from 'react-native'
import { FuText } from '@/shared/ui/Text'
import { Button } from '@/shared/ui/Button'
import { spacing } from '@/shared/theme/tokens'

/**
 * État vide honnête — chaque état vide PROPOSE une action (MASTER_SPEC §20 :
 * un cul-de-sac est un défaut). Jamais un remplissage inventé.
 */
export interface EmptyStateProps {
  title: string
  body?: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({ title, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <FuText variant="title" style={styles.center}>
        {title}
      </FuText>
      {body ? (
        <FuText variant="sm" tone="secondary" style={styles.center}>
          {body}
        </FuText>
      ) : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button label={actionLabel} variant="secondary" onPress={onAction} />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing(2),
    paddingHorizontal: spacing(6),
    paddingVertical: spacing(8),
  },
  center: { textAlign: 'center' },
  action: { marginTop: spacing(2) },
})
