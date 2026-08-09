import type { ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'

interface ErrorStateProps {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

/**
 * Consistent "this failed to load" state for lists/tables/pages, paired with
 * `EmptyState`. Distinct shape (not just recolored) so failure never reads
 * as "there's nothing here" — announced via `role="alert"` for assistive
 * tech.
 */
export function ErrorState({ title, description, action, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-2 rounded-md border border-danger-100 bg-danger-100/40 px-6 py-10 text-center',
        className,
      )}
    >
      <CircleAlert className="h-8 w-8 text-danger-600" aria-hidden="true" />
      <p className="text-sm font-medium text-ink-950">{title}</p>
      {description ? <p className="text-sm text-ink-500">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
