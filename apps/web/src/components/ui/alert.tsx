import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, CircleAlert, Info } from 'lucide-react'
import { cn } from '@/lib/cn'

type AlertVariant = 'error' | 'success' | 'info' | 'warning'

interface AlertProps {
  variant: AlertVariant
  children: ReactNode
  className?: string
}

const VARIANT_CLASSES: Record<AlertVariant, string> = {
  error: 'border-danger-100 bg-danger-100/60 text-danger-700',
  success: 'border-success-100 bg-success-100/60 text-success-700',
  info: 'border-info-100 bg-info-100/60 text-info-700',
  warning: 'border-warning-100 bg-warning-100/60 text-warning-700',
}

const VARIANT_ICONS: Record<AlertVariant, typeof Info> = {
  error: CircleAlert,
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
}

/**
 * Persistent inline status banner. Uses `role="alert"` for errors (assistive
 * tech announces immediately) and `role="status"` otherwise. Always paired
 * with an icon so status isn't communicated by color alone.
 */
export function Alert({ variant, children, className }: AlertProps) {
  const Icon = VARIANT_ICONS[variant]

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-sm', VARIANT_CLASSES[variant], className)}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
