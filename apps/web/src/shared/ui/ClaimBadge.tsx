import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { IconVerified } from '@/shared/ui/icons'

export interface ClaimBadgeProps {
  state: 'unclaimed' | 'claimed' | 'verified'
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Claimed et verified sont deux concepts DISTINCTS : revendiqué n'a pas
 * droit au traitement « vérifié ». `unclaimed` est transparent, neutre,
 * digne de confiance — jamais de rouge, jamais d'icône d'alerte, jamais de
 * ton de mise en garde (MASTER_SPEC §9).
 */
export function ClaimBadge({ state, size = 'md', className }: ClaimBadgeProps) {
  const { t } = useTranslation('v2')

  const label = {
    unclaimed: t('states.claim.unclaimed'),
    claimed: t('states.claim.claimed'),
    verified: t('states.claim.verified'),
  }[state]

  return (
    <span
      data-state={state}
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-control)] border px-2 py-0.5 font-medium',
        size === 'sm' ? 'text-fu-xs' : 'text-fu-sm',
        state === 'unclaimed' && 'border-[var(--fu-border)] text-[var(--fu-text-secondary)]',
        state === 'claimed' && 'border-[var(--fu-border-strong)] text-[var(--fu-text-primary)]',
        // Label in ink on the soft green (18,41:1) — the deep-green icon
        // carries the brand signal, the text stays fully readable.
        state === 'verified' && 'border-transparent bg-[var(--fu-accent-soft)] text-[var(--fu-text-primary)]',
        className,
      )}
    >
      {state === 'verified' && (
        <IconVerified aria-hidden="true" className={cn('text-[var(--fu-accent-text)]', size === 'sm' ? 'size-3' : 'size-3.5')} />
      )}
      {label}
    </span>
  )
}
