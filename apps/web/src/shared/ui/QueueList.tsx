import { useTranslation } from 'react-i18next'
import { Avatar } from '@/shared/ui/Avatar'
import { Row } from '@/shared/ui/Row'
import { IconQueue } from '@/shared/ui/icons'
import { formatEstimatedWait } from '@/shared/lib/waitTime'
import type { PublicQueueFile } from '@/features/queue/api/publicQueue'

/**
 * Les files d'un établissement (F1b §2) : « Premier disponible » EN TÊTE —
 * beaucoup de clients veulent juste être servis — puis les barbers triés par
 * nombre de personnes en attente (l'ordre vient du serveur ; le nombre est un
 * FAIT). L'estimation en minutes ne s'affiche que si la base en fournit une
 * fiable — via formatEstimatedWait, jamais autrement.
 */

interface QueueListProps {
  queues: PublicQueueFile[]
  /** Tap sur une file = intention de la rejoindre (ou de la choisir). */
  onPick?: (queue: PublicQueueFile) => void
  /** Mode « choisir seulement » (feuille de changement) : masque la file exclue. */
  excludeBarberId?: string | null
  pickLabelKey?: string
}

export function queueDisplayName(queue: PublicQueueFile, t: (key: string) => string): string {
  return queue.barber_id === null ? t('queue.public.firstAvailable') : (queue.display_name ?? '')
}

export function QueueList({ queues, onPick, excludeBarberId }: QueueListProps) {
  const { t } = useTranslation('v2')

  const visible = excludeBarberId === undefined
    ? queues
    : queues.filter((queue) => queue.barber_id !== excludeBarberId)

  return (
    <div data-testid="queue-list">
      {visible.map((queue) => {
        const wait = formatEstimatedWait(queue.estimated_wait_minutes)
        const name = queueDisplayName(queue, t)
        const waitingLabel =
          queue.waiting_count === 0
            ? queue.busy
              ? t('queue.public.queueBusy')
              : t('queue.public.queueNoWait')
            : `${queue.waiting_count} ${t('queue.public.waitingCount', { count: queue.waiting_count })}`

        return (
          <Row
            key={queue.barber_id ?? 'first-available'}
            as="button"
            onClick={onPick ? () => onPick(queue) : undefined}
            aria-label={`${name} — ${waitingLabel}`}
            leading={
              queue.barber_id === null ? (
                <span className="inline-flex size-10 items-center justify-center rounded-[var(--radius-avatar)] bg-[var(--fu-surface-hover)]">
                  <IconQueue aria-hidden="true" className="size-5 text-[var(--fu-text-secondary)]" />
                </span>
              ) : (
                <Avatar name={queue.display_name ?? ''} src={queue.avatar_url} />
              )
            }
            title={name}
            subtitle={queue.barber_id === null ? t('queue.public.firstAvailableHint') : waitingLabel}
            trailing={
              <span className="flex flex-col items-end gap-0.5">
                <span
                  className="font-fu-mono text-fu-lg font-semibold tabular-nums leading-none"
                  data-testid="queue-list-count"
                >
                  {queue.waiting_count}
                </span>
                {wait && queue.waiting_count > 0 && (
                  <span className="text-fu-xs text-[var(--fu-text-secondary)]" data-testid="queue-list-wait">
                    {t('queue.public.queueWait', { minutes: wait.minutes })}
                  </span>
                )}
              </span>
            }
            chevron={Boolean(onPick)}
          />
        )
      })}
    </div>
  )
}
