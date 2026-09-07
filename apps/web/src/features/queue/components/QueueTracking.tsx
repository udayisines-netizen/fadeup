import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/Button'
import { StateBadge } from '@/shared/ui/StateBadge'
import { IconInfo } from '@/shared/ui/icons'

/**
 * Suivre sa place. Position exacte + nombre de personnes devant — JAMAIS
 * l'identité des autres (loi produit F1 §3) : ce composant ne reçoit même
 * pas les autres entrées, seulement des comptes.
 *
 * L'appel est LE moment orchestré de l'écran (un seul par écran, P1 §15) :
 * panneau vert plein / texte encre (8,30:1), animation `fu-called` (neutralisée
 * par prefers-reduced-motion dans motion.css), et Notification système si le
 * client l'a autorisée. PAS de compte à rebours : ni `called_at` ni la grâce
 * ne sont exposés par le contrat public — écart remonté dans le rapport F1,
 * aucune minute n'est inventée en attendant.
 */

export interface TrackedEntry {
  id: string
  status: 'waiting' | 'called' | 'in_service' | 'completed' | 'cancelled' | 'no_show'
  queuePosition: number | null
}

interface QueueTrackingProps {
  entry: TrackedEntry | null
  /** L'entrée a disparu des états actifs de la file (servie ou sortie). */
  gone: boolean
  organizationName: string
  onDismiss: () => void
}

function canNotify(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function QueueTracking({ entry, gone, organizationName, onDismiss }: QueueTrackingProps) {
  const { t } = useTranslation('v2')
  const [notifyState, setNotifyState] = useState<NotificationPermission | 'unsupported'>(() =>
    canNotify() ? Notification.permission : 'unsupported',
  )
  const previousStatus = useRef<TrackedEntry['status'] | null>(null)

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

  if (!entry) return null

  if (entry.status === 'called') {
    return (
      <section
        aria-live="assertive"
        className="fu-called flex flex-col items-center gap-3 rounded-[var(--radius-card)] bg-[var(--fu-accent)] px-6 py-10 text-center text-[var(--fu-accent-fg)]"
        data-testid="queue-track-called"
      >
        <p className="text-fu-2xl font-semibold">{t('queue.track.called.title')}</p>
        <p className="max-w-sm text-fu-base">{t('queue.track.called.description', { organization: organizationName })}</p>
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

  const ahead = entry.queuePosition !== null ? Math.max(0, entry.queuePosition - 1) : null

  return (
    <section aria-live="polite" className="flex flex-col items-center gap-3 py-8 text-center" data-testid="queue-track-waiting">
      <p className="text-fu-sm font-medium text-[var(--fu-text-secondary)]">{t('queue.track.yourPosition')}</p>
      <p className="font-fu-mono text-fu-4xl font-semibold tabular-nums leading-none" data-testid="queue-track-position">
        {entry.queuePosition ?? '—'}
      </p>
      {ahead !== null && (
        <p className="text-fu-base text-[var(--fu-text-secondary)]">{t('queue.track.peopleAhead', { count: ahead })}</p>
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
    </section>
  )
}
