import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { IconClients, IconLike, IconReviews, IconStar, IconVerified } from '@/shared/ui/icons'

export interface MetricValueProps {
  kind: 'followers' | 'verified-clients' | 'rating' | 'reviews' | 'likes'
  /** null = pas de donnée — état vide honnête (« — »), jamais un zéro fabriqué. */
  value: number | null
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Cinq métriques, cinq traitements visuellement distincts (MASTER_SPEC §9) :
 * icône, notation et typographie diffèrent — Followers n'est jamais
 * confondable avec Verified Clients, et rien ne les agrège.
 */
export function MetricValue({ kind, value, size = 'md', className }: MetricValueProps) {
  const { t, i18n } = useTranslation('v2')
  const locale = i18n.language

  const labelKey = {
    followers: 'states.metric.followers',
    'verified-clients': 'states.metric.verifiedClients',
    rating: 'states.metric.rating',
    reviews: 'states.metric.reviews',
    likes: 'states.metric.likes',
  }[kind]

  const renderValue = (): string => {
    if (value === null) return t('states.metric.noData')
    switch (kind) {
      case 'followers':
        // Compact notation — social scale reads as "1,2 k", not "1247".
        return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
      case 'rating':
        return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
      default:
        return new Intl.NumberFormat(locale).format(value)
    }
  }

  const icon = {
    followers: <IconClients aria-hidden="true" />,
    'verified-clients': <IconVerified aria-hidden="true" />,
    rating: <IconStar aria-hidden="true" className="fill-current" />,
    reviews: <IconReviews aria-hidden="true" />,
    likes: <IconLike aria-hidden="true" />,
  }[kind]

  return (
    <span
      data-kind={kind}
      className={cn(
        'inline-flex items-center gap-1.5',
        size === 'sm' ? 'text-fu-xs' : 'text-fu-sm',
        kind === 'verified-clients' && 'text-[var(--fu-accent-text)]',
        className,
      )}
    >
      <span className={cn('inline-flex shrink-0', size === 'sm' ? '[&>svg]:size-3.5' : '[&>svg]:size-4')}>{icon}</span>
      <span
        className={cn(
          value === null ? 'text-[var(--fu-text-secondary)]' : 'font-medium',
          // Numeric-column kinds read in mono; social counts stay in sans —
          // one more axis keeping the five metrics apart.
          (kind === 'rating' || kind === 'verified-clients') && 'font-fu-mono tabular-nums',
        )}
      >
        {renderValue()}
      </span>
      <span className="text-[var(--fu-text-secondary)]">{t(labelKey)}</span>
    </span>
  )
}
