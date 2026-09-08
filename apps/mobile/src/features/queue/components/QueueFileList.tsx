import { Pressable, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Ionicons } from '@expo/vector-icons'

import type { PublicQueueFile } from '@/shared/data/publicQueue'
import { formatEstimatedWait } from '@/shared/lib/waitTime'
import { color, radius, spacing, touchTarget } from '@/shared/theme/tokens'
import { Avatar } from '@/shared/ui/Avatar'
import { MonoText } from '@/shared/ui/MonoText'
import { FuText } from '@/shared/ui/Text'

/**
 * Les files d'un établissement (F1b §2) : « Premier disponible » EN TÊTE —
 * beaucoup de clients veulent juste être servis — puis les barbers, dans
 * l'ordre RENVOYÉ PAR LE SERVEUR (tri par nombre en attente ; le nombre est
 * un fait, pas une prédiction). L'estimation en minutes ne s'affiche que si
 * la base en fournit une fiable, via `formatEstimatedWait`, jamais autrement.
 *
 * Transposition native de apps/web shared/ui/QueueList.tsx. Deux usages, les
 * mêmes que le web : choisir la file à rejoindre, et choisir la file de
 * destination dans la feuille « Changer de barber » (`excludeBarberId`).
 */

export interface QueueFileListProps {
  queues: PublicQueueFile[]
  /** Toucher une file = intention de la rejoindre (ou de la choisir). */
  onPick?: (queue: PublicQueueFile) => void
  /** Mode « choisir seulement » : masque la file courante. */
  excludeBarberId?: string | null
  /** File déjà sélectionnée dans la feuille de changement. */
  selectedBarberId?: string | null
}

export function queueDisplayName(queue: PublicQueueFile, t: (key: string) => string): string {
  return queue.barber_id === null ? t('queue.public.firstAvailable') : (queue.display_name ?? '')
}

export function QueueFileList({ queues, onPick, excludeBarberId, selectedBarberId }: QueueFileListProps) {
  const { t } = useTranslation('v2')

  const visible =
    excludeBarberId === undefined ? queues : queues.filter((queue) => queue.barber_id !== excludeBarberId)

  return (
    <View>
      {visible.map((queue) => {
        const wait = formatEstimatedWait(queue.estimated_wait_minutes)
        const name = queueDisplayName(queue, t)
        const waitingLabel =
          queue.waiting_count === 0
            ? queue.busy
              ? t('queue.public.queueBusy')
              : t('queue.public.queueNoWait')
            : `${queue.waiting_count} ${t('queue.public.waitingCount', { count: queue.waiting_count })}`
        const selected = selectedBarberId !== undefined && selectedBarberId === queue.barber_id

        const content = (
          <>
            {queue.barber_id === null ? (
              <View style={styles.firstAvailableIcon}>
                <Ionicons name="people-outline" size={20} color={color.textSecondary} />
              </View>
            ) : (
              <Avatar name={queue.display_name ?? ''} src={queue.avatar_url} />
            )}
            <View style={styles.labels}>
              <FuText variant="bodyMedium" numberOfLines={1}>
                {name}
              </FuText>
              <FuText variant="sm" tone="secondary" numberOfLines={1}>
                {queue.barber_id === null ? t('queue.public.firstAvailableHint') : waitingLabel}
              </FuText>
            </View>
            <View style={styles.trailing}>
              <MonoText size="lg" weight="medium">
                {queue.waiting_count}
              </MonoText>
              {wait && queue.waiting_count > 0 ? (
                <FuText variant="badge" tone="tertiary">
                  {t('queue.public.queueWait', { minutes: wait.minutes })}
                </FuText>
              ) : null}
            </View>
            {onPick ? (
              <Ionicons
                name={selected ? 'checkmark-circle' : 'chevron-forward'}
                size={selected ? 22 : 18}
                color={selected ? color.accent : color.textTertiary}
              />
            ) : null}
          </>
        )

        const key = queue.barber_id ?? 'first-available'

        return onPick ? (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={`${name} — ${waitingLabel}`}
            accessibilityState={{ selected }}
            onPress={() => onPick(queue)}
            style={[styles.row, selected && styles.rowSelected]}
          >
            {content}
          </Pressable>
        ) : (
          <View key={key} style={styles.row} accessibilityLabel={`${name} — ${waitingLabel}`}>
            {content}
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    minHeight: touchTarget + 16,
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(2),
    borderRadius: radius.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  rowSelected: {
    backgroundColor: color.accentSoft,
    borderBottomColor: 'transparent',
  },
  firstAvailableIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.avatar,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surfaceSubtle,
  },
  labels: { flex: 1, gap: 2 },
  trailing: { alignItems: 'flex-end', gap: 2 },
})
