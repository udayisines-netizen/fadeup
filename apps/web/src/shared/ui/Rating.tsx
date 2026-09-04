import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { IconStar } from '@/shared/ui/icons'

export interface RatingProps {
  /** null = aucun avis — affiche « Pas encore d'avis », JAMAIS zéro étoile. */
  value: number | null
  count?: number
  size?: 'sm' | 'md'
  showCount?: boolean
  className?: string
}

export function Rating({ value, count, size = 'md', showCount = true, className }: RatingProps) {
  const { t, i18n } = useTranslation('v2')

  // A brand-new profile has no reviews — saying so honestly protects the
  // professional; a fabricated zero-star row would destroy them.
  if (value === null) {
    return (
      <span className={cn('text-[var(--fu-text-secondary)]', size === 'sm' ? 'text-fu-xs' : 'text-fu-sm', className)}>
        {t('states.rating.none')}
      </span>
    )
  }

  const formatted = new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)

  return (
    <span
      className={cn('inline-flex items-center gap-1', size === 'sm' ? 'text-fu-xs' : 'text-fu-sm', className)}
      aria-label={t('states.rating.valueLabel', { value: formatted })}
    >
      <IconStar aria-hidden="true" className={cn('fill-current', size === 'sm' ? 'size-3.5' : 'size-4')} />
      <span className="font-fu-mono font-medium tabular-nums">{formatted}</span>
      {showCount && count !== undefined && (
        <span className="text-[var(--fu-text-secondary)]">{t('states.rating.countLabel', { count })}</span>
      )}
    </span>
  )
}
