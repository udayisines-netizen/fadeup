import { useTranslation } from 'react-i18next'
import { DateTime } from '@/shared/ui/DateTime'

/**
 * Compte à rebours de grâce d'une entrée APPELÉE, côté pro. Réel de bout en
 * bout : `called_at` est horodaté PAR LE SERVEUR (trigger
 * `enforce_queue_transition`), la durée de grâce est LUE EN BASE
 * (`get_location_queue_check_in.queue_call_grace_minutes`) — jamais codée en
 * dur (F1 §3).
 *
 * Sans durée connue (rôle barber : la RPC des seuils est réservée
 * owner/manager/réceptionniste), on montre l'heure d'appel, pas un compte à
 * rebours inventé. À zéro, la base n'auto-expire PAS (aucun sweep,
 * V2_DATA_CONTRACT §V8) : c'est le pro qui décide « absent » — le composant
 * le dit, il ne le simule pas.
 */

interface GraceCountdownProps {
  calledAt: string
  graceMinutes: number | null
  /** Fuseau du LIEU — l'heure d'appel est une heure de service. */
  timezone: string
  now: Date
}

export function GraceCountdown({ calledAt, graceMinutes, timezone, now }: GraceCountdownProps) {
  const { t } = useTranslation('v2')

  if (graceMinutes === null) {
    return (
      <span className="inline-flex items-baseline gap-1 text-fu-xs text-[var(--fu-text-secondary)]">
        {t('queue.pro.calledAtLabel')}
        <DateTime value={calledAt} timezone={timezone} format="time" />
      </span>
    )
  }

  const deadline = new Date(calledAt).getTime() + graceMinutes * 60_000
  const remainingMs = deadline - now.getTime()

  if (remainingMs <= 0) {
    return (
      <span className="text-fu-xs font-medium text-[var(--fu-state-warn,var(--fu-text-secondary))]">
        {t('queue.pro.graceElapsed')}
      </span>
    )
  }

  const totalSeconds = Math.floor(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return (
    <span
      className="font-fu-mono text-fu-sm font-medium tabular-nums"
      aria-label={t('queue.pro.graceRemainingLabel', { minutes, seconds })}
    >
      {minutes}:{String(seconds).padStart(2, '0')}
    </span>
  )
}
