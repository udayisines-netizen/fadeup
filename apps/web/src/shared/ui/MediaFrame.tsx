import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { IconCamera } from '@/shared/ui/icons'

export interface MediaFrameProps {
  src?: string | null
  alt: string
  ratio?: 'portrait' | 'square' | 'landscape' | 'video'
  /** Vignettes (< ~96 px) : icône seule, le libellé « pas de photo » n'y tient pas. */
  compact?: boolean
  className?: string
  children?: React.ReactNode
}

const RATIOS = {
  portrait: 'aspect-[3/4]',
  square: 'aspect-square',
  landscape: 'aspect-[4/3]',
  video: 'aspect-video',
} as const

/**
 * Cadre média avec état « média manquant » de première classe : un profil
 * sans photo est un cas FRÉQUENT, pas une exception. Le cadre vide est
 * honnête — libellé + icône, jamais une fausse image, jamais un dégradé posé
 * sur du vide.
 */
export function MediaFrame({ src, alt, ratio = 'square', compact = false, className, children }: MediaFrameProps) {
  const { t } = useTranslation('v2')
  const [failed, setFailed] = useState(false)
  const showMedia = Boolean(src) && !failed

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[var(--radius-media)] bg-[var(--fu-surface-subtle)]',
        RATIOS[ratio],
        className,
      )}
    >
      {showMedia ? (
        <img src={src ?? undefined} alt={alt} onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        <div
          className="flex size-full flex-col items-center justify-center gap-1.5 rounded-[var(--radius-media)] border border-[var(--fu-border)]"
          role="img"
          aria-label={t('states.media.missing')}
        >
          <IconCamera aria-hidden="true" className={cn('text-[var(--fu-text-tertiary)]', compact ? 'size-4' : 'size-5')} />
          {!compact && <span className="text-fu-xs text-[var(--fu-text-secondary)]">{t('states.media.missing')}</span>}
        </div>
      )}
      {children}
    </div>
  )
}
