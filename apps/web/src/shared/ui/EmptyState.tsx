import { cn } from '@/shared/lib/cn'

export interface EmptyStateProps {
  title: string
  description: string
  /** OBLIGATOIRE : chaque état vide propose une action — un cul-de-sac est un défaut. */
  action: React.ReactNode
  icon?: React.ReactNode
  className?: string
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      {icon != null && (
        <span aria-hidden="true" className="inline-flex text-[var(--fu-text-tertiary)] [&>svg]:size-8">
          {icon}
        </span>
      )}
      <h2 className="text-fu-lg font-semibold text-[var(--fu-text-primary)]">{title}</h2>
      <p className="max-w-sm text-fu-sm text-[var(--fu-text-secondary)]">{description}</p>
      <div className="mt-2">{action}</div>
    </div>
  )
}
