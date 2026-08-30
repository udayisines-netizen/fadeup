import type { ComponentType } from 'react'
import { NavLink } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'

/**
 * The customer bottom navigation.
 *
 * ============================================================================
 * FIVE EQUAL DESTINATIONS. NO FLOATING BUTTON.
 * ============================================================================
 *
 * Home · Marketplace · Book · Appointments · Profile, in that order, all the
 * same size and the same weight. The blueprint is explicit about both halves:
 * Book is central in ORDER but stays part of the navigation, and there is no
 * floating action button.
 *
 * That is a change from R5, which raised BOOK out of the bar as a prominent
 * centre action — and the reasoning for the change is worth stating, because
 * it is not "the old one looked wrong". A tab bar answers "where am I", and a
 * conversion button answers "do the thing". Merging them makes the most
 * prominent control on every screen a navigation target that leads to a chooser
 * rather than to a booking. Book earns its green where a customer has already
 * chosen someone to book WITH — on a result, on a profile — not as permanent
 * chrome above every screen in the product.
 *
 * ============================================================================
 * THE SELECTION INDICATOR IS THE MOTION
 * ============================================================================
 *
 * MOTION_SYSTEM.md §3 asks for a short, restrained response on selection, and
 * §1 asks every animation to answer a question — here, "what is selected".
 * A single tinted pill behind the active icon slides between tabs with one
 * shared `layoutId`, so the eye follows one object moving rather than watching
 * one shape vanish and another appear. Under `prefers-reduced-motion` the pill
 * is still drawn and simply stops travelling: the state remains visible, which
 * §19 requires, and the spatial movement goes, which §19 also requires.
 *
 * Targets are 56px tall inside a 64px bar, above the safe area, so every one
 * clears the 44px floor with room for a thumb.
 */

export interface V2NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>
  /** Exact matching, for the index route that would otherwise match everything. */
  end?: boolean
}

export function V2TabBar({ items, ariaLabel }: { items: V2NavItem[]; ariaLabel: string }) {
  const reduced = useReducedMotion()

  return (
    <nav
      aria-label={ariaLabel}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-v2-hairline bg-v2-paper/95 backdrop-blur-sm lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex w-full max-w-lg items-stretch">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.end}
              className="v2-press flex h-14 flex-col items-center justify-center gap-1 rounded-v2-2 text-v2-ink-mute aria-[current=page]:text-v2-green"
            >
              {({ isActive }) => (
                <>
                  <span className="relative flex h-7 w-12 items-center justify-center">
                    {isActive ? (
                      <motion.span
                        layoutId="v2-tab-indicator"
                        aria-hidden="true"
                        className="absolute inset-0 rounded-v2-2 bg-v2-green-tint"
                        transition={
                          reduced
                            ? { duration: 0 }
                            : { type: 'spring', stiffness: 520, damping: 38, mass: 0.7 }
                        }
                      />
                    ) : null}
                    <item.icon
                      className="relative h-[1.3rem] w-[1.3rem]"
                      strokeWidth={isActive ? 2.2 : 1.7}
                      aria-hidden={true}
                    />
                  </span>
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
