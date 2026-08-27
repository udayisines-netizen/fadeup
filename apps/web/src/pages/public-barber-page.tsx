import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { usePublicOrganization } from '@/lib/queries/public-booking'
import { usePublicBarber, usePublicBarberServices } from '@/lib/queries/public-barber'
import { usePublicServiceState } from '@/lib/queries/service-mode'
import { FavoriteButton } from '@/components/customer/favorite-button'
import { ServiceModeCtas } from '@/components/booking/service-mode-ctas'
import { Container } from '@/components/ui/container'
import { Avatar } from '@/components/ui/avatar'
import { Button, buttonVariants } from '@/components/ui/button'
import { SectionHeader } from '@/components/ui/page-header'
import { ErrorState } from '@/components/ui/error-state'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageSpinner } from '@/components/ui/spinner'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useMoney, useDateTime } from '@/lib/intl/use-intl'

/**
 * `/s/:slug/barbers/:barberId` — a professional's shareable public profile.
 *
 * Real data only: name, title, bio and photo from `staff_profiles`, and the
 * services they actually perform. Never a fabricated specialties list, never
 * a review count, never a portfolio — `get_public_barber` and
 * `list_public_barber_services` return exactly these fields and nothing else
 * exists to draw from.
 *
 * A private, unbookable or unknown professional returns zero rows and is
 * indistinguishable from a wrong link. That is the same privacy posture as
 * the rest of the public surface and it is intentional: "this person exists
 * but is hidden" is itself a disclosure.
 *
 * "Book with <name>" deep-links `/s/:slug?barber=…&location=…`, which the
 * wizard uses to preselect and skip steps.
 */
export function PublicBarberPage() {
  const { t } = useTranslation('booking')
  const { slug, barberId } = useParams<{ slug: string; barberId: string }>()
  const organizationQuery = usePublicOrganization(slug)
  const barberQuery = usePublicBarber(slug, barberId)
  const servicesQuery = usePublicBarberServices(slug, barberId)

  useDocumentMeta({
    title: barberQuery.data
      ? organizationQuery.data
        ? t('professional.metaTitle', {
            professional: barberQuery.data.displayName,
            organization: organizationQuery.data.name,
          })
        : t('professional.metaTitleSolo', { professional: barberQuery.data.displayName })
      : t('professional.profileTitle'),
    description: barberQuery.data?.bio ?? t('professional.profileDescription'),
  })

  if (organizationQuery.isPending || barberQuery.isPending) {
    return <PageSpinner label={t('professional.loadingProfile')} />
  }

  const failed = organizationQuery.isError ? organizationQuery : barberQuery.isError ? barberQuery : null
  if (failed) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState
          title={t('professional.couldntLoadThisProfile')}
          description={failed.error?.message ?? ''}
          action={
            <Button variant="secondary" onClick={() => void failed.refetch()}>
              {t('common:action.tryAgain')}
            </Button>
          }
        />
      </Container>
    )
  }

  if (!organizationQuery.data || !barberQuery.data) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState
          title={t('professional.weCouldntFindThisProfile')}
          description={t('professional.thisLinkMayBeOut')}
          action={
            <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
              {t('professional.goToFadeup')}
            </Link>
          }
        />
      </Container>
    )
  }

  return (
    <BarberProfile organization={organizationQuery.data} barber={barberQuery.data} servicesQuery={servicesQuery} />
  )
}

function BarberProfile({
  organization,
  barber,
  servicesQuery,
}: {
  organization: { id: string; slug: string; name: string; currency: string }
  barber: {
    barberId: string
    displayName: string
    title: string | null
    bio: string | null
    avatarUrl: string | null
    locationId: string | null
  }
  servicesQuery: ReturnType<typeof usePublicBarberServices>
}) {
  const { t } = useTranslation('booking')
  const money = useMoney()
  const dateTime = useDateTime()

  const bookHref = `/s/${organization.slug}${
    barber.locationId ? `?barber=${barber.barberId}&location=${barber.locationId}` : `?barber=${barber.barberId}`
  }`

  // Server truth about what this professional is accepting. The slug is what
  // authorizes the read; the ids are re-validated against it, so a barber from
  // another shop simply returns nothing rather than an answer.
  const serviceStateQuery = usePublicServiceState(
    organization.slug,
    barber.locationId ?? undefined,
    barber.barberId,
  )

  /*
   * The FULL name in the CTA, not a first name.
   *
   * "Book with Karim" reads warmly in English and breaks everywhere else:
   * `displayName.split(' ')[0]` takes the family name first in Japanese and
   * Chinese, mangles a two-part Arabic given name, and addresses a Mr Belhadj
   * who has never met the customer by his first name in German. The whole
   * display name is the name the person chose to publish.
   */
  return (
    <Container size="md" className="flex flex-1 flex-col gap-8 py-6 sm:py-10">
      <section className="overflow-hidden rounded-2xl border border-border bg-paper-0">
        <div className="relative h-28 bg-gradient-to-br from-accent-100 via-paper-100 to-paper-200 sm:h-32">
          <span className="absolute end-3 top-3">
            <FavoriteButton
              organizationId={organization.id}
              barberId={barber.barberId}
              favoriteLabel={t('marketplace:card.addFavorite')}
              unfavoriteLabel={t('marketplace:card.removeFavorite')}
            />
          </span>
        </div>

        <div className="-mt-10 flex flex-col gap-4 px-5 pb-5 sm:px-6 sm:pb-6">
          <Avatar name={barber.displayName} src={barber.avatarUrl} size="xl" className="ring-4 ring-paper-0" />

          <div className="min-w-0">
            <h1 className="text-balance text-2xl font-semibold text-ink-950">{barber.displayName}</h1>
            {barber.title ? <p className="mt-0.5 text-sm font-medium text-accent-700">{barber.title}</p> : null}
            <Link
              to={`/s/${organization.slug}/profile`}
              className="mt-1 inline-block text-sm text-ink-500 underline-offset-2 hover:text-ink-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            >
              {t('professional.atOrganization', { organization: organization.name })}
            </Link>
            {barber.bio ? <p className="mt-3 text-pretty text-sm text-ink-700">{barber.bio}</p> : null}
          </div>

          {/* WHAT THIS PROFESSIONAL IS ACTUALLY ACCEPTING.
              Until this lot the page offered "Book with …" unconditionally, to
              everyone, always — which for a walk-in-only barber sent the
              customer into a wizard that had nothing to offer them, and for an
              unavailable one produced a booking the trigger now refuses.
              The Favorite control above is untouched: following a professional
              has nothing to do with whether they are taking bookings today. */}
          <ServiceModeCtas
            state={serviceStateQuery.data}
            isPending={serviceStateQuery.isPending}
            bookHref={bookHref}
            queueHref={`/s/${organization.slug}/walk-in`}
            bookLabel={t('professional.bookWith', { professional: barber.displayName })}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader title={t('common:entity.services')} />

        {servicesQuery.isPending ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : servicesQuery.isError ? (
          <ErrorState
            title={t('errors.services')}
            description={servicesQuery.error.message}
            action={
              <Button variant="secondary" onClick={() => void servicesQuery.refetch()}>
                {t('common:action.tryAgain')}
              </Button>
            }
          />
        ) : servicesQuery.data.length === 0 ? (
          <EmptyState title={t('professional.noServicesListedRightNow')} description={t('empty.servicesHint')} />
        ) : (
          <ul className="flex flex-col gap-2">
            {servicesQuery.data.map((service) => (
              // A row, not a link: booking always starts from the CTA above,
              // because the wizard needs a location before a service and
              // this list has no location to give it.
              <li
                key={service.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-border bg-paper-0 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-950">{service.name}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-500">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {dateTime.duration(service.durationMinutes)}
                  </p>
                </div>
                <span className="shrink-0 font-semibold text-ink-950">
                  {money(service.priceCents, organization.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Container>
  )
}
