import { Link, useParams } from 'react-router-dom'
import { MapPin, Users } from 'lucide-react'
import { usePublicOrganization, usePublicLocations, type PublicLocation } from '@/lib/queries/public-booking'
import { usePublicOrganizationBarbers } from '@/lib/queries/public-barber'
import { FavoriteButton } from '@/components/customer/favorite-button'
import { Container } from '@/components/ui/container'
import { Card } from '@/components/ui/card'
import { Button, buttonVariants } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageSpinner } from '@/components/ui/spinner'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useTranslation } from 'react-i18next'

function formatAddress(location: PublicLocation): string | null {
  const parts = [location.addressLine1, location.city, location.region].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(', ') : null
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}

/**
 * "/s/:slug/profile" — the Shop Profile: identity, real locations/addresses,
 * and the full public team roster, so a customer can go
 * open shop -> browse team -> open a barber -> book, per Wave 1 spec. This
 * is the missing "browse" layer in front of the existing booking wizard
 * (`/s/:slug`, unchanged) — it does not duplicate any booking logic, it
 * only links into it. No hours/rating shown: no per-location open-now RPC
 * or reviews table is wired into this page (see
 * db/migrations/20260813110000_public_shop_profile.sql) — real data only,
 * nothing fabricated to fill the space.
 */
export function ShopProfilePage() {
  const { t } = useTranslation()
  const { slug } = useParams<{ slug: string }>()
  const organizationQuery = usePublicOrganization(slug)
  const locationsQuery = usePublicLocations(slug)
  const barbersQuery = usePublicOrganizationBarbers(slug)

  useDocumentMeta({
    title: organizationQuery.data ? `${organizationQuery.data.name} — FadeUp` : 'Shop profile — FadeUp',
    description: organizationQuery.data ? `Meet the team and book with ${organizationQuery.data.name} on FadeUp.` : 'A barbershop profile on FadeUp.',
  })

  if (organizationQuery.isPending) {
    return <PageSpinner label={t('booking:shop.loadingProfile')} />
  }

  if (organizationQuery.isError) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState
          title={t('booking:shop.couldntLoadThisProfile')}
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
          title={t('booking:shop.weCouldntFindThisShop')}
          description={t('booking:shop.thisLinkMayBeOut')}
          action={
            <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
              {t('booking:shop.goToFadeup')}
            </Link>
          }
        />
      </Container>
    )
  }

  const organization = organizationQuery.data

  return (
    <Container size="sm" className="flex flex-1 flex-col py-6 sm:py-10">
      <Card elevated className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-accent-100 text-lg font-semibold text-accent-800">
            {organization.name.charAt(0).toUpperCase()}
          </div>
          <FavoriteButton organizationId={organization.id} />
        </div>
        <h1 className="mt-4 text-2xl font-semibold text-balance text-ink-950">{organization.name}</h1>

        {locationsQuery.isPending ? (
          <Skeleton className="mt-2 h-4 w-2/3" />
        ) : locationsQuery.data && locationsQuery.data.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1">
            {locationsQuery.data.map((location) => (
              <li key={location.id} className="flex items-start gap-1.5 text-sm text-ink-500">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {location.name}
                  {formatAddress(location) ? ` — ${formatAddress(location)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <Link to={`/s/${organization.slug}`} className={buttonVariants({ size: 'lg' }, 'mt-6 w-full')}>
          {t('booking:shop.bookNow')}
        </Link>
      </Card>

      <div className="mt-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
          <Users className="h-4 w-4" aria-hidden="true" />
          {t('common:entity.team')}
        </h2>
        {barbersQuery.isPending ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-hidden="true">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : barbersQuery.isError ? (
          <p className="text-sm text-danger-700">{barbersQuery.error.message}</p>
        ) : barbersQuery.data.length === 0 ? (
          <EmptyState title={t('booking:shop.noPublicTeamMembersYet')} description={t('booking:shop.thisShopHasntPublishedAny')} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {barbersQuery.data.map((barber) => (
              <Link
                key={barber.barberId}
                to={`/s/${organization.slug}/barbers/${barber.barberId}`}
                className="flex flex-col items-center gap-2 rounded-lg border border-border bg-paper-0 p-4 text-center transition-colors hover:border-accent-600 hover:bg-accent-100/30 focus-visible:outline-2 focus-visible:outline-accent-600"
              >
                {barber.avatarUrl ? (
                  <img src={barber.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-100 text-base font-semibold text-accent-800">
                    {initialsOf(barber.displayName)}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-950">{barber.displayName}</p>
                  {barber.title ? <p className="truncate text-xs text-ink-500">{barber.title}</p> : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Container>
  )
}
