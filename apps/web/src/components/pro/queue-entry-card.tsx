import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, Phone, Play, Check, Scissors } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { StatusBadge, type StatusTone } from '@/components/ui/status-badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/cn'
import type { QueueEntry, QueueStatus } from '@/lib/queries/queue'

/**
 * One person in the line.
 *
 * ============================================================================
 * ONE TAP FOR THE THING YOU ALWAYS DO
 * ============================================================================
 *
 * V1 rendered the queue as a six-column table where EVERY status change cost
 * two taps: open "Update status", then pick from six options — including the
 * five you were not going to pick. A barber does this standing up, one-handed,
 * with clippers in the other hand, dozens of times a day.
 *
 * Each status has exactly one obvious next move, so that move is a real
 * button:
 *
 *   waiting     → Call
 *   called      → Start
 *   in service  → Finish
 *
 * Everything else — cancel, no-show, skipping a step — stays in the overflow,
 * where it belongs: those are the exceptions, and putting them beside the
 * common action is how somebody marks a paying customer as a no-show by
 * accident.
 *
 * A finished entry has no next move and shows no action at all rather than a
 * disabled one.
 */

const TONES: Record<QueueStatus, StatusTone> = {
  waiting: 'warning',
  called: 'info',
  in_service: 'accent',
  completed: 'success',
  cancelled: 'neutral',
  no_show: 'danger',
}

/** The single obvious next move, or null when the entry is finished. */
const PRIMARY_NEXT: Partial<Record<QueueStatus, QueueStatus>> = {
  waiting: 'called',
  called: 'in_service',
  in_service: 'completed',
}

const PRIMARY_ICON = { called: Phone, in_service: Play, completed: Check } as const

/** Everything a member of staff may do, in the order they'd think of it. */
const ALL_TRANSITIONS: QueueStatus[] = ['called', 'in_service', 'completed', 'cancelled', 'no_show']

export function QueueEntryCard({
  entry,
  position,
  barberLabel,
  serviceName,
  canAct,
  isPending,
  onStatusChange,
  emphasis = false,
  className,
}: {
  entry: QueueEntry
  /** Arrival order among those still waiting. Null once they have left the line. */
  position: number | null
  barberLabel: string
  serviceName: string | null
  canAct: boolean
  isPending: boolean
  onStatusChange: (status: QueueStatus) => void
  /** The person at the front — larger, and the only one with a filled button. */
  emphasis?: boolean
  className?: string
}) {
  const { t } = useTranslation('app')
  const primary = PRIMARY_NEXT[entry.status]
  const PrimaryIcon = primary ? PRIMARY_ICON[primary as keyof typeof PRIMARY_ICON] : null

  return (
    <article
      className={cn(
        'flex items-center gap-3 rounded-xl border bg-paper-0 p-3',
        emphasis ? 'border-accent-600/50 bg-accent-100/30 p-4' : 'border-border',
        className,
      )}
    >
      {position !== null ? (
        <span
          className={cn(
            'flex shrink-0 items-center justify-center rounded-lg font-semibold tabular-nums',
            emphasis ? 'h-11 w-11 bg-accent-600 text-base text-on-accent' : 'h-9 w-9 bg-paper-100 text-sm text-ink-700',
          )}
          aria-label={t('queue.positionNumber', { position })}
        >
          {position}
        </span>
      ) : (
        <Avatar name={entry.customerName} size={emphasis ? 'md' : 'sm'} />
      )}

      <div className="min-w-0 flex-1">
        <p className={cn('truncate font-medium text-ink-950', emphasis && 'text-lg')}>{entry.customerName}</p>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-ink-500">
          <WaitClock since={entry.createdAt} />
          <span className="truncate">· {barberLabel}</span>
          {serviceName ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Scissors className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{serviceName}</span>
            </span>
          ) : null}
        </p>
        {entry.status !== 'waiting' ? (
          <span className="mt-1 inline-flex">
            <StatusBadge tone={TONES[entry.status]} size="sm" live={entry.status === 'in_service'}>
              {t(`queue.status.${entry.status}`)}
            </StatusBadge>
          </span>
        ) : null}
      </div>

      {canAct ? (
        <div className="flex shrink-0 items-center gap-1.5">
          {primary ? (
            <Button
              size={emphasis ? 'md' : 'sm'}
              variant={emphasis ? 'primary' : 'secondary'}
              isLoading={isPending}
              onClick={() => onStatusChange(primary)}
              leftIcon={PrimaryIcon ? <PrimaryIcon className="h-4 w-4" /> : undefined}
            >
              {t(`queue.action.${primary}`)}
            </Button>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={t('queue.updateStatus')} className="px-2">
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {ALL_TRANSITIONS.filter((status) => status !== entry.status && status !== primary).map((status) => (
                <DropdownMenuItem
                  key={status}
                  variant={status === 'cancelled' || status === 'no_show' ? 'danger' : 'default'}
                  onSelect={() => onStatusChange(status)}
                >
                  {t(`queue.action.${status}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </article>
  )
}

/**
 * How long they have been standing there, ticking.
 *
 * Written straight to the DOM node rather than through state: a busy shop has
 * fifteen of these on screen, and re-rendering fifteen cards every second to
 * change one number is how a tablet at the counter starts dropping frames
 * mid-scroll. Same technique as the dashboard's NOW card.
 *
 * It shows minutes, and turns amber past twenty. A wait is the one number on
 * this screen that gets worse on its own.
 */
function WaitClock({ since }: { since: string }) {
  const { t } = useTranslation('app')
  const ref = useRef<HTMLSpanElement | null>(null)
  const [late, setLate] = useState(false)

  useEffect(() => {
    const startedAt = new Date(since).getTime()

    function tick() {
      const minutes = Math.max(0, Math.round((Date.now() - startedAt) / 60_000))
      const node = ref.current
      if (node) node.textContent = minutes < 1 ? t('queue.justNow') : t('queue.waitedMinutes', { count: minutes })
      // Only ever writes when it actually flips, so this does not re-render
      // the card once a second.
      setLate((current) => (current === minutes >= 20 ? current : minutes >= 20))
    }

    tick()
    const interval = setInterval(tick, 30_000)
    return () => clearInterval(interval)
  }, [since, t])

  return <span ref={ref} className={cn('shrink-0 tabular-nums', late && 'font-medium text-warning-600')} />
}
