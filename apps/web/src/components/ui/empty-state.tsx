import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/cn'

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
  icon?: LucideIcon
  className?: string
}

/** Consistent "nothing here yet" state for lists and tables. */
export function EmptyState({ title, description, action, icon: Icon = Inbox, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-md border border-dashed border-border-strong px-6 py-10 text-center',
        className,
      )}
    >
      <Icon className="h-8 w-8 text-ink-300" aria-hidden="true" />
      <p className="text-sm font-medium text-ink-950">{title}</p>
      {description ? <p className="text-sm text-ink-500">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
