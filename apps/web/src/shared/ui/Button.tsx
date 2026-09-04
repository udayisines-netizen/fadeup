import { cn } from '@/shared/lib/cn'
import { Spinner } from '@/shared/ui/Spinner'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * `primary` (vert plein, texte encre) est RÉSERVÉ au CTA transactionnel
   * dominant — un seul par surface. `secondary` (contour) est le registre de
   * Follow. `destructive` n'existe qu'en thème Pro.
   */
  variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  iconStart?: React.ReactNode
  iconEnd?: React.ReactNode
  fullWidth?: boolean
  ref?: React.Ref<HTMLButtonElement>
}

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-[var(--fu-accent)] text-[var(--fu-accent-fg)] hover:bg-[var(--fu-accent-hover)] active:bg-[var(--fu-accent-hover)]',
  secondary:
    'border border-[var(--fu-border-strong)] text-[var(--fu-text-primary)] bg-[var(--fu-surface)] hover:bg-[var(--fu-surface-subtle)]',
  tertiary: 'text-[var(--fu-text-primary)] hover:bg-[var(--fu-surface-subtle)]',
  destructive: 'bg-[var(--fu-danger)] text-[var(--fu-accent-fg)] hover:opacity-90',
}

/* 44 px touch floor on mobile; `sm` may tighten on pointer-accurate desktop. */
const SIZES: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'min-h-11 md:min-h-9 px-3 text-fu-sm',
  md: 'min-h-11 px-4 text-fu-sm',
  lg: 'min-h-12 px-5 text-fu-base',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  iconStart,
  iconEnd,
  fullWidth = false,
  className,
  children,
  type,
  ref,
  ...rest
}: ButtonProps) {
  // `loading` implies `disabled`; the reverse is false.
  const isDisabled = disabled || loading

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={isDisabled}
      data-loading={loading || undefined}
      className={cn(
        'relative inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium',
        'transition-colors duration-[var(--fu-dur-instant)] ease-[var(--fu-ease)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--fu-canvas)]',
        'disabled:cursor-not-allowed',
        // Plain `disabled` dims; `loading` keeps full color — the two states
        // must read differently.
        loading ? '' : 'disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {/* Loading never changes the width: the label keeps its box, invisible,
          and the spinner overlays it. */}
      <span aria-hidden={loading || undefined} className={cn('contents', loading && 'invisible')}>
        {iconStart != null && <span className="inline-flex shrink-0 [&>svg]:size-4">{iconStart}</span>}
        {children}
        {iconEnd != null && <span className="inline-flex shrink-0 [&>svg]:size-4">{iconEnd}</span>}
      </span>
      {loading && (
        <span className="absolute inset-0 inline-flex items-center justify-center">
          <Spinner size="sm" announce />
        </span>
      )}
    </button>
  )
}
