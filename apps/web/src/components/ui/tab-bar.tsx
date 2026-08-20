import type { ComponentType, ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/cn'

/**
 * The phone's primary navigation.
 *
 * Both FadeUp products get one — Professional and Customer — because on a
 * phone a hamburger is a list of things you have to remember exist, while a
 * tab bar is a list of things you can see. The trade is that it costs a fixed
 * strip of screen, which is why it holds four or five destinations and never
 * more; a sixth turns every icon into a guess.
 *
 * The Professional bar carries a raised central action. That slot exists
 * because the most frequent thing a shop does on a phone is add something —
 * a walk-in, a booking, a block — and burying that behind a page is the
 * difference between a tool used at the chair and one used at the desk.
 */

export interface TabItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** Exact match, for a root path that would otherwise match everything below it. */
  end?: boolean
  /** A count worth interrupting for. Zero renders nothing. */
  badge?: number
}

export function TabBar({
  items,
  centerAction,
  className,
  ariaLabel,
}: {
  items: TabItem[]
  /** Rendered raised, between the two halves of the bar. */
  centerAction?: ReactNode
  className?: string
  ariaLabel: string
}) {
  // Split so the raised action sits in the visual middle regardless of count.
  const half = Math.ceil(items.length / 2)
  const [left, right] = centerAction ? [items.slice(0, half), items.slice(half)] : [items, []]

  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-paper-0/95 backdrop-blur',
        'pb-[env(safe-area-inset-bottom)]',
        className,
      )}
    >
      <div className="relative mx-auto flex max-w-2xl items-stretch">
        {left.map((item) => (
          <Tab key={item.to} item={item} />
        ))}

        {centerAction ? (
          <div className="relative flex w-20 shrink-0 items-start justify-center">
            {/* Lifted above the bar. -top rather than a transform so it does
                not create a stacking context that would clip the FAB's ring. */}
            <div className="absolute -top-5">{centerAction}</div>
          </div>
        ) : null}

        {right.map((item) => (
          <Tab key={item.to} item={item} />
        ))}
      </div>
    </nav>
  )
}

function Tab({ item }: { item: TabItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          // 56px tall: comfortably past the 44px target, and tall enough that
          // the label never crowds the icon once translated into German.
          'relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 py-2',
          'transition-colors duration-[--fu-duration-quick] motion-reduce:transition-none',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700',
          isActive ? 'text-accent-600' : 'text-ink-500',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span className="relative">
            <Icon className={cn('h-5 w-5', isActive && 'scale-110')} aria-hidden="true" />
            {item.badge && item.badge > 0 ? (
              <span className="absolute -end-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-600 px-1 text-[10px] font-semibold text-on-accent">
                {item.badge > 9 ? '9+' : item.badge}
              </span>
            ) : null}
          </span>
          {/* Active state is weight + colour, never colour alone. */}
          <span className={cn('truncate text-[11px] leading-none', isActive && 'font-semibold')}>
            {item.label}
          </span>
        </>
      )}
    </NavLink>
  )
}
