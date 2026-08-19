import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Heart } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useMyFavorites, useRemoveFavorite, type MyFavorite } from '@/lib/queries/customer-app'
import { Container } from '@/components/ui/container'
import { Card } from '@/components/ui/card'
import { Button, buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}

/** /app/customer/favorites — saved shops/barbers, quick links to profile/booking, and remove. */
export function CustomerFavoritesPage() {
  const { t } = useTranslation('customer-app')
  const { user } = useAuth()
  const favoritesQuery = useMyFavorites(Boolean(user))
  const removeFavorite = useRemoveFavorite()

  if (favoritesQuery.isPending) {
    return (
      <Container size="sm" className="flex flex-col gap-3 py-6" aria-hidden="true">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </Container>
    )
  }

  if (favoritesQuery.isError) {
    return (
      <Container size="sm" className="py-10">
        <ErrorState
          title={t('customer-app:favorites.couldntLoadYourFavorites')}
          description={favoritesQuery.error.message}
          action={
            <Button variant="secondary" onClick={() => void favoritesQuery.refetch()}>
              {t('common:action.tryAgain')}
            </Button>
          }
        />
      </Container>
    )
  }

  const favorites = favoritesQuery.data ?? []

  return (
    <Container size="sm" className="flex flex-col gap-4 py-6">
      <h1 className="text-2xl font-semibold text-ink-950">{t('favorites.title')}</h1>

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
    </Container>
  )
}

function FavoriteCard({ favorite, onRemove }: { favorite: MyFavorite; onRemove: () => void }) {
  const { t } = useTranslation('customer-app')
  const isBarber = favorite.barberId !== null
  const title = isBarber ? (favorite.barberDisplayName ?? favorite.organizationName) : favorite.organizationName
  const profileHref = isBarber ? `/s/${favorite.organizationSlug}/barbers/${favorite.barberId}` : `/s/${favorite.organizationSlug}/profile`
  const bookHref = isBarber ? `/s/${favorite.organizationSlug}?barber=${favorite.barberId}` : `/s/${favorite.organizationSlug}`

  return (
    <Card className="flex items-center gap-3 p-4">
      {isBarber && favorite.barberAvatarUrl ? (
        <img src={favorite.barberAvatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-100 text-sm font-semibold text-accent-800">
          {initialsOf(title)}
        </div>
      )}

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
    </Card>
  )
}
