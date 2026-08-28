import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Heart } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useMyFavorites, useAddFavorite, useRemoveFavorite } from '@/lib/queries/customer-app'
import { cn } from '@/lib/cn'

interface FavoriteButtonProps {
  organizationId: string
  className?: string
}

/**
 * Save a shop — a private bookmark, and NOT a follow.
 *
 * §15: Follow Shop writes `organization_follows` and is a social relationship;
 * Favourite writes `customer_favorites` and is a list only its owner sees.
 * They appear side by side on the shop profile precisely so the difference is
 * legible, and neither one implies the other.
 *
 * Signed-out visitors get a link to /login carrying a redirect back here,
 * rather than a button that silently fails — favourites genuinely belong to an
 * account.
 *
 * The labels used to be English string literals sitting in default parameter
 * values, which is a shape `no-hardcoded-strings` cannot see: it scans JSX,
 * and a default argument is not JSX. They now come from the `marketplace`
 * namespace like every other label in the product, which also removed the
 * duplicated `t('marketplace:card.addFavorite')` every caller was passing in.
 */
export function FavoriteButton({ organizationId, className }: FavoriteButtonProps) {
  const { t } = useTranslation('marketplace')
  const { user } = useAuth()
  const location = useLocation()
  const favoritesQuery = useMyFavorites(Boolean(user))
  const addFavorite = useAddFavorite()
  const removeFavorite = useRemoveFavorite()

  const favoriteLabel = t('card.addFavorite')
  const unfavoriteLabel = t('card.removeFavorite')

  const existing = favoritesQuery.data?.find(
    (favorite) => favorite.organizationId === organizationId && favorite.barberId === null,
  )

  // A full 44px target even though the glyph inside stays small: this is an
  // icon-only affordance on a mobile-first consumer surface, and it sits
  // beside a Follow control of the same height so the pair reads as a set.
  const shape = cn(
    'relative z-10 inline-flex h-[--fu-control-md] w-[--fu-control-md] items-center justify-center rounded-full',
    'transition-colors duration-[--fu-duration-quick] motion-reduce:transition-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700',
    className,
  )

  if (!user) {
    const redirectTarget = `${location.pathname}${location.search}`
    return (
      <Link
        to={`/login?redirect=${encodeURIComponent(redirectTarget)}`}
        aria-label={favoriteLabel}
        className={cn(shape, 'text-ink-500 hover:bg-paper-100 hover:text-ink-700')}
      >
        <Heart className="h-5 w-5" aria-hidden="true" />
      </Link>
    )
  }

  const isPending = addFavorite.isPending || removeFavorite.isPending

  function handleClick() {
    if (existing) {
      removeFavorite.mutate(existing.favoriteId)
    } else {
      addFavorite.mutate({ organizationId })
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending || favoritesQuery.isPending}
      aria-pressed={Boolean(existing)}
      aria-label={existing ? unfavoriteLabel : favoriteLabel}
      className={cn(
        shape,
        'hover:bg-paper-100 disabled:opacity-50',
        // Fill AND colour change together: a saved heart must not be
        // distinguishable by hue alone (WCAG 1.4.1).
        existing ? 'text-danger-600' : 'text-ink-500 hover:text-ink-700',
      )}
    >
      <Heart className={cn('h-5 w-5', existing ? 'fill-current' : '')} aria-hidden="true" />
    </button>
  )
}
