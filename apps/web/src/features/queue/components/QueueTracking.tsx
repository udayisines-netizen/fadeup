import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/Button'
import { Sheet } from '@/shared/ui/Sheet'
import { SkeletonRect } from '@/shared/ui/Skeleton'
import { StateBadge } from '@/shared/ui/StateBadge'
import { IconInfo } from '@/shared/ui/icons'
import { useNow } from '@/shared/hooks/useNow'
import { formatEstimatedWait } from '@/shared/lib/waitTime'
import type { PublicQueueFile, QueueEntryTracking } from '@/features/queue/api/publicQueue'
import { QueueList, queueDisplayName } from '@/features/queue/components/QueueList'

/**
 * Suivre sa place — nourri par `get_queue_entry_tracking` (F1b) : position
 * dans SA file, échéance d'appel ABSOLUE calculée serveur, estimation
 * d'attente, nature d'une éventuelle sortie. JAMAIS l'identité des autres.
 *
 * Règles tenues ici :
 * - le compte à rebours ne s'affiche QUE si l'échéance est présente ; sans
 *   elle, l'appel reste visible sans minutes (comportement F1 préservé) ;
 * - échéance dépassée : AUCUNE valeur négative — « le délai est écoulé, le
 *   salon décide » ;
 * - AUCUNE proposition automatique de changer de barber : le bouton existe,
 *   il attend le client (F1b §2) ;
 * - quitter est irréversible (fin de file au retour) : confirmation avant,
 *   message et action après — un état vide propose toujours une action ;
 * - un client déplacé par le salon le VOIT : sa file change de nom sous ses
 *   yeux, l'écran le dit sans qu'il ait à comprendre pourquoi.
 */

interface QueueTrackingProps {
  entry: QueueEntryTracking | null
  /** L'entrée n'existe plus côté serveur (entry_not_found au poll). */
  gone: boolean
  organizationName: string
  /** Les files du lieu, pour la feuille « Changer de barber ». */
  queues: PublicQueueFile[]
  busy: boolean
  onLeave: () => void
  onChangeBarber: (toBarberId: string | null) => void
  onDismiss: () => void
}

function canNotify(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.floor(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function QueueTracking({
  entry,
  gone,
  organizationName,
  queues,
  busy,
  onLeave,
  onChangeBarber,
  onDismiss,
}: QueueTrackingProps) {
  const { t } = useTranslation('v2')
  const now = useNow(1_000)
  const [notifyState, setNotifyState] = useState<NotificationPermission | 'unsupported'>(() =>
    canNotify() ? Notification.permission : 'unsupported',
  )
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [changeOpen, setChangeOpen] = useState(false)
  const [pickedQueue, setPickedQueue] = useState<PublicQueueFile | null>(null)
  const previousStatus = useRef<QueueEntryTracking['status'] | null>(null)
  // La file d'origine, pour détecter un déplacement par le salon. `undefined`
  // = pas encore observée ; ensuite l'id de barber (null = premier dispo).
  const previousBarberId = useRef<string | null | undefined>(undefined)
  const [movedTo, setMovedTo] = useState<{ name: string | null } | null>(null)

  // Notification système au passage à « appelé » — uniquement sur transition
  // réelle, jamais rejouée à chaque poll.
  useEffect(() => {
    const status = entry?.status ?? null
    if (status === 'called' && previousStatus.current !== 'called' && canNotify() && Notification.permission === 'granted') {
      new Notification(t('queue.track.notificationTitle'), {
        body: t('queue.track.notificationBody', { organization: organizationName }),
      })
    }
    previousStatus.current = status
  }, [entry?.status, organizationName, t])

  // Déplacement par le salon : la file de l'entrée change sans geste local.
  useEffect(() => {
    if (!entry || entry.status !== 'waiting') return
    if (previousBarberId.current !== undefined && previousBarberId.current !== entry.barber_id) {
      setMovedTo({ name: entry.barber_display_name })
    }
    previousBarberId.current = entry.barber_id
  }, [entry])

  if (gone) {
    return (
      <section className="flex flex-col items-center gap-3 py-8 text-center" data-testid="queue-track-gone">
        <IconInfo aria-hidden="true" className="size-6 text-[var(--fu-text-secondary)]" />
        <p className="text-fu-lg font-semibold">{t('queue.track.gone.title')}</p>
        <p className="max-w-sm text-fu-sm text-[var(--fu-text-secondary)]">{t('queue.track.gone.description')}</p>
        <Button variant="secondary" onClick={onDismiss}>
          {t('queue.track.gone.action')}
        </Button>
      </section>
    )
  }

  // Première réponse pas encore arrivée : rien n'est affirmé, rien d'inventé.
  if (!entry) {
    return (
      <section className="mt-8 flex flex-col items-center gap-3" aria-busy="true">
        <SkeletonRect className="h-16 w-24" />
        <SkeletonRect className="h-4 w-40" />
      </section>
    )
  }

  // ---- États terminaux : un message honnête et une action, jamais un cul-de-sac.
  if (entry.status === 'completed' || entry.status === 'cancelled' || entry.status === 'no_show') {
    const key =
      entry.status === 'completed'
        ? 'completed'
        : entry.status === 'cancelled'
          ? 'left'
          : entry.removed_automatically
            ? 'removedAuto'
            : 'removedManual'
    return (
      <section className="flex flex-col items-center gap-3 py-8 text-center" data-testid={`queue-track-ended-${key}`}>
        <IconInfo aria-hidden="true" className="size-6 text-[var(--fu-text-secondary)]" />
        <p className="text-fu-lg font-semibold">{t(`queue.track.ended.${key}.title`)}</p>
        <p className="max-w-sm text-fu-sm text-[var(--fu-text-secondary)]">{t(`queue.track.ended.${key}.description`)}</p>
        <Button variant="secondary" onClick={onDismiss}>
          {t('queue.track.ended.action')}
        </Button>
      </section>
    )
  }

  if (entry.status === 'called') {
    const deadline = entry.called_deadline_at ? new Date(entry.called_deadline_at).getTime() : null
    const remainingMs = deadline !== null ? deadline - now.getTime() : null
    return (
      <section
        aria-live="assertive"
        className="fu-called flex flex-col items-center gap-3 rounded-[var(--radius-card)] bg-[var(--fu-accent)] px-6 py-10 text-center text-[var(--fu-accent-fg)]"
        data-testid="queue-track-called"
      >
        <p className="text-fu-2xl font-semibold">{t('queue.track.called.title')}</p>
        <p className="max-w-sm text-fu-base">{t('queue.track.called.description', { organization: organizationName })}</p>
        {remainingMs !== null && remainingMs > 0 && (
          <p className="font-fu-mono text-fu-3xl font-semibold tabular-nums" data-testid="queue-track-deadline">
            {t('queue.track.deadlineCountdown', { time: formatCountdown(remainingMs) })}
          </p>
        )}
        {remainingMs !== null && remainingMs <= 0 && (
          <p className="max-w-sm text-fu-sm" data-testid="queue-track-deadline-passed">
            {t('queue.track.deadlinePassed')}
          </p>
        )}
        <Button variant="tertiary" className="text-[var(--fu-accent-fg)]" onClick={() => setLeaveOpen(true)} disabled={busy}>
          {t('queue.track.leaveCta')}
        </Button>
        <LeaveConfirmSheet
          open={leaveOpen}
          onOpenChange={setLeaveOpen}
          called
          busy={busy}
          onConfirm={() => {
            setLeaveOpen(false)
            onLeave()
          }}
        />
      </section>
    )
  }

  if (entry.status === 'in_service') {
    return (
      <section className="flex flex-col items-center gap-3 py-8 text-center" data-testid="queue-track-in-service">
        <StateBadge state="confirmed" />
        <p className="text-fu-lg font-semibold">{t('queue.track.inService.title')}</p>
      </section>
    )
  }

  // ---- En attente.
  const ahead = entry.people_ahead
  const wait = formatEstimatedWait(entry.estimated_wait_minutes)
  const queueLabel =
    entry.barber_id === null
      ? t('queue.track.queueFirstAvailable')
      : t('queue.track.queueName', { name: entry.barber_display_name ?? '' })

  return (
    <section aria-live="polite" className="flex flex-col items-center gap-3 py-8 text-center" data-testid="queue-track-waiting">
      {movedTo && (
        <p
          role="status"
          className="rounded-[var(--radius-control)] bg-[var(--fu-surface)] px-3 py-2 text-fu-sm text-[var(--fu-text-primary)]"
          data-testid="queue-track-moved"
        >
          {movedTo.name
            ? t('queue.track.movedNotice', { name: movedTo.name })
            : t('queue.track.movedNoticeFirstAvailable')}
        </p>
      )}
      <p className="text-fu-sm font-medium text-[var(--fu-text-secondary)]">{t('queue.track.yourPosition')}</p>
      <p className="font-fu-mono text-fu-4xl font-semibold tabular-nums leading-none" data-testid="queue-track-position">
        {entry.queue_position ?? '—'}
      </p>
      <p className="text-fu-sm text-[var(--fu-text-secondary)]" data-testid="queue-track-file">
        {queueLabel}
      </p>
      {ahead !== null && (
        <p className="text-fu-base text-[var(--fu-text-secondary)]">{t('queue.track.peopleAhead', { count: ahead })}</p>
      )}
      {wait && ahead !== null && ahead > 0 && (
        <p className="text-fu-sm text-[var(--fu-text-secondary)]" data-testid="queue-track-wait">
          {t('queue.track.estimatedWait', { minutes: wait.minutes })}
        </p>
      )}
      {notifyState === 'default' && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void Notification.requestPermission().then(setNotifyState)
          }}
        >
          {t('queue.track.enableNotifications')}
        </Button>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {queues.length > 1 && (
          <Button variant="secondary" size="sm" onClick={() => setChangeOpen(true)} disabled={busy} data-testid="queue-track-change">
            {t('queue.track.changeCta')}
          </Button>
        )}
        <Button variant="tertiary" size="sm" onClick={() => setLeaveOpen(true)} disabled={busy} data-testid="queue-track-leave">
          {t('queue.track.leaveCta')}
        </Button>
      </div>

      <LeaveConfirmSheet
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        called={false}
        busy={busy}
        onConfirm={() => {
          setLeaveOpen(false)
          onLeave()
        }}
      />

      <Sheet
        open={changeOpen}
        onOpenChange={(next) => {
          setChangeOpen(next)
          if (!next) setPickedQueue(null)
        }}
        title={t('queue.track.changeSheet.title')}
        description={t('queue.track.changeSheet.warning')}
      >
        <div className="flex flex-col gap-4">
          <QueueList
            queues={queues}
            excludeBarberId={entry.barber_id}
            onPick={setPickedQueue}
          />
          {pickedQueue && (
            <Button
              variant="primary"
              loading={busy}
              onClick={() => {
                setChangeOpen(false)
                onChangeBarber(pickedQueue.barber_id)
                setPickedQueue(null)
              }}
              data-testid="queue-change-confirm"
            >
              {pickedQueue.barber_id === null
                ? t('queue.track.changeSheet.confirmFirstAvailable')
                : t('queue.track.changeSheet.confirm', { name: queueDisplayName(pickedQueue, t) })}
            </Button>
          )}
        </div>
      </Sheet>
    </section>
  )
}

function LeaveConfirmSheet({
  open,
  onOpenChange,
  called,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  called: boolean
  busy: boolean
  onConfirm: () => void
}) {
  const { t } = useTranslation('v2')
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('queue.track.leaveConfirm.title')}
      description={called ? t('queue.track.leaveConfirm.calledDescription') : t('queue.track.leaveConfirm.description')}
    >
      <div className="flex flex-col gap-3">
        {/* Registre secondaire, pas de vert plein : quitter n'est pas LE CTA
            dominant de l'écran (F1b §4). */}
        <Button variant="secondary" loading={busy} onClick={onConfirm} data-testid="queue-leave-confirm">
          {t('queue.track.leaveConfirm.confirm')}
        </Button>
        <Button variant="tertiary" onClick={() => onOpenChange(false)}>
          {t('queue.track.leaveConfirm.cancel')}
        </Button>
      </div>
    </Sheet>
  )
}
