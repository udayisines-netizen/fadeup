import { cn } from '@/shared/lib/cn'
import { IconCheck } from '@/shared/ui/icons'

export interface ChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: React.ReactNode
  /** Puce filtrante : `selected` est porté par aria-pressed ET par la coche. */
  selected?: boolean
  ref?: React.Ref<HTMLButtonElement>
}

export function Chip({ children, selected = false, className, type, ref, ...rest }: ChipProps) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-pressed={selected}
      className={cn(
        'fu-press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-fu-sm font-medium md:min-h-9',
        'transition-colors duration-[var(--fu-dur-instant)] ease-[var(--fu-ease)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--fu-canvas)]',
        selected
          ? 'border-transparent bg-[var(--fu-accent-soft)] text-[var(--fu-text-primary)]'
          : 'border-[var(--fu-border-strong)] text-[var(--fu-text-primary)] hover:bg-[var(--fu-surface-subtle)]',
        className,
      )}
      {...rest}
    >
      {/* La sélection n'est jamais signalée par la seule couleur. */}
      {selected && <IconCheck aria-hidden="true" className="size-3.5" />}
      {children}
    </button>
  )
}
