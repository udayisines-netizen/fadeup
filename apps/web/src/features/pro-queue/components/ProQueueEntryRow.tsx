import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/Button'
import { Row } from '@/shared/ui/Row'
import { StateBadge } from '@/shared/ui/StateBadge'
import { elapsedWaitMinutes } from '@/shared/lib/waitTime'
import { formatMinimalName } from '@/features/pro-queue/lib/minimalName'
import { GraceCountdown } from '@/features/pro-queue/components/GraceCountdown'
import type { ProQueueEntry } from '@/features/pro-queue/api/proQueue'

/**
 * Une rangée de file pro — dense, filet fin, utilisable d'une main. Prénom
 * et initiale seulement (minimisation B2). Seul l'élément MODIFIÉ s'anime
 * (`fu-called` à l'appel) — jamais la liste entière (P1 §15).
 */

interface ProQueueEntryRowProps {
  entry: ProQueueEntry
  /** Position dans la file d'attente (1-indexée), null hors attente. */
  position: number | null
  graceMinutes: number | null
  /** Fuseau du lieu (heures de service). */
  timezone: string
  now: Date
  busy: boolean
  onCall: (entryId: string) => void
  onArrived: (entryId: string) => void
  onNoShow: (entryId: string) => void
  onComplete: (entryId: string) => void
}

export function ProQueueEntryRow({
  entry,
  position,
  graceMinutes,
  timezone,
  now,
  busy,
  onCall,
  onArrived,
  onNoShow,
  onComplete,
}: ProQueueEntryRowProps) {
  const { t } = useTranslation('v2')
  const waitedMinutes = elapsedWaitMinutes(entry.created_at, now)

  if (entry.status === 'in_service') {
    return (
      <Row
        className="px-0"
        leading={<StateBadge state="confirmed" size="sm" />}
        title={formatMinimalName(entry.customer_name)}
        subtitle={t('queue.pro.inServiceSince', { minutes: elapsedWaitMinutes(entry.service_started_at ?? entry.created_at, now) })}
        trailing={
          <Button variant="primary" size="sm" disabled={busy} onClick={() => onComplete(entry.id)}>
            {t('queue.pro.actions.complete')}
          </Button>
        }
      />
    )
  }

  if (entry.status === 'called') {
    // Le nom reste le TITRE (à 390 px, badge + deux boutons saturent une
    // ligne) ; l'état et la grâce passent en sous-titre.
    return (
      <Row
        className="fu-called px-0"
        title={formatMinimalName(entry.customer_name)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StateBadge state="called" size="sm" />
            {entry.called_at && (
              <GraceCountdown calledAt={entry.called_at} graceMinutes={graceMinutes} timezone={timezone} now={now} />
            )}
          </span>
        }
        trailing={
          <>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => onArrived(entry.id)}>
              {t('queue.pro.actions.arrived')}
            </Button>
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => onNoShow(entry.id)}>
              {t('queue.pro.actions.noShow')}
            </Button>
          </>
        }
      />
    )
  }

  return (
    <Row
      className="px-0"
      leading={
        <span className="inline-flex size-8 items-center justify-center rounded-[var(--radius-avatar)] bg-[var(--fu-surface-hover)] font-fu-mono text-fu-sm tabular-nums">
          {position ?? '—'}
        </span>
      }
      title={formatMinimalName(entry.customer_name)}
      subtitle={t('queue.pro.waitingFor', { minutes: waitedMinutes })}
      trailing={
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => onCall(entry.id)}>
          {t('queue.pro.actions.call')}
        </Button>
      }
    />
  )
}
