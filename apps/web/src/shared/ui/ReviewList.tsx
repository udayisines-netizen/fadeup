import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { Rating } from '@/shared/ui/Rating'
import { DateTime } from '@/shared/ui/DateTime'

export interface ReviewListItem {
  review_id: string
  rating: number
  comment: string | null
  created_at: string
  reviewer_display_name: string | null
  reply_body: string | null
  replied_at: string | null
}

export interface ReviewListProps {
  reviews: readonly ReviewListItem[]
  /** Fuseau du lieu — les dates d'avis restent des dates simples. */
  timezone: string
  className?: string
}

/**
 * Liste d'avis (B4) — des rangées à filet fin, pas des cartes à ombre
 * (direction A). Chaque avis est réel : issu d'une prestation terminée,
 * du compte réservataire, fenêtre 30 jours — la base le garantit. L'ÉTAT
 * VIDE appartient à l'appelant (le contexte décide de l'action).
 */
export function ReviewList({ reviews, timezone, className }: ReviewListProps) {
  const { t } = useTranslation('v2')
  return (
    <ul className={cn('flex flex-col', className)} data-testid="review-list">
      {reviews.map((review) => (
        <li key={review.review_id} className="border-b border-[var(--fu-border)] py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-fu-sm font-medium text-[var(--fu-text-primary)]">
              {review.reviewer_display_name?.trim() || t('profile.reviews.anonymous')}
            </span>
            <span className="flex items-center gap-2">
              <Rating value={review.rating} showCount={false} size="sm" />
              <DateTime value={review.created_at} timezone={timezone} format="date" className="text-fu-xs text-[var(--fu-text-secondary)]" />
            </span>
          </div>
          {review.comment && <p className="mt-1.5 text-fu-sm leading-relaxed">{review.comment}</p>}
          {review.reply_body && (
            <div className="mt-2 border-s-2 border-[var(--fu-border-strong)] ps-3">
              <p className="text-fu-xs font-medium text-[var(--fu-text-secondary)]">{t('profile.reviews.replyLabel')}</p>
              <p className="mt-0.5 text-fu-sm leading-relaxed">{review.reply_body}</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
