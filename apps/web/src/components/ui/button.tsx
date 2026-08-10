import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from '@/components/ui/spinner'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /** `sm` is for dense/compact contexts (e.g. a table row action) — prefer `md` or `lg` wherever the target is a primary interaction. */
  size?: ButtonSize
  isLoading?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent-600 text-on-accent hover:bg-accent-700 active:bg-accent-800 disabled:bg-accent-200',
  secondary:
    'border border-border-strong bg-paper-0 text-ink-800 hover:bg-paper-100 active:bg-paper-200 disabled:border-border disabled:text-ink-300',
  ghost: 'bg-transparent text-ink-700 hover:bg-paper-100 active:bg-paper-200 disabled:text-ink-300',
  danger: 'bg-danger-600 text-on-accent hover:bg-danger-700 active:bg-danger-700 disabled:bg-danger-100 disabled:text-danger-600',
}

// `sm` is intentionally below the 44px touch target guideline — it exists
// only for dense, mouse-oriented admin contexts (e.g. an inline table row
// action) where a full-size button would break density; `md`/`lg` cover
// every touch-primary and operational context.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-9 gap-1.5 px-3 text-sm',
  md: 'min-h-11 gap-2 px-4 text-sm',
  lg: 'min-h-14 gap-2.5 px-6 text-base',
}

/**
 * Same visual language as `Button` for cases that must render as a real
 * `<Link>`/`<a>` for navigation (never nest an anchor inside a `<button>`,
 * or vice versa — both are interactive elements).
 */
export function buttonVariants(
  { variant = 'primary', size = 'md' }: { variant?: ButtonVariant; size?: ButtonSize } = {},
  className?: string,
): string {
  return cn(
    'inline-flex touch-manipulation items-center justify-center rounded-md font-medium transition-colors',
    'disabled:cursor-not-allowed',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    isLoading = false,
    disabled,
    children,
    leftIcon,
    rightIcon,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={buttonVariants({ variant, size }, className)}
      {...props}
    >
      {isLoading ? (
        <Spinner label="Loading" />
      ) : leftIcon ? (
        <span className="shrink-0" aria-hidden="true">
          {leftIcon}
        </span>
      ) : null}
      {children}
      {!isLoading && rightIcon ? (
        <span className="shrink-0" aria-hidden="true">
          {rightIcon}
        </span>
      ) : null}
    </button>
  )
})
