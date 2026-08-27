import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MapPin, Navigation } from 'lucide-react'
import { usePublicOrganization, usePublicLocations, type PublicLocation } from '@/lib/queries/public-booking'
import { usePublicOrganizationBarbers } from '@/lib/queries/public-barber'
import { FavoriteButton } from '@/components/customer/favorite-button'
import { OrganizationFollowButton } from '@/components/customer/organization-follow-button'
import { Container } from '@/components/ui/container'
import { Avatar } from '@/components/ui/avatar'
import { Button, buttonVariants } from '@/components/ui/button'
import { SectionHeader } from '@/components/ui/page-header'
import { ErrorState } from '@/components/ui/error-state'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageSpinner } from '@/components/ui/spinner'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useTrackView } from '@/lib/analytics'
import { directionsUrl, formatFullAddress } from '@/lib/geo/address'

/**
 * `/s/:slug/profile` — the shop, before you commit to booking with it.
 *
 * This is the "browse" layer in front of the booking wizard: identity, real
 * addresses, and the public team, so a customer can go shop → professional →
 * book. It contains no booking logic of its own; it only links into it.
 *
 * WHAT IS DELIBERATELY ABSENT: opening hours, ratings, photos, "since 2014".
 * There is no reviews table, no per-location open-now read on this page and
 * no image column, and a profile is exactly the screen where inventing any of
 * that would change someone's decision. The hero is a branded panel carrying
 * the shop's initial, tinted from its name — the same treatment as the
 * marketplace card, so the shop a customer tapped still looks like the shop
 * they landed on.
 */
export function ShopProfilePage() {
  const { t } = useTranslation('booking')
  const { slug } = useParams<{ slug: string }>()
  const organizationQuery = usePublicOrganization(slug)
  const locationsQuery = usePublicLocations(slug)
  const barbersQuery = usePublicOrganizationBarbers(slug)

  useDocumentMeta({
    title: organizationQuery.data
      ? t('shop.metaTitle', { organization: organizationQuery.data.name })
      : t('shop.profileTitle'),
    description: organizationQuery.data
      ? t('shop.metaDescription', { organization: organizationQuery.data.name })
      : t('shop.profileDescription'),
  })

  /**
   * A profile view is reported once the shop has actually RESOLVED, not once
   * the route matched. A view attributed to no organization is not a view of
   * anything, and firing on mount would count every mistyped slug and every
   * failed request as profile traffic.
   *
   * The viewer is never sent: the server derives the actor from auth.uid() and
   * no read contract projects it, so a shop learns how many people looked and
   * never who (§12).
   */
  useTrackView(
    'public_profile_viewed',
    {
      properties: { profile_type: 'organization' },
      context: { organizationId: organizationQuery.data?.id },
    },
    Boolean(organizationQuery.data?.id),
  )

  if (organizationQuery.isPending) {
    return <PageSpinner label={t('shop.loadingProfile')} />
  }

  if (organizationQuery.isError) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState
          title={t('shop.couldntLoadThisProfile')}
          description={organizationQuery.error.message}
          action={
            <Button variant="secondary" onClick={() => void organizationQuery.refetch()}>
              {t('common:action.tryAgain')}
            </Button>
          }
        />
      </Container>
    )
  }

  if (!organizationQuery.data) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState
          title={t('shop.weCouldntFindThisShop')}
          description={t('shop.thisLinkMayBeOut')}
          action={
            <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
              {t('shop.goToFadeup')}
            </Link>
          }
        />
      </Container>
    )
  }

  const organization = organizationQuery.data
  const locations = locationsQuery.data ?? []

  return (
    <Container size="md" className="flex flex-1 flex-col gap-8 py-6 sm:py-10">
      <section className="overflow-hidden rounded-2xl border border-border bg-paper-0">
        <div className="relative h-32 bg-gradient-to-br from-accent-100 via-paper-100 to-paper-200 sm:h-40">
          <div className="absolute end-3 top-3 flex items-center gap-2">
            <OrganizationFollowButton
              organizationId={organization.id}
            />
            <FavoriteButton
              organizationId={organization.id}
              favoriteLabel={t('marketplace:card.addFavorite')}
              unfavoriteLabel={t('marketplace:card.removeFavorite')}
            />
          </div>
        </div>

        {/* The avatar straddles the panel edge — the one place on the public
            surface that gets this treatment, because it is the shop's
            identity and everything below it is detail. */}
        <div className="-mt-10 flex flex-col gap-4 px-5 pb-5 sm:px-6 sm:pb-6">
          <Avatar name={organization.name} size="xl" className="ring-4 ring-paper-0" />

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-balance text-2xl font-semibold text-ink-950">{organization.name}</h1>
              {locationsQuery.isPending ? (
                <Skeleton className="mt-1.5 h-4 w-40" />
              ) : locations.length > 0 ? (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-500">
                  <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    {locations.length === 1
                      ? (locations[0]!.city ?? locations[0]!.name)
                      : t('shop.locationCount', { count: locations.length })}
                  </span>
                </p>
              ) : null}
            </div>

            <Link to={`/s/${organization.slug}`} className={buttonVariants({ size: 'lg' }, 'w-full sm:w-auto')}>
              {t('shop.bookNow')}
            </Link>
          </div>
        </div>
      </section>

      {locations.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionHeader title={t('common:entity.locations')} />
          <ul className="grid gap-3 sm:grid-cols-2">
            {locations.map((location) => (
              <LocationCard key={location.id} location={location} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <SectionHeader
          title={t('common:entity.team')}
          meta={barbersQuery.data && barbersQuery.data.length > 0 ? String(barbersQuery.data.length) : undefined}
        />

        {barbersQuery.isPending ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-hidden="true">
            <Skeleton className="h-36 w-full rounded-xl" />
            <Skeleton className="h-36 w-full rounded-xl" />
            <Skeleton className="h-36 w-full rounded-xl" />
          </div>
        ) : barbersQuery.isError ? (
          <ErrorState
            title={t('errors.barbers')}
            description={barbersQuery.error.message}
            action={
              <Button variant="secondary" onClick={() => void barbersQuery.refetch()}>
                {t('common:action.tryAgain')}
              </Button>
            }
          />
        ) : barbersQuery.data.length === 0 ? (
          <EmptyState title={t('shop.noPublicTeamMembersYet')} description={t('shop.thisShopHasntPublishedAny')} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {barbersQuery.data.map((barber) => (
              <Link
                key={barber.barberId}
                to={`/s/${organization.slug}/barbers/${barber.barberId}`}
                className="flex flex-col items-center gap-2 rounded-xl border border-border bg-paper-0 p-4 text-center transition-colors duration-[--fu-duration-quick] hover:border-accent-300 hover:bg-accent-100/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 motion-reduce:transition-none"
              >
                <Avatar name={barber.displayName} src={barber.avatarUrl} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-950">{barber.displayName}</p>
                  {barber.title ? <p className="truncate text-xs text-ink-500">{barber.title}</p> : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </Container>
  )
}

function LocationCard({ location }: { location: PublicLocation }) {
  const { t } = useTranslation('booking')
  const address = formatFullAddress(location)
  const directions = directionsUrl(location)

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-paper-0 p-4">
      <p className="font-medium text-ink-950">{location.name}</p>
      {address ? <p className="text-sm text-pretty text-ink-500">{address}</p> : null}
      {directions ? (
        // A plain link built from the address the shop published. Nothing is
        // embedded and nothing is tracked — FadeUp has no maps integration,
        // and pretending otherwise would mean shipping a map that cannot
        // show anything.
        <a
          href={directions}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto inline-flex w-fit min-h-9 items-center gap-1.5 text-sm font-medium text-accent-700 hover:text-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
        >
          <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
          {t('shop.directions')}
        </a>
      ) : null}
    </li>
  )
}
