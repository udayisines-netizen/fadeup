import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { usePublicOrganization } from '@/lib/queries/public-booking'
import {
  usePublicBarber,
  usePublicBarberServices,
  usePublicProfessionalIdentity,
} from '@/lib/queries/public-barber'
import { usePublicServiceState } from '@/lib/queries/service-mode'
import { FollowButton } from '@/components/customer/follow-button'
import { ServiceModeCtas } from '@/components/booking/service-mode-ctas'
import { ProfileHeader } from '@/components/profile/profile-header'
import { StickyBookBar } from '@/components/profile/sticky-book-bar'
import { Container } from '@/components/ui/container'
import { Button, buttonVariants } from '@/components/ui/button'
import { SectionHeader } from '@/components/ui/page-header'
import { ErrorState } from '@/components/ui/error-state'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageSpinner } from '@/components/ui/spinner'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useTrackView } from '@/lib/analytics'
import { useMoney, useDateTime } from '@/lib/intl/use-intl'

/**
 * `/s/:slug/barbers/:barberId` — a professional's shareable public profile.
 *
 * ============================================================================
 * SOCIAL FIRST, AND STILL CONVERTS
 * ============================================================================
 *
 * §13 puts the hierarchy in this order: identity, social credibility, Follow,
 * Book, social proof, availability, then content. Before R5 this page was
 * conversion-first — a header, a Book button, a price list — which is a
 * perfectly good booking page and is not a profile. The change is that the
 * first viewport now answers "who is this, and do other people go to them?"
 * before it answers "how much".
 *
 * Book still wins, because §13 also says it must. It appears twice: once in
 * the header beside Follow, and again in a bar that sticks to the bottom of
 * the page once the header has scrolled away. Follow takes the neutral
 * `social` treatment precisely so it cannot out-shout Book on the one screen
 * where that trade matters.
 *
 * ============================================================================
 * WHAT IS STILL DELIBERATELY ABSENT
 * ============================================================================
 *
 * No portfolio, no "Work" tab, no reviews, no specialties. There is no photo
 * table for a professional, no reviews table anywhere, and the only services
 * shown are the ones `list_public_barber_services` says they actually perform.
 * §14 asks for tabs like Work and Reviews "following existing localization
 * conventions" — the convention that matters more is that a tab must contain
 * something, and an empty Reviews tab on every profile in the product would
 * advertise a feature FadeUp does not have.
 *
 * The follower count IS real: `get_public_professional` computes it from the
 * canonical follow edges. It is shown only when the identity is claimed and
 * only when it is greater than zero — a "0 followers" line on a new
 * professional is a discouraging number that tells a customer nothing.
 *
 * A private, unbookable or unknown professional returns zero rows and is
 * indistinguishable from a wrong link. That is the same privacy posture as the
 * rest of the public surface and it is intentional: "this person exists but is
 * hidden" is itself a disclosure.
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

  /**
   * The professional identity is deliberately NOT resolved here.
   *
   * This page has a barber_id — an operational placement — and
   * `get_public_barber` does not return the durable professional_id for
   * analytics' benefit. Rather than widen a closed contract, the event carries
   * the placement and the SERVER derives the professional from it. That keeps
   * the derivation in the one place that can be trusted with it, and means a
   * future page that only knows a barber still attributes correctly.
   */
  useTrackView(
    'public_profile_viewed',
    {
      properties: { profile_type: 'professional' },
      context: {
        organizationId: organizationQuery.data?.id,
        barberId: barberId ?? null,
      },
    },
    Boolean(organizationQuery.data?.id && barberQuery.data),
  )

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
    professionalId: string | null
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

  // Only asked when there is a claimed identity to ask about. `professionalId`
  // is null for an unclaimed placement, and that null is exactly the signal
  // §16 asks for: no verified badge, no follower count, no Follow control.
  const identityQuery = usePublicProfessionalIdentity(barber.professionalId)
  const identity = identityQuery.data

  /*
   * The FULL name in the CTA, not a first name.
   *
   * "Book with Karim" reads warmly in English and breaks everywhere else:
   * `displayName.split(' ')[0]` takes the family name first in Japanese and
   * Chinese, mangles a two-part Arabic given name, and addresses a Mr Belhadj
   * who has never met the customer by his first name in German. The whole
   * display name is the name the person chose to publish.
   */
  const bookLabel = t('professional.bookWith', { professional: barber.displayName })

  return (
    <Container size="md" className="flex flex-1 flex-col gap-8 py-6 sm:py-10">
      <ProfileHeader
        variant="person"
        name={barber.displayName}
        avatarUrl={barber.avatarUrl}
        verified={barber.professionalId !== null}
        headline={barber.title ?? identity?.headline}
        subtitle={
          <Link
            to={`/s/${organization.slug}/profile`}
            className="underline-offset-2 hover:text-ink-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            {t('professional.atOrganization', { organization: organization.name })}
          </Link>
        }
        stats={
          // Zero is never shown. A new professional's profile should not open
          // with a number that reads as a verdict.
          identity && identity.followerCount > 0
            ? [
                {
                  key: 'followers',
                  value: String(identity.followerCount),
                  label: t('professional.followers', { count: identity.followerCount }),
                },
              ]
            : undefined
        }
        actions={
          /*
            FOLLOW ONLY — Book is NOT here, and that is deliberate.

            The obvious composition puts a Book link beside Follow. It would be
            wrong for the same reason Service Mode existed: an unconditional
            Book offers a reservation to a walk-in-only barber and sends the
            customer into a wizard that has nothing for them. Book is rendered
            immediately below by `ServiceModeCtas`, which asks the server what
            this professional is actually accepting — so the reading order is
            still identity, credibility, Follow, Book, exactly as §13 sets out,
            without the page ever promising something the shop has not offered.
          */
          barber.professionalId ? <FollowButton professionalId={barber.professionalId} /> : null
        }
        meta={
          // WHAT THIS PROFESSIONAL IS ACTUALLY ACCEPTING. Until Service Mode
          // this page offered "Book with …" unconditionally, to everyone,
          // always — which for a walk-in-only barber sent the customer into a
          // wizard that had nothing to offer them. Follow above is
          // independent: following someone has nothing to do with whether they
          // are taking bookings today (§25).
          <ServiceModeCtas
            state={serviceStateQuery.data}
            isPending={serviceStateQuery.isPending}
            bookHref={bookHref}
            queueHref={`/s/${organization.slug}/walk-in`}
            bookLabel={bookLabel}
          />
        }
      />

      {barber.bio ? (
        <section className="flex flex-col gap-3">
          <SectionHeader title={t('professional.about')} />
          <p className="text-pretty text-sm leading-relaxed text-ink-700">{barber.bio}</p>
        </section>
      ) : null}

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
              // because the wizard needs a location before a service and this
              // list has no location to give it.
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

      {/*
        The second Book. Sticky rather than fixed, so it arrives as the header's
        own Book leaves rather than covering the page from first paint — and
        only when the professional is actually accepting bookings, because a
        persistent CTA for something unavailable is worse than no CTA.
      */}
      {serviceStateQuery.data?.bookingAcceptingNewEntries ? (
        <StickyBookBar>
          {/*
            The SHORT label, not "Book with <name>". Whose profile this is has
            been established by everything above it, a persistent bar should
            not restate it, and a distinct accessible name means the two Book
            controls on this page are separately addressable rather than two
            identically-named links.
          */}
          <Link to={bookHref} className={buttonVariants({ variant: 'book', size: 'lg' }, 'w-full')}>
            {t('serviceMode.book')}
          </Link>
        </StickyBookBar>
      ) : null}
    </Container>
  )
}
