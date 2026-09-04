import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { IconCamera } from '@/shared/ui/icons'

export interface MediaFrameProps {
  src?: string | null
  alt: string
  ratio?: 'portrait' | 'square' | 'landscape' | 'video'
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
export function MediaFrame({ src, alt, ratio = 'square', className, children }: MediaFrameProps) {
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
        <div className="flex size-full flex-col items-center justify-center gap-1.5 border border-[var(--fu-border)] rounded-[var(--radius-media)]">
          <IconCamera aria-hidden="true" className="size-5 text-[var(--fu-text-tertiary)]" />
          <span className="text-fu-xs text-[var(--fu-text-secondary)]">{t('states.media.missing')}</span>
        </div>
      )}
      {children}
    </div>
  )
}
