import { NavLink, type NavLinkProps } from 'react-router-dom'
import { cn } from '@/lib/cn'

/** react-router `NavLink` with FadeUp's active-state styling baked in — shared by the app shell and marketing nav. */
export function AppNavLink({ className, ...props }: NavLinkProps) {
  return (
    <NavLink
      className={(renderProps) =>
        cn(
          'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors',
          // `paper-0`, not `on-accent`: the active pill's background is
          // `ink-950`, which INVERTS in dark mode, so its label has to invert
          // with it. `on-accent` deliberately stays near-white in both themes
          // (it means "readable on a coloured surface"), which made the active
          // link white-on-white in dark mode.
          renderProps.isActive ? 'bg-ink-950 text-paper-0' : 'text-ink-700 hover:bg-paper-100',
          typeof className === 'function' ? className(renderProps) : className,
        )
      }
      {...props}
    />
  )
}
