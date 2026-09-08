import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { formatEstimatedWait } from '@/shared/lib/waitTime'
import { color, fontSize, spacing } from '@/shared/theme/tokens'
import { MonoText } from '@/shared/ui/MonoText'
import { StateBadge, type FadeUpState } from '@/shared/ui/StateBadge'
import { FuText } from '@/shared/ui/Text'

/**
 * LA réponse de l'écran /q/[slug] : y a-t-il du monde ? Un chiffre en Mono,
 * l'état RÉEL de la file, et rien d'inventé — une file vide est une file
 * vide. Transposition de apps/web QueueSummary.tsx.
 */

export type PublicQueueState = 'open' | 'closed' | 'unknown'

export interface QueueSummaryProps {
  waitingCount: number
  queueState: PublicQueueState
  /**
   * Estimation FIABLE fournie par la base, ou null — auquel cas AUCUNE
   * minute n'est affichée (loi produit F1 §3).
   */
  estimatedWaitMinutes: number | null
}

export function QueueSummary({ waitingCount, queueState, estimatedWaitMinutes }: QueueSummaryProps) {
  const { t } = useTranslation('v2')
  const wait = formatEstimatedWait(estimatedWaitMinutes)

  /* Échec de la RPC d'état = `partial-data`, jamais un état inventé. */
  const badgeState: FadeUpState =
    queueState === 'open' ? 'queue-open' : queueState === 'closed' ? 'queue-closed' : 'partial-data'

  return (
    <View style={styles.section} accessibilityLabel={t('queue.public.summaryLabel')}>
      <StateBadge state={badgeState} />
      <MonoText size="display" weight="medium" style={styles.count}>
        {waitingCount}
      </MonoText>
      <FuText variant="body" tone="secondary" style={styles.center}>
        {t('queue.public.waitingCount', { count: waitingCount })}
      </FuText>
      {/* Une file vide n'affiche pas « 0 min » : l'absence d'attente se lit
          dans le compte. Les minutes n'apparaissent qu'au-dessus de zéro. */}
      {wait && wait.minutes > 0 ? (
        <FuText variant="sm" tone="secondary" style={styles.center}>
          {t('queue.public.estimatedWait', { minutes: wait.minutes })}
        </FuText>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    alignItems: 'center',
    gap: spacing(2),
    paddingVertical: spacing(8),
  },
  count: {
    fontSize: fontSize.hero,
    lineHeight: 52,
    color: color.textPrimary,
  },
  center: { textAlign: 'center' },
})
