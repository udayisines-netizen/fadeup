import { useTranslation } from 'react-i18next'
import { StateBadge, type FadeUpState } from '@/shared/ui/StateBadge'
import { formatEstimatedWait } from '@/shared/lib/waitTime'

export type PublicQueueState = 'open' | 'closed' | 'unknown'

interface QueueSummaryProps {
  waitingCount: number
  queueState: PublicQueueState
  /**
   * Estimation FIABLE fournie par la base, ou null. Aujourd'hui aucune RPC
   * publique n'en fournit : ce prop reste null et AUCUNE minute ne
   * s'affiche (loi produit F1 §3). Le câblage existe pour le jour où le
   * modèle d'estimation sera tranché (MASTER_SPEC §23.3).
   */
  estimatedWaitMinutes: number | null
}

/**
 * LA réponse de l'écran /q/:slug : y a-t-il du monde ? Un chiffre en Mono,
 * l'état de la file, et rien d'inventé — une file vide est une file vide.
 */
export function QueueSummary({ waitingCount, queueState, estimatedWaitMinutes }: QueueSummaryProps) {
  const { t } = useTranslation('v2')
  const wait = formatEstimatedWait(estimatedWaitMinutes)

  const badgeState: FadeUpState =
    queueState === 'open' ? 'queue-open' : queueState === 'closed' ? 'queue-closed' : 'partial-data'

  return (
    <section aria-label={t('queue.public.summaryLabel')} className="flex flex-col items-center gap-3 py-8 text-center">
      <StateBadge state={badgeState} />
      <p className="font-fu-mono text-fu-4xl font-semibold tabular-nums leading-none" data-testid="queue-waiting-count">
        {waitingCount}
      </p>
      <p className="text-fu-base text-[var(--fu-text-secondary)]">
        {t('queue.public.waitingCount', { count: waitingCount })}
      </p>
      {/* Une file vide n'affiche pas « 0 min » : l'absence d'attente se lit
          dans le compte. Les minutes n'apparaissent qu'au-dessus de zéro. */}
      {wait && wait.minutes > 0 && (
        <p className="text-fu-sm text-[var(--fu-text-secondary)]" data-testid="queue-estimated-wait">
          {t('queue.public.estimatedWait', { minutes: wait.minutes })}
        </p>
      )}
    </section>
  )
}
