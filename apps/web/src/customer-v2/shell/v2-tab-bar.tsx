import type { ComponentType } from 'react'
import { NavLink } from 'react-router-dom'

/**
 * The customer bottom navigation — Design Pass A §0.
 *
 * ============================================================================
 * FIVE EQUAL DESTINATIONS. NO FLOATING BUTTON. NO SLIDING INDICATOR.
 * ============================================================================
 *
 * Home · Marketplace · Book · Appointments · Profile, all the same size and
 * weight. Book stays part of the navigation (the conversion Book lives on
 * results and profiles, where a customer has chosen someone to book WITH).
 *
 * The earlier revision moved a tinted pill between tabs with a shared
 * layoutId. The Fresha direction explicitly retires that: a restrained fixed
 * bar — solid white, one thin top hairline, no glass, no capsule, no
 * travelling indicator. Selection is carried by colour and weight alone, and
 * the only motion is a ~150ms icon settle on the tab that just became
 * active, driven by CSS so reduced-motion strips it with everything else.
 *
 * 64px of bar + safe area; every target is the full 64px column height.
 */

export interface V2NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>
  /** Exact matching, for the index route that would otherwise match everything. */
  end?: boolean
}

export function V2TabBar({ items, ariaLabel }: { items: V2NavItem[]; ariaLabel: string }) {
  return (
    <nav
      aria-label={ariaLabel}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-v2-hairline bg-v2-paper lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex w-full max-w-lg items-stretch">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.end}
              className="group flex h-16 flex-col items-center justify-center gap-1 text-v2-ink-soft aria-[current=page]:text-v2-green"
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className={
                      isActive
                        ? 'h-[1.35rem] w-[1.35rem] scale-105 transition-transform duration-150 motion-reduce:transition-none'
                        : 'h-[1.35rem] w-[1.35rem] transition-transform duration-150 motion-reduce:transition-none'
                    }
                    strokeWidth={isActive ? 2.1 : 1.7}
                    aria-hidden={true}
                  />
                  <span
                    className={
                      isActive
                        ? 'text-v2-eyebrow font-semibold tracking-[0.01em]'
                        : 'text-v2-eyebrow font-medium tracking-[0.01em]'
                    }
                  >
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
