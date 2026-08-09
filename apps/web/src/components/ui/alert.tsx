import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type AlertVariant = 'error' | 'success' | 'info'

interface AlertProps {
  variant: AlertVariant
  children: ReactNode
  className?: string
}

const VARIANT_CLASSES: Record<AlertVariant, string> = {
  error: 'border-red-200 bg-red-50 text-red-800',
  success: 'border-green-200 bg-green-50 text-green-800',
  info: 'border-neutral-200 bg-neutral-50 text-neutral-700',
}

/** Inline status banner. Uses `role="alert"` for errors so assistive tech announces them. */
export function Alert({ variant, children, className }: AlertProps) {
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn('rounded-md border px-3 py-2 text-sm', VARIANT_CLASSES[variant], className)}
    >
      {children}
    </div>
  )
}
