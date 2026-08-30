import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BadgeCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useMoney } from '@/lib/intl/use-intl'
import { usePublicOrganization } from '@/lib/queries/public-booking'
import {
  usePublicBarber,
  usePublicBarberServices,
  usePublicProfessionalIdentity,
} from '@/lib/queries/public-barber'
import { usePublicQueueStatus } from '@/lib/queries/public-queue'
import {
  useFollowProfessional,
  useMyFollowedProfessionals,
  useUnfollowProfessional,
} from '@/lib/queries/follows'
import { useDelayedFlag } from '@/customer-v2/hooks/use-delayed'
import { IdentityTile } from '@/customer-v2/home/identity-tile'
import { Notice } from '@/customer-v2/ui/notice'
import { v2BookingPath, v2ShopProfilePath } from '@/customer-v2/routes'

/**
 * A barber's profile — a PERSON with a social identity, not a marketplace
 * listing.
 *
 * ============================================================================
 * WHERE THIS SITS IN THE SUPPLY MODEL
 * ============================================================================
 *
 * R5R.1A-R2 removed staff barbers from marketplace supply: a person who works
 * at a shop is not a business a customer books independently of that shop.
 * This page is where those people LIVE instead. It is reached through the
 * shop's team, through follows, and through direct links — never as a
 * marketplace row — and its job is identity: who this is, where they work,
 * who follows them, what they charge, and one dominant way to book them.
 *
 * ============================================================================
 * TWO CONTRACTS, TWO KINDS OF FACT
 * ============================================================================
 *
 * `get_public_barber` describes a PLACEMENT — a chair at a shop: display name,
 * title, bio, location. `get_public_professional` describes a durable PERSON —
 * handle, headline, follower count — and exists only once the identity is
 * CLAIMED. The page renders placement facts always and person facts only when
 * the claimed identity resolves, which is why an unclaimed barber shows no
 * follower count and no Follow control: there is no durable identity to
 * follow, and inventing one is exactly what the no-fabrication rule forbids.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY ABSENT
 * ============================================================================
 *
 * PORTFOLIO — the schema has no work/media table (verified in R5R.1A-R1: the
 * only image columns in the public schema are three `avatar_url`s). The Work
 * section renders an honest empty state rather than a grid of placeholder
 * frames, and gains real content the day a portfolio contract exists.
 *
 * NEXT AVAILABILITY — availability is a function of service, professional,
 * location and date. With no service chosen there is no "next slot" to print;
 * the services below each carry Book, which is where the real slots are.
 *
 * REVIEWS — no reviews table exists.
 *
 * MESSAGING — excluded by product decision, not by gap.
 *
 * ============================================================================
 * BOOK LEAVES THE PREVIEW, FOR NOW
 * ============================================================================
 *
 * Book targets `/s/{slug}?barber=…&location=…`, the real anonymous booking
 * entry with the professional preselected — the flow never asks for the barber
 * again. R5R.1E replaces the destination with the greenfield booking
 * experience; the parameters are already its contract.
 */
export function CustomerV2BarberProfilePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { slug, barberId } = useParams<{ slug: string; barberId: string }>()
  const { user } = useAuth()

  const organization = usePublicOrganization(slug)
  const barber = usePublicBarber(slug, barberId)
  const services = usePublicBarberServices(slug, barberId)
  const identity = usePublicProfessionalIdentity(barber.data?.professionalId)
  const queue = usePublicQueueStatus(slug, barber.data?.locationId ?? undefined)

  const followed = useMyFollowedProfessionals(Boolean(user))
  const follow = useFollowProfessional()
  const unfollow = useUnfollowProfessional()

  const money = useMoney()
  const showSkeletons = useDelayedFlag(barber.isPending)

  const professionalId = barber.data?.professionalId ?? null
  const isFollowing = useMemo(
    () => Boolean(professionalId && followed.data?.some((f) => f.id === professionalId)),
    [followed.data, professionalId],
  )

  useDocumentMeta({
    title: barber.data
      ? t('customer-app:v2.barberProfile.documentTitle', { name: barber.data.displayName })
      : t('customer-app:v2.barberProfile.documentTitleFallback'),
    description: t('customer-app:v2.barberProfile.documentDescription'),
    noIndex: true,
  })

  if (barber.isError) {
    return (
      <Notice
        tone="failure"
        title={t('customer-app:v2.discovery.errorTitle')}
        body={t('customer-app:v2.discovery.errorBody')}
        actionLabel={t('customer-app:v2.discovery.retry')}
        onAction={() => void barber.refetch()}
      />
    )
  }

  if (barber.isPending) {
    return showSkeletons ? (
      <div className="v2-plate mx-auto max-w-[40rem] p-5">
        <div className="flex items-center gap-4">
          <div className="v2-skeleton h-20 w-20 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="v2-skeleton h-5 w-2/5 rounded-v2-1" />
            <div className="v2-skeleton mt-2 h-4 w-3/5 rounded-v2-1" />
          </div>
        </div>
      </div>
    ) : (
      <div className="min-h-64" />
    )
  }

  if (!barber.data) {
    /*
      A private, unbookable or unknown barber returns zero rows — deliberately
      indistinguishable, because "someone exists here but is hidden" is itself
      a disclosure. The page says only that there is nothing at this address.
    */
    return (
      <Notice
        tone="empty"
        title={t('customer-app:v2.barberProfile.notFoundTitle')}
        body={t('customer-app:v2.barberProfile.notFoundBody')}
        actionLabel={null}
        onAction={null}
      />
    )
  }

  const profile = barber.data
  const person = identity.data ?? null
  const currency = organization.data?.currency

  const bookPath = v2BookingPath(slug ?? '', {
    locationId: profile.locationId,
    barberId: profile.barberId,
  })

  const waitingCount = (queue.data ?? []).filter((entry) => entry.status === 'waiting').length

  const toggleFollow = () => {
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(window.location.pathname)}`)
      return
    }
    if (!professionalId) return
    if (isFollowing) unfollow.mutate(professionalId)
    else follow.mutate(professionalId)
  }

  return (
    <div className="mx-auto flex max-w-[40rem] flex-col gap-4">
      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <section className="v2-plate p-5 md:p-6">
        <div className="flex items-start gap-4 md:gap-5">
          <IdentityTile
            src={person?.avatarUrl ?? profile.avatarUrl}
            alt=""
            kind="barber"
            className="h-20 w-20 shrink-0 md:h-24 md:w-24"
          />

          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-1.5 text-v2-lead font-semibold text-v2-ink">
              <bdi className="truncate">{profile.displayName}</bdi>
              {professionalId ? (
                <BadgeCheck
                  className="h-5 w-5 shrink-0 text-v2-green"
                  strokeWidth={2}
                  aria-label={t('customer-app:v2.result.claimedIdentity')}
                />
              ) : null}
            </h1>

            {person?.handle ? (
              <p className="truncate text-v2-meta text-v2-ink-soft">@{person.handle}</p>
            ) : null}

            {profile.title ? (
              <p className="mt-0.5 truncate text-v2-meta text-v2-ink-soft">{profile.title}</p>
            ) : null}

            {organization.data ? (
              <p className="mt-1.5 text-v2-meta text-v2-ink-soft">
                {t('customer-app:v2.barberProfile.workingAt')}{' '}
                <Link
                  to={v2ShopProfilePath(slug ?? '', profile.locationId)}
                  className="font-semibold text-v2-green hover:underline"
                >
                  <bdi>{organization.data.name}</bdi>
                </Link>
              </p>
            ) : null}

            {person ? (
              <p className="mt-1.5 text-v2-meta tabular-nums text-v2-ink-soft">
                {t('customer-app:v2.barberProfile.followers', { count: person.followerCount })}
              </p>
            ) : null}
          </div>
        </div>

        {(person?.headline ?? profile.bio) ? (
          <p className="mt-4 text-v2-body text-v2-ink">{person?.headline ?? profile.bio}</p>
        ) : null}

        {/* Book dominates; Follow is secondary and exists only for a claimed identity. */}
        <div className="mt-4 flex items-center gap-2.5">
          <Link
            to={bookPath}
            className="v2-press inline-flex h-11 flex-1 items-center justify-center rounded-v2-2 bg-v2-green px-5 text-v2-body font-semibold text-v2-paper hover:bg-v2-green-deep"
          >
            {t('customer-app:v2.result.book')}
          </Link>

          {professionalId ? (
            <button
              type="button"
              onClick={toggleFollow}
              disabled={follow.isPending || unfollow.isPending}
              aria-pressed={isFollowing}
              className={
                isFollowing
                  ? 'v2-press inline-flex h-11 items-center justify-center rounded-v2-2 bg-v2-green-tint px-5 text-v2-body font-semibold text-v2-green-ink'
                  : 'v2-press inline-flex h-11 items-center justify-center rounded-v2-2 border border-v2-edge bg-v2-paper px-5 text-v2-body font-semibold text-v2-ink hover:bg-v2-fill'
              }
            >
              {isFollowing
                ? t('customer-app:v2.barberProfile.following')
                : t('customer-app:v2.barberProfile.follow')}
            </button>
          ) : null}
        </div>

        {waitingCount > 0 ? (
          <p className="mt-3 text-v2-meta text-v2-ink-soft">
            {t('customer-app:v2.result.waiting', { count: waitingCount })}
          </p>
        ) : null}
      </section>

      {/* ── Services ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="v2-barber-services" className="v2-plate overflow-hidden">
        <div className="px-4 py-3 md:px-5">
          <h2 id="v2-barber-services" className="text-v2-title font-semibold text-v2-ink">
            {t('customer-app:v2.barberProfile.services')}
          </h2>
        </div>

        {services.data && services.data.length > 0 ? (
          <ul>
            {services.data.map((service) => (
              <li
                key={service.id}
                className="flex items-center gap-3 border-t border-v2-hairline px-4 py-3 md:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-v2-body font-medium text-v2-ink">{service.name}</p>
                  <p className="mt-0.5 text-v2-meta text-v2-ink-soft">
                    {t('customer-app:v2.barberProfile.minutes', { count: service.durationMinutes })}
                  </p>
                </div>
                {currency ? (
                  <p className="shrink-0 text-v2-body font-semibold tabular-nums text-v2-ink">
                    {money(service.priceCents, currency)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : services.isPending ? (
          <div className="border-t border-v2-hairline px-4 py-4 md:px-5">
            <div className="v2-skeleton h-5 w-1/2 rounded-v2-1" />
          </div>
        ) : (
          <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft md:px-5">
            {t('customer-app:v2.barberProfile.noServices')}
          </p>
        )}
      </section>

      {/* ── Work ─────────────────────────────────────────────────────────── */}
      <section aria-labelledby="v2-barber-work" className="v2-plate overflow-hidden">
        <div className="px-4 py-3 md:px-5">
          <h2 id="v2-barber-work" className="text-v2-title font-semibold text-v2-ink">
            {t('customer-app:v2.barberProfile.work')}
          </h2>
        </div>
        {/*
          The honest state of a product with no portfolio table. Not a grid of
          empty frames: an empty frame promises content that cannot arrive.
        */}
        <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft md:px-5">
          {t('customer-app:v2.barberProfile.noWork')}
        </p>
      </section>
    </div>
  )
}
