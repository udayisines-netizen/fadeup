import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Panel } from '@/components/ui/page-header'
import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDateTime } from '@/lib/intl/use-intl'
import type { QueueEntry } from '@/lib/queries/queue'
import type { CalendarProfessional } from '@/lib/calendar/professionals'

/**
 * Who is standing in the shop right now.
 *
 * The reference shows an estimated wait beside each person ("~20 min
 * d'attente"). FadeUp does not compute one, and a wait estimate is precisely
 * the kind of number a customer is told out loud — inventing it would put a
 * receptionist in the position of repeating a guess as a fact.
 *
 * So this shows what is genuinely known: position in line and how long they
 * have actually been waiting, which is measured from `createdAt` and is real.
 * That answers the same operational question honestly.
 */
export function QueuePanel({
  entries,
  isPending,
  professionalsById,
}: {
  entries: QueueEntry[]
  isPending: boolean
  professionalsById: Map<string, CalendarProfessional>
}) {
  const { t } = useTranslation()
  const dt = useDateTime()

  return (
    <Panel
      title={t('app:queue.liveQueue')}
      meta={entries.length > 0 ? t('app:queue.waitingCount', { count: entries.length }) : undefined}
      bodyClassName="p-2 sm:p-3"
      footer={
        <Link to="/app/queue" className={buttonVariants({ variant: 'secondary' }, 'w-full')}>
          {t('app:queue.manage')}
        </Link>
      }
    >
      {isPending ? (
        <div className="flex flex-col gap-2 p-1">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-md" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
          <Users className="h-6 w-6 text-ink-300" aria-hidden="true" />
          <p className="text-sm font-medium text-ink-950">{t('app:queue.nobodyWaiting')}</p>
          <p className="text-pretty text-xs text-ink-500">{t('app:queue.nobodyWaitingBody')}</p>
        </div>
      ) : (
        <ol className="flex flex-col">
          {entries.map((entry, index) => {
            const professional = entry.barberId ? professionalsById.get(entry.barberId) : undefined
            const waitedMinutes = Math.max(
              0,
              Math.round((Date.now() - new Date(entry.createdAt).getTime()) / 60000),
            )
            return (
              <li key={entry.id} data-fu-enter className="flex items-center gap-3 rounded-md px-2 py-2.5">
                {/* Position is the queue's own truth and the thing a customer
                    asks about, so it leads the row. */}
                <span className="w-5 shrink-0 text-center text-sm font-semibold tabular-nums text-ink-500">
                  {index + 1}
                </span>
                <Avatar name={entry.customerName} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-950">{entry.customerName}</span>
                  <span className="block truncate text-xs text-ink-500">
                    {professional?.displayName ?? t('app:queue.anyProfessional')}
                  </span>
                </span>
                <span className="shrink-0 text-end">
                  <span className="block text-xs font-medium tabular-nums text-ink-700">
                    {dt.duration(waitedMinutes)}
                  </span>
                  <span className="block text-[11px] text-ink-300">{t('app:queue.waited')}</span>
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}
