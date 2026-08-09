import { NavLink, type NavLinkProps } from 'react-router-dom'
import { cn } from '@/lib/cn'

/** react-router `NavLink` with FadeUp's active-state styling baked in — shared by the app shell and marketing nav. */
export function AppNavLink({ className, ...props }: NavLinkProps) {
  return (
    <NavLink
      className={(renderProps) =>
        cn(
          'inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors',
          renderProps.isActive ? 'bg-ink-950 text-paper-0' : 'text-ink-700 hover:bg-paper-100',
          typeof className === 'function' ? className(renderProps) : className,
        )
      }
      {...props}
    />
  )
}
