import { cn } from '@/shared/lib/cn'

export interface BadgeProps {
  children: React.ReactNode
  variant?: 'neutral' | 'brand' | 'outline'
  className?: string
}

/** Petit libellé passif (12 px autorisé ici — badges et puces uniquement). */
export function Badge({ children, variant = 'neutral', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-control)] px-2 py-0.5 text-fu-xs font-medium',
        variant === 'neutral' && 'bg-[var(--fu-surface-subtle)] text-[var(--fu-text-secondary)]',
        variant === 'brand' && 'bg-[var(--fu-accent-soft)] text-[var(--fu-text-primary)]',
        variant === 'outline' && 'border border-[var(--fu-border)] text-[var(--fu-text-secondary)]',
        className,
      )}
    >
      {children}
    </span>
  )
}
