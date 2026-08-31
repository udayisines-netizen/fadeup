import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BadgeCheck, ChevronLeft } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useTrackView } from '@/lib/analytics'
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

  /* Same R3 event the legacy profile records — the funnel the pro analytics
     page reads must not go dark when v2 replaces that surface. */
  useTrackView(
    'public_profile_viewed',
    {
      properties: { profile_type: 'professional' },
      context: { organizationId: organization.data?.id, barberId: barber.data?.barberId },
    },
    Boolean(organization.data?.id && barber.data),
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
      <div className="mx-auto max-w-[40rem] pt-11">
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
    <div className="mx-auto flex max-w-[40rem] flex-col">
      {/* ── Back (Design Pass A §5) ──────────────────────────────────────── */}
      <div className="-ms-2">
        <button
          type="button"
          onClick={() =>
            window.history.length > 1
              ? navigate(-1)
              : navigate(v2ShopProfilePath(slug ?? '', profile.locationId))
          }
          className="v2-press inline-flex h-11 items-center gap-1 rounded-v2-2 px-2 text-v2-meta font-medium text-v2-ink-soft hover:text-v2-ink"
        >
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={2} aria-hidden="true" />
          {t('customer-app:v2.shopProfile.back')}
        </button>
      </div>

      {/*
        ── Identity — Instagram grammar, deliberately NOT the venue page ────
        Circular avatar, name + claim state, @handle, headline, real follower
        count, "Working at" — then Book dominant with Follow beside it. On the
        canvas, no plate: this is a person's page, not a card about one.
      */}
      <section className="border-b border-v2-hairline pb-4 pt-1">
        <div className="flex items-start gap-4 md:gap-5">
          <IdentityTile
            src={person?.avatarUrl ?? profile.avatarUrl}
            alt=""
            kind="barber"
            name={profile.displayName}
            className="h-[4.5rem] w-[4.5rem] shrink-0 text-[1.2rem] md:h-24 md:w-24 md:text-[1.4rem]"
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
                {/* Inline link with a 44px tap box: padding grows the target,
                    the negative margin keeps the text sitting in its line. */}
                <Link
                  to={v2ShopProfilePath(slug ?? '', profile.locationId)}
                  className="-mx-3 -my-3.5 inline-block px-3 py-3.5 font-semibold text-v2-green hover:underline"
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

        {follow.isError || unfollow.isError ? (
          <p role="alert" className="mt-2 text-v2-meta font-medium text-v2-alert">
            {t('customer-app:v2.errors.actionFailed')}
          </p>
        ) : null}

        {waitingCount > 0 ? (
          <p className="mt-3 text-v2-meta text-v2-ink-soft">
            {t('customer-app:v2.result.waiting', { count: waitingCount })}
          </p>
        ) : null}
      </section>

      {/* ── Services ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="v2-barber-services" className="pb-1 pt-4">
        <div className="pb-1.5">
          <h2 id="v2-barber-services" className="text-v2-title font-semibold text-v2-ink">
            {t('customer-app:v2.barberProfile.services')}
          </h2>
        </div>

        {services.data && services.data.length > 0 ? (
          <ul>
            {/* Each row IS the booking entry for that service — reading the
                price and then re-choosing the same service in the flow was a
                whole decision asked twice. */}
            {services.data.map((service) => (
              <li key={service.id} className="border-t border-v2-hairline">
                <Link
                  to={v2BookingPath(slug ?? '', {
                    locationId: profile.locationId,
                    barberId: profile.barberId,
                    serviceId: service.id,
                  })}
                  className="v2-press flex items-center gap-3 py-3 hover:bg-v2-ground"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-v2-body font-medium text-v2-ink">{service.name}</p>
                    <p className="mt-0.5 text-v2-meta text-v2-ink-soft">
                      {t('customer-app:v2.barberProfile.minutes', {
                        count: service.durationMinutes,
                      })}
                    </p>
                  </div>
                  {currency ? (
                    <p className="shrink-0 text-v2-body font-semibold tabular-nums text-v2-ink">
                      {money(service.priceCents, currency)}
                    </p>
                  ) : null}
                  {/* Fresha service-row grammar: the row states its own action. */}
                  <span className="shrink-0 rounded-v2-1 border border-v2-hairline px-2.5 py-1 text-v2-meta font-semibold text-v2-green">
                    {t('customer-app:v2.result.book')}
                  </span>
                </Link>
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
      <section aria-labelledby="v2-barber-work" className="border-t border-v2-hairline pb-1 pt-4">
        <div className="pb-1.5">
          <h2 id="v2-barber-work" className="text-v2-title font-semibold text-v2-ink">
            {t('customer-app:v2.barberProfile.work')}
          </h2>
        </div>
        {/*
          ARCHITECTED FOR THE GRID, RENDERING THE TRUTH. Design Pass A §5: the
          portfolio's final form is a 3-column Instagram-style media grid, and
          this container IS that grid — `grid grid-cols-3 gap-0.5`, square
          tiles, edge-to-edge — so activating it when a work-items contract
          exists means mapping real rows into it, not redesigning the page.
          Today the schema has no work/media table, so the grid holds zero
          cells and the section states that honestly in one quiet line. No
          placeholder frames: an empty frame promises content that cannot
          arrive.
        */}
        <div className="grid grid-cols-3 gap-0.5 empty:hidden">
          {/* Real work items render here as square tiles when the contract exists. */}
        </div>
        <p className="py-2 text-v2-meta text-v2-ink-soft">
          {t('customer-app:v2.barberProfile.noWork')}
        </p>
      </section>
    </div>
  )
}
