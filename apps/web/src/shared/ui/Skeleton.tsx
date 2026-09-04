import { cn } from '@/shared/lib/cn'

/**
 * Un skeleton reproduit la GÉOMÉTRIE réelle du contenu attendu — un
 * rectangle gris générique n'est pas un skeleton. Les briques ci-dessous se
 * composent pour épouser la forme d'une Row, d'un en-tête, d'une grille.
 * L'animation pulse est déjà neutralisée sous prefers-reduced-motion.
 */

interface SkeletonPieceProps {
  className?: string
}

function pieceClasses(extra?: string) {
  return cn('animate-pulse bg-[var(--fu-border)]', extra)
}

/** Ligne de texte — largeur à passer en classe (`w-1/2`, `w-24`…). */
export function SkeletonText({ className }: SkeletonPieceProps) {
  return <div aria-hidden="true" className={pieceClasses(cn('h-4 rounded-[var(--radius-media)]', className))} />
}

export function SkeletonCircle({ className }: SkeletonPieceProps) {
  return <div aria-hidden="true" className={pieceClasses(cn('size-10 rounded-[var(--radius-avatar)]', className))} />
}

export function SkeletonRect({ className }: SkeletonPieceProps) {
  return <div aria-hidden="true" className={pieceClasses(cn('h-24 rounded-[var(--radius-media)]', className))} />
}

/** La géométrie exacte d'une `Row` : avatar, deux lignes, zone de fin. */
export function SkeletonRow({ className }: SkeletonPieceProps) {
  return (
    <div aria-hidden="true" className={cn('flex min-h-14 items-center gap-3 border-b border-[var(--fu-border)] px-4 py-3', className)}>
      <SkeletonCircle />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <SkeletonText className="w-2/5" />
        <SkeletonText className="h-3 w-3/5" />
      </div>
      <SkeletonText className="w-12" />
    </div>
  )
}
