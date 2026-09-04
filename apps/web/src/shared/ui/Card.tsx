import { cn } from '@/shared/lib/cn'

export interface CardProps {
  children: React.ReactNode
  /** `subtle` pose la surface douce ; le défaut est blanc + filet. Pas d'ombre. */
  variant?: 'outline' | 'subtle' | 'brand'
  className?: string
  ref?: React.Ref<HTMLDivElement>
}

/**
 * Objet réellement borné (ticket, panneau). En direction A la plupart des
 * listes utilisent `Row` — Card est l'exception, pas la règle.
 */
export function Card({ children, variant = 'outline', className, ref }: CardProps) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-[var(--radius-card)] p-4',
        variant === 'outline' && 'border border-[var(--fu-border)] bg-[var(--fu-surface)]',
        variant === 'subtle' && 'bg-[var(--fu-surface-subtle)]',
        variant === 'brand' && 'bg-[var(--fu-surface-brand)]',
        className,
      )}
    >
      {children}
    </div>
  )
}
