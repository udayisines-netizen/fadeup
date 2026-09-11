import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { formatDateTime } from '@/shared/lib/format'
import type { TimeBlockRow } from '@/features/pro-agenda/api/agenda'

/**
 * OS-1 — le temps bloqué : une zone HACHURÉE (motif diagonal sur
 * `--fu-border`), sans barre d'état, sans bordure forte — ce n'est pas un
 * objet à traiter mais une indisponibilité déclarée. Le motif (forme) porte
 * l'information, jamais la couleur seule ; le libellé « Bloqué » + le motif
 * saisi restent lisibles.
 */
export interface TimeBlockCardProps {
  block: TimeBlockRow
  timezone: string
  variant: 'grid' | 'chip'
  height?: number
  onOpen: (block: TimeBlockRow) => void
  style?: React.CSSProperties
  className?: string
}

const HATCH =
  'repeating-linear-gradient(135deg, transparent 0 6px, var(--fu-border) 6px 7px)'

export function TimeBlockCard({ block, timezone, variant, height, onOpen, style, className }: TimeBlockCardProps) {
  const { t, i18n } = useTranslation('v2')
  const compact = variant === 'grid' && (height ?? 0) < 44
  const time = `${formatDateTime(block.starts_at, timezone, 'time', i18n.language)}–${formatDateTime(block.ends_at, timezone, 'time', i18n.language)}`
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="agenda-block"
      data-block-id={block.id}
      aria-label={`${t('pro.agenda.card.block')} · ${block.reason ?? ''} · ${time}`.trim()}
      onClick={(event) => {
        event.stopPropagation()
        onOpen(block)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(block)
        }
      }}
      style={{ ...style, backgroundImage: HATCH }}
      className={cn(
        'overflow-hidden rounded-[var(--radius-control)] border border-[var(--fu-border)] bg-[var(--fu-surface-subtle)] text-start',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--fu-focus)]',
        variant === 'grid' ? 'absolute px-2 py-1' : 'flex min-h-11 w-full items-center gap-2 px-3 py-1.5',
        className,
      )}
    >
      {variant === 'chip' ? (
        <>
          <span className="w-12 shrink-0 font-fu-mono text-fu-xs tabular-nums text-[var(--fu-text-secondary)]">
            {formatDateTime(block.starts_at, timezone, 'time', i18n.language)}
          </span>
          <span className="min-w-0 flex-1 truncate text-fu-sm text-[var(--fu-text-secondary)]">
            <span className="font-medium text-[var(--fu-text-primary)]">{t('pro.agenda.card.block')}</span>
            {block.reason && <span> · {block.reason}</span>}
          </span>
        </>
      ) : (
        <p className={cn('truncate text-[var(--fu-text-secondary)]', compact ? 'text-fu-xs leading-4' : 'text-fu-sm leading-5')}>
          <span className="font-medium text-[var(--fu-text-primary)]">{t('pro.agenda.card.block')}</span>
          {block.reason && <span> · {block.reason}</span>}
          {!compact && <span className="ms-2 font-fu-mono text-fu-xs tabular-nums">{time}</span>}
        </p>
      )}
    </div>
  )
}
