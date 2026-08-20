import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Heart } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useMyFavorites, useRemoveFavorite, type MyFavorite } from '@/lib/queries/customer-app'
import { Avatar } from '@/components/ui/avatar'
import { PageHeader } from '@/components/ui/page-header'
import { Button, buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * `/app/customer/favorites` — saved shops and professionals, with the two
 * things a saved entry is for: look again, or book again.
 *
 * No Container of its own — the customer shell owns the page width, and a
 * second one here made this tab narrower than the others.
 */
export function CustomerFavoritesPage() {
  const { t } = useTranslation('customer-app')
  const { user } = useAuth()
  const favoritesQuery = useMyFavorites(Boolean(user))
  const removeFavorite = useRemoveFavorite()

  if (favoritesQuery.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    )
  }

  if (favoritesQuery.isError) {
    return (
      <ErrorState
        title={t('customer-app:favorites.couldntLoadYourFavorites')}
        description={favoritesQuery.error.message}
        action={
          <Button variant="secondary" onClick={() => void favoritesQuery.refetch()}>
            {t('common:action.tryAgain')}
          </Button>
        }
      />
    )
  }

  const favorites = favoritesQuery.data ?? []

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('favorites.title')} />

      {favorites.length === 0 ? (
        <EmptyState
          icon={Heart}
          title={t('favorites.emptyTitle')}
          description={t('favorites.emptyDescription')}
          action={
            <Link to="/search" className={buttonVariants({ size: 'sm' })}>
              {t('favorites.discoverCta')}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {favorites.map((favorite) => (
            <FavoriteCard key={favorite.favoriteId} favorite={favorite} onRemove={() => removeFavorite.mutate(favorite.favoriteId)} />
          ))}
        </div>
      )}
    </div>
  )
}

function FavoriteCard({ favorite, onRemove }: { favorite: MyFavorite; onRemove: () => void }) {
  const { t } = useTranslation('customer-app')
  const isBarber = favorite.barberId !== null
  const title = isBarber ? (favorite.barberDisplayName ?? favorite.organizationName) : favorite.organizationName
  const profileHref = isBarber ? `/s/${favorite.organizationSlug}/barbers/${favorite.barberId}` : `/s/${favorite.organizationSlug}/profile`
  const bookHref = isBarber ? `/s/${favorite.organizationSlug}?barber=${favorite.barberId}` : `/s/${favorite.organizationSlug}`

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-paper-0 p-4">
      <Avatar name={title} src={isBarber ? favorite.barberAvatarUrl : null} size="md" />

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink-950">{title}</p>
        {isBarber ? <p className="truncate text-sm text-ink-500">{favorite.organizationName}</p> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <Link to={profileHref} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            {t('favorites.viewProfile')}
          </Link>
          <Link to={bookHref} className={buttonVariants({ variant: 'primary', size: 'sm' })}>
            {t('favorites.book')}
          </Link>
        </div>
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label={t('favorites.remove')}
        className="shrink-0 rounded-full p-2 text-ink-400 hover:bg-paper-100 hover:text-danger-600"
      >
        <Heart className="h-5 w-5 fill-current" aria-hidden="true" />
      </button>
    </div>
  )
}
