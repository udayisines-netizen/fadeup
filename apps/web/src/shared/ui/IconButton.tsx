import { cn } from '@/shared/lib/cn'
import { Spinner } from '@/shared/ui/Spinner'

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — an icon-only control without one is a defect. */
  'aria-label': string
  variant?: 'plain' | 'outline'
  loading?: boolean
  ref?: React.Ref<HTMLButtonElement>
}

export function IconButton({
  variant = 'plain',
  loading = false,
  disabled,
  className,
  children,
  type,
  ref,
  ...rest
}: IconButtonProps) {
  const isDisabled = disabled || loading
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={isDisabled}
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)]',
        'text-[var(--fu-text-primary)] transition-colors duration-[var(--fu-dur-instant)] ease-[var(--fu-ease)]',
        'hover:bg-[var(--fu-surface-subtle)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--fu-canvas)]',
        'disabled:cursor-not-allowed',
        loading ? '' : 'disabled:opacity-45',
        variant === 'outline' && 'border border-[var(--fu-border-strong)]',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size="sm" announce /> : <span className="inline-flex [&>svg]:size-5">{children}</span>}
    </button>
  )
}
