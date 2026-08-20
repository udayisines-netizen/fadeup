import { Link, NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/cn'
import { FadeUpLockup } from '@/components/brand/fadeup-mark'
import { proNavGroups } from '@/components/pro/pro-nav'
import type { MembershipRole } from '@/lib/types'

/**
 * The Professional sidebar.
 *
 * Fixed 248px. Wide enough that no label truncates in German — the longest is
 * "Verfügbarkeit" — and narrow enough to leave the calendar a real canvas at
 * 1280px, which is where most shop laptops actually sit.
 *
 * The active item is a filled pill with a leading accent bar. Both, not one:
 * the bar survives a colour-blind reading and a low-quality external monitor,
 * and it is the only place in the Professional chrome where the accent appears
 * at full strength, so "where am I" is answerable from peripheral vision.
 *
 * The organization card sits at the BOTTOM rather than the top. The reference
 * places it there and it is right for a reason worth stating: the shop's own
 * identity is reassurance, not navigation, and putting it above the nav would
 * push the destinations people actually click below the fold on a laptop.
 */
export function ProSidebar({
  role,
  organizationName,
  organizationSlug,
  locationLabel,
  pendingRequests,
  queueWaiting,
  className,
}: {
  role: MembershipRole
  organizationName: string
  organizationSlug: string
  locationLabel: string | null
  pendingRequests: number
  queueWaiting: number
  className?: string
}) {
  const { t } = useTranslation()
  const groups = proNavGroups(role, pendingRequests)

  return (
    <aside
      className={cn(
        'flex h-svh w-[15.5rem] shrink-0 flex-col border-e border-border bg-paper-0',
        className,
      )}
    >
      <div className="px-5 py-5">
        <Link
          to="/app"
          className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          aria-label="FadeUp"
        >
          <FadeUpLockup className="h-6 w-auto text-ink-950" />
        </Link>
      </div>

      <nav aria-label={t('app:nav.primary')} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.titleKey} className="mb-5">
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-ink-300">
              {t(group.titleKey)}
            </p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const count =
                  item.badge === 'requests' ? pendingRequests : item.badge === 'queue' ? queueWaiting : 0
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex min-h-10 items-center gap-3 rounded-md px-3 text-sm',
                          'transition-colors duration-[--fu-duration-quick] motion-reduce:transition-none',
                          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700',
                          isActive
                            ? 'bg-accent-100 font-semibold text-ink-950'
                            : 'text-ink-700 hover:bg-paper-100 hover:text-ink-950',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {/* The leading bar. Inline-start so it stays on the
                              content edge in Arabic. */}
                          <span
                            aria-hidden="true"
                            className={cn(
                              'absolute inset-y-1.5 -ms-3 w-0.5 rounded-full transition-opacity',
                              isActive ? 'bg-accent-600 opacity-100' : 'opacity-0',
                            )}
                          />
                          <Icon
                            className={cn('h-[18px] w-[18px] shrink-0', isActive ? 'text-accent-600' : 'text-ink-500')}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                          {count > 0 ? (
                            <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent-600 px-1.5 text-[11px] font-semibold text-on-accent">
                              {count > 9 ? '9+' : count}
                            </span>
                          ) : null}
                        </>
                      )}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="rounded-lg bg-paper-100 p-3">
          <p className="truncate text-sm font-semibold text-ink-950">{organizationName}</p>
          {locationLabel ? (
            <p className="mt-0.5 truncate text-xs text-ink-500">{locationLabel}</p>
          ) : null}
          <Link
            to={`/s/${organizationSlug}/profile`}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-600 hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            {t('app:nav.viewPublicProfile')}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </aside>
  )
}
