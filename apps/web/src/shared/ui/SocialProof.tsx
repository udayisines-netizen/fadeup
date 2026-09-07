import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { MetricValue } from '@/shared/ui/MetricValue'

export interface SocialProofProps {
  /** null = donnée absente — MetricValue rend « — », jamais un zéro fabriqué. */
  followers: number | null
  verifiedClients: number | null
  rating: number | null
  reviews: number | null
  likes: number | null
  className?: string
}

/**
 * Les CINQ métriques de preuve sociale (MASTER_SPEC §9), toujours les cinq,
 * toujours distinctes — icône, notation et typographie diffèrent par
 * construction dans MetricValue, et rien ne les agrège jamais.
 */
export function SocialProof({ followers, verifiedClients, rating, reviews, likes, className }: SocialProofProps) {
  const { t } = useTranslation('v2')
  return (
    <section aria-label={t('profile.metrics.label')} className={cn('flex flex-col items-start gap-2.5', className)} data-testid="social-proof">
      <MetricValue kind="followers" value={followers} />
      <MetricValue kind="verified-clients" value={verifiedClients} />
      <MetricValue kind="rating" value={rating} />
      <MetricValue kind="reviews" value={reviews} />
      <MetricValue kind="likes" value={likes} />
    </section>
  )
}
