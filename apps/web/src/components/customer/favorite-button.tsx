import { Link, useLocation } from 'react-router-dom'
import { Heart } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useMyFavorites, useAddFavorite, useRemoveFavorite } from '@/lib/queries/customer-app'
import { cn } from '@/lib/cn'

interface FavoriteButtonProps {
  organizationId: string
  barberId?: string | null
  favoriteLabel?: string
  unfavoriteLabel?: string
  className?: string
}

/**
 * Heart toggle shown on marketplace cards and profile pages. Signed-out
 * visitors get a link to /login (with a redirect back here) rather
 * than a button that silently fails — favorites genuinely belong to an
 * account (spec: "Favorites must belong exclusively to their customer").
 * Reused across contexts with different i18n needs (translated marketplace
 * cards vs. the deliberately non-i18n /s/:slug/* profile pages — see
 * PROGRESS.md) via plain-English default labels, overridable by the caller.
 *
 * Sized 44x44 (h-11/w-11) rather than the denser h-9 used elsewhere: this is
 * an icon-only primary affordance on a mobile-first consumer surface, so it
 * needs a real touch target even though the glyph inside stays small.
 */
export function FavoriteButton({
  organizationId,
  barberId = null,
  favoriteLabel = 'Add to favorites',
  unfavoriteLabel = 'Remove from favorites',
  className,
}: FavoriteButtonProps) {
  const { user } = useAuth()
  const location = useLocation()
  const favoritesQuery = useMyFavorites(Boolean(user))
  const addFavorite = useAddFavorite()
  const removeFavorite = useRemoveFavorite()

  const existing = favoritesQuery.data?.find((f) => f.organizationId === organizationId && f.barberId === barberId)

  if (!user) {
    const redirectTarget = `${location.pathname}${location.search}`
    return (
      <Link
        to={`/login?redirect=${encodeURIComponent(redirectTarget)}`}
        aria-label={favoriteLabel}
        className={cn('inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-400 hover:bg-paper-100 hover:text-ink-600', className)}
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
      addFavorite.mutate({ userId: user!.id, organizationId, barberId })
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
        'inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-paper-100 disabled:opacity-50',
        existing ? 'text-danger-600' : 'text-ink-400 hover:text-ink-600',
        className,
      )}
    >
      <Heart className={cn('h-5 w-5', existing ? 'fill-current' : '')} aria-hidden="true" />
    </button>
  )
}
