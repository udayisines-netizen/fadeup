import * as RadixDialog from '@radix-ui/react-dialog'
import { LazyMotion, MotionConfig, animate, domMax, m, useMotionValue } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePrefersReducedMotion } from '@/shared/hooks/usePrefersReducedMotion'
import { cn } from '@/shared/lib/cn'
import { IconButton } from '@/shared/ui/IconButton'
import { IconClose } from '@/shared/ui/icons'

/** Vrai sous 768 px — la feuille est BASSE (ressort + glissement) ; au-dessus
 *  elle reste latérale (glissement CSS inline-end, RTL-sûr). */
function useIsBottomSheet(): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    const onChange = () => setMatches(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return matches
}

export interface SheetProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode
  title: string
  description?: string
  children: React.ReactNode
  className?: string
  /**
   * D1 — média d'en-tête (bannière + portrait de la feuille de résultat),
   * rendu AU-DESSUS de la ligne de titre, bord à bord. Le titre reste
   * obligatoire (Radix exige un Title accessible).
   */
  hero?: React.ReactNode
  /** Masque visuellement la ligne de titre (le hero la porte déjà). */
  hideHeader?: boolean
}

/**
 * Feuille : entre par le BAS sous 768 px (coins hauts en `--radius-sheet`),
 * par le CÔTÉ inline-end au-dessus — propriétés logiques uniquement, jamais
 * `right`, donc le côté s'inverse correctement en RTL.
 *
 * D1 §8 : sous 768 px l'entrée est un RESSORT (Framer Motion — révoque
 * l'interdit P1c), et la feuille SE FERME PAR GLISSEMENT vers le bas depuis
 * sa zone d'en-tête (hero/poignée/titre) — le corps garde son défilement.
 * `prefers-reduced-motion` : aucune translation, un fondu < 100 ms
 * (useReducedMotion + MotionConfig user — non négociable).
 */
export function Sheet({ open, onOpenChange, trigger, title, description, children, className, hero, hideHeader = false }: SheetProps) {
  const { t } = useTranslation('v2')
  const isBottom = useIsBottomSheet()
  const reduced = usePrefersReducedMotion()
  /* Le glissement de fermeture part de la zone d'EN-TÊTE (hero, poignée,
     titre) — le corps garde son défilement vertical intact. Geste MANUEL
     sur une MotionValue : pointer capture, translation ≥ 0 seulement,
     relâche → fermeture au-delà du seuil, sinon ressort de retour. */
  const dragY = useMotionValue(0)
  const dragState = useRef<{ pointerId: number; startY: number } | null>(null)

  const onZonePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduced) return
    /* Arrête toute animation en cours sur la valeur (le ressort d'entrée
       la piloterait encore et écraserait le geste). */
    dragY.stop()
    dragState.current = { pointerId: event.pointerId, startY: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onZonePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current
    if (!state || event.pointerId !== state.pointerId) return
    dragY.set(Math.max(0, event.clientY - state.startY))
  }
  const onZonePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current
    if (!state || event.pointerId !== state.pointerId) return
    dragState.current = null
    if (dragY.get() > 90) {
      onOpenChange?.(false)
    } else {
      void animate(dragY, 0, { type: 'spring', stiffness: 420, damping: 36 })
    }
  }

  const heroBlock =
    hero != null ? (
      <div className="relative shrink-0">
        {hero}
        <RadixDialog.Close asChild>
          <IconButton
            aria-label={t('common.a11y.closeDialog')}
            className="absolute end-3 top-3 bg-[var(--fu-surface)] shadow-[var(--fu-shadow-card)]"
          >
            <IconClose />
          </IconButton>
        </RadixDialog.Close>
      </div>
    ) : null

  const headerBlock = (
    <div
      className={cn(
        'flex items-start justify-between gap-3 border-b border-[var(--fu-border)] p-4',
        hideHeader && 'sr-only',
      )}
    >
      <div>
        <RadixDialog.Title className="text-fu-lg font-semibold text-[var(--fu-text-primary)]">{title}</RadixDialog.Title>
        {description ? (
          <RadixDialog.Description className="mt-0.5 text-fu-sm text-[var(--fu-text-secondary)]">
            {description}
          </RadixDialog.Description>
        ) : null}
      </div>
      {hero == null && (
        <RadixDialog.Close asChild>
          <IconButton aria-label={t('common.a11y.closeDialog')}>
            <IconClose />
          </IconButton>
        </RadixDialog.Close>
      )}
    </div>
  )

  const bodyBlock = <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger != null && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fu-scrim-in fixed inset-0 z-[var(--fu-z-overlay)] bg-[var(--fu-scrim)]" />
        {isBottom ? (
          /* Bottom sheet — le Content positionne, le m.div ANIME (ressort)
             et porte le geste de fermeture. */
          <RadixDialog.Content
            className={cn(
              'fixed start-0 end-0 bottom-0 z-[var(--fu-z-modal)] flex max-h-[85dvh] flex-col focus:outline-none',
              className,
            )}
          >
            <LazyMotion features={domMax} strict>
              <MotionConfig reducedMotion="user">
                <m.div
                  data-testid="sheet-panel"
                  initial={reduced ? { opacity: 0 } : { y: '100%' }}
                  animate={reduced ? { opacity: 1 } : { y: 0 }}
                  transition={
                    reduced
                      ? { duration: 0.09 }
                      : { type: 'spring', stiffness: 420, damping: 36, mass: 0.9 }
                  }
                  style={{ y: dragY }}
                  className={cn(
                    'flex min-h-0 flex-col rounded-t-[var(--radius-sheet)] bg-[var(--fu-surface)]',
                    'pb-[env(safe-area-inset-bottom)] shadow-[var(--fu-shadow-sheet,none)]',
                    hero != null && 'overflow-hidden',
                  )}
                >
                  <div
                    className="touch-none select-none"
                    data-testid="sheet-drag-zone"
                    onPointerDown={onZonePointerDown}
                    onPointerMove={onZonePointerMove}
                    onPointerUp={onZonePointerEnd}
                    onPointerCancel={onZonePointerEnd}
                    /* Le glisser NATIF d'une image (hero) annulerait le geste
                       par un pointercancel — neutralisé ici. */
                    onDragStartCapture={(event) => event.preventDefault()}
                  >
                    {heroBlock}
                    {headerBlock}
                  </div>
                  {bodyBlock}
                </m.div>
              </MotionConfig>
            </LazyMotion>
          </RadixDialog.Content>
        ) : (
          /* Side sheet ≥ 768 px — glissement CSS inline-end, RTL-sûr. */
          <RadixDialog.Content
            className={cn(
              'fu-sheet-in fixed inset-y-0 end-0 z-[var(--fu-z-modal)] flex h-dvh w-96 flex-col',
              'border-s border-[var(--fu-border)] bg-[var(--fu-surface)]',
              hero != null && 'overflow-hidden',
              className,
            )}
          >
            {heroBlock}
            {headerBlock}
            {bodyBlock}
          </RadixDialog.Content>
        )}
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
