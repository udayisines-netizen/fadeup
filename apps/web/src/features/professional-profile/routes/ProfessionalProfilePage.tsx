import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSession } from '@/shared/hooks/useSession'
import { useDocumentMeta } from '@/shared/hooks/useDocumentMeta'
import { useInView } from '@/shared/hooks/useInView'
import { useApplySurfaceTheme } from '@/shared/theme/useTheme'
import { deriveProfileCta } from '@/shared/lib/serviceState'
import { usePublicBookingCapability } from '@/shared/data/capability'
import { demoBanner } from '@/shared/lib/demoMedia'
import { recordRecentProfile } from '@/shared/lib/recentlyViewed'
import { deviceTimezone } from '@/shared/lib/format'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/Button'
import { ClaimBadge } from '@/shared/ui/ClaimBadge'
import { Duration } from '@/shared/ui/Duration'
import { EmptyState } from '@/shared/ui/EmptyState'
import { MediaFrame } from '@/shared/ui/MediaFrame'
import { Money } from '@/shared/ui/Money'
import { PostGrid } from '@/shared/ui/PostGrid'
import { ProfileCtaBar, ProfileCtaButtons } from '@/shared/ui/ProfileCtaBar'
import { ReviewList } from '@/shared/ui/ReviewList'
import { Row } from '@/shared/ui/Row'
import { SkeletonCircle, SkeletonText } from '@/shared/ui/Skeleton'
import { SocialProof } from '@/shared/ui/SocialProof'
import { StateBadge } from '@/shared/ui/StateBadge'
import { IconLocation, IconQueue, IconShop } from '@/shared/ui/icons'
import {
  useBarberServices,
  useFollowProfessional,
  useLocationQueues,
  useMyFollowedProfessionals,
  useProfessionalByHandle,
  useProfessionalPosts,
  useProfessionalReputation,
  useProfessionalReviews,
  useProfileServiceState,
  usePublicBarber,
  usePublicLocations,
  useWorkplace,
  useWorkplaceOrganization,
} from '@/features/professional-profile/api/professionalProfile'
import { ClaimPrompt, ClaimSheet } from '@/features/professional-profile/components/ClaimSheet'

/**
 * /pro/:handle — le profil public d'un barber (F2 §3), SANS authentification.
 *
 * Hiérarchie imposée (MASTER_SPEC §9) : média et avatar → identité → état
 * revendiqué → handle et accroche → « Travaille chez [Salon] » cliquable →
 * localisation → RÉSERVER → Suivre → signaux opérationnels réels →
 * portfolio → services → preuve sociale → avis. L'action avant le contenu —
 * c'est voulu.
 *
 * Deux natures de source : l'identité PORTABLE (get_public_professional_by_
 * handle — survit au changement de salon) et la face STAFF (get_public_barber
 * via la résolution inverse F2, qui ne rend une ligne que pour une identité
 * revendiquée — décision B1 conservée). Un profil NON revendiqué n'a donc ni
 * salon affiché, ni services, ni réservation : rien n'est fabriqué, le badge
 * reste neutre, et le chemin de revendication est présent.
 */
export function ProfessionalProfilePage() {
  useApplySurfaceTheme('consumer')
  const { t } = useTranslation('v2')
  const { handle = '' } = useParams()
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const { session } = useSession()

  const professional = useProfessionalByHandle(handle)
  const professionalId = professional.data?.id ?? null

  const workplaces = useWorkplace(professionalId)
  const workplace = workplaces.data?.[0] ?? null
  const isIndependent = workplace?.marketplace_supply_type === 'independent'

  const slug = workplace?.organization_slug ?? null
  const barberId = workplace?.barber_id ?? null
  const organization = useWorkplaceOrganization(slug)
  const barber = usePublicBarber(slug, barberId)
  const services = useBarberServices(slug, barberId)
  const locations = usePublicLocations(slug)
  /* Le lieu du barber, sinon celui du rattachement, sinon le PREMIER lieu
     actif de l'organisation — staff_profiles.location_id est nullable et un
     barber sans lieu épinglé reste un barber de son organisation (revue F2 :
     sans ce repli, son profil affichait « données partielles » à jamais). */
  const locationId =
    barber.data?.location_id ??
    workplace?.location_id ??
    (locations.isSuccess ? (locations.data?.[0]?.id ?? null) : null)
  const location = (locations.data ?? []).find((row) => row.id === locationId) ?? null

  const serviceState = useProfileServiceState(slug, locationId, barberId)
  /* P1PRO §7 — l'issue réelle du geste (« Réservable » vs « Sur demande »)
     dépend de la capacité commerciale de l'ORGANISATION du barber. */
  const capability = usePublicBookingCapability(slug)
  /* EN COURS tant que la chaîne handle -> rattachement -> lieu -> état n'a
     pas répondu : on n'affirme ni panne ni fermeture pendant un chargement. */
  const ctaResolving =
    workplaces.isPending ||
    (Boolean(workplace) && (locations.isPending || (Boolean(locationId) && serviceState.isPending)))
  /* Rattachement résolu mais AUCUN lieu actif : rien n'est réservable — un
     fait, pas une panne. (Sans ce cas, l'état resterait « loading » à vie.) */
  const noActiveLocation = Boolean(workplace) && locations.isSuccess && !locationId
  const cta = useMemo(
    () =>
      noActiveLocation
        ? { kind: 'closed' as const, queueOpen: false, temporaryUntil: null }
        : deriveProfileCta(serviceState.data, {
            isError: serviceState.isError,
            isLoading: ctaResolving,
          }),
    [noActiveLocation, serviceState.data, serviceState.isError, ctaResolving],
  )
  const queues = useLocationQueues(slug, locationId, cta.queueOpen)
  const myQueueFile = (queues.data ?? []).find((file) => file.barber_id === barberId) ?? null

  const posts = useProfessionalPosts(professional.data?.handle ?? null)
  const reviews = useProfessionalReviews(professionalId)
  const reputation = useProfessionalReputation(professionalId)

  const myFollows = useMyFollowedProfessionals(Boolean(session))
  const following = Boolean(
    professionalId && (myFollows.data ?? []).some((row) => row.id === professionalId),
  )
  const follow = useFollowProfessional(professionalId, professional.data?.handle ?? null)

  const [claimOpen, setClaimOpen] = useState(false)
  /* D1 (modèle X) — la paire de CTA vit INLINE sous l'en-tête ; la barre
     collante ne se montre qu'une fois la paire sortie de l'écran. */
  const [inlineCtaRef, inlineCtaInView] = useInView()

  const identity = professional.data
  const isUnclaimed = identity?.claim_state === 'unclaimed'

  /* D1 §7 — mémoire LOCALE des profils consultés (l'accueil du visiteur
     sans compte). Aucune écriture serveur. */
  useEffect(() => {
    if (!identity?.handle) return
    recordRecentProfile({
      kind: 'pro',
      key: identity.handle,
      name: identity.display_name,
      city: null,
      avatarUrl: identity.avatar_url ?? null,
      organizationSlug: slug,
    })
  }, [identity?.handle, identity?.display_name, identity?.avatar_url, slug, identity])

  useDocumentMeta({
    title: identity ? `${identity.display_name} — FadeUp` : null,
    description: identity ? t('profile.share.barberDescription', { name: identity.display_name }) : null,
    image: identity?.avatar_url ?? null,
    url: typeof window === 'undefined' ? null : window.location.href,
  })

  if (professional.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-xl items-center gap-4 px-4 py-12" aria-busy="true">
        <SkeletonCircle className="size-20" />
        <div className="flex-1 space-y-2">
          <SkeletonText className="w-2/3" />
          <SkeletonText className="w-1/3" />
        </div>
      </div>
    )
  }

  if (professional.isError) {
    return (
      <EmptyState
        className="min-h-[60dvh] justify-center"
        title={t('queue.public.error.title')}
        description={t('queue.public.error.description')}
        action={
          <Button variant="secondary" onClick={() => void professional.refetch()}>
            {t('common.action.retry')}
          </Button>
        }
      />
    )
  }

  if (!identity) {
    return (
      <EmptyState
        className="min-h-[60dvh] justify-center"
        title={t('profile.notFound.title')}
        description={t('profile.notFound.description')}
        action={
          <Link to="/" className="text-fu-sm font-medium text-[var(--fu-accent-text)] underline-offset-2 hover:underline">
            {t('common.action.goHome')}
          </Link>
        }
      />
    )
  }

  const allPosts = (posts.data?.pages ?? []).flat()
  const reviewRows = reviews.data ?? []
  const reputationRow = reputation.data ?? null
  /* Sans lieu connu, le repli est le fuseau de l'APPAREIL — DateTime signale
     de lui-même tout écart ; un fuseau de ville codé en dur mentirait. */
  const timezone = location?.timezone ?? deviceTimezone()
  /* La devise vient de l'organisation (contrat V2) — jamais codée en dur. */
  const currency = organization.data?.currency ?? 'EUR'

  const operationalState =
    cta.kind === 'loading'
      ? null // en cours de résolution : aucun badge, rien d'affirmé
      : cta.kind === 'unknown'
        ? ('partial-data' as const)
        : cta.kind === 'bookable'
          ? ('bookable' as const)
          : cta.kind === 'queue-only'
            ? ('queue-open' as const)
            : ('not-bookable' as const)

  const toggleFollow = () => {
    if (!session) {
      void navigate(`/auth/login?redirect=${encodeURIComponent(routerLocation.pathname)}`)
      return
    }
    follow.mutate(following ? 'unfollow' : 'follow')
  }

  const queueLink = slug && locationId ? `/q/${encodeURIComponent(slug)}?l=${locationId}` : null
  const bookLink = slug ? `/book/${encodeURIComponent(slug)}?l=${locationId ?? ''}&b=${barberId ?? ''}` : '/book/unavailable'
  const banner = demoBanner(slug)

  /* La MÊME paire de CTA, inline (modèle X) et en barre collante — jamais
     les deux visibles en même temps. */
  const ctaProps = {
    cta: workplaces.isPending
      ? ({ kind: 'loading', queueOpen: false, temporaryUntil: null } as const)
      : workplace
        ? cta
        : ({ kind: 'closed', queueOpen: false, temporaryUntil: null } as const),
    name: identity.display_name,
    bookTo: bookLink,
    queueTo: queueLink,
    timezone: location?.timezone ?? null,
    following,
    followBusy: follow.isPending,
    onToggleFollow: toggleFollow,
    onRequest: capability.data === false,
    /* La note « rejoindra FadeUp » n'est affirmée qu'une fois la
       résolution TERMINÉE, et seulement pour un non revendiqué — jamais
       pendant un chargement (revue F2, B1). */
    noteOverride:
      workplaces.isSuccess && !workplace && isUnclaimed
        ? t('profile.unclaimed.bookingUnavailable')
        : undefined,
    /* F4 — le cul-de-sac du non revendiqué est levé : le CTA devient une
       demande d'intérêt réelle (B2), seulement une fois la résolution
       TERMINÉE — jamais pendant un chargement. */
    interestTo:
      workplaces.isSuccess && !workplace && isUnclaimed && identity.handle
        ? `/request/${encodeURIComponent(identity.handle)}`
        : null,
  }

  return (
    <div className="mx-auto w-full max-w-xl pb-40 lg:grid lg:max-w-4xl lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
      <div>
        {/* 1. Bannière pleine largeur (modèle X) — image de démonstration
            marquée quand elle existe, sinon le cadre honnête. */}
        {banner ? (
          <div className="h-40 overflow-hidden md:h-48 lg:rounded-[var(--radius-card)]">
            <img src={banner} alt={t('profile.header.coverLabel', { name: identity.display_name })} className="size-full object-cover" />
          </div>
        ) : (
          <MediaFrame alt={t('profile.header.coverLabel', { name: identity.display_name })} ratio="landscape" />
        )}
        <div className="-mt-10 flex items-end gap-4 px-4">
          <Avatar
            name={identity.display_name}
            src={identity.avatar_url}
            size="xl"
            className="fu-vt-portrait ring-4 ring-[var(--fu-canvas)]"
          />
        </div>

        <div className="mt-3 px-4">
          {/* 2–3. Identité, état revendiqué. */}
          <h1 className="text-fu-2xl font-semibold tracking-tight">{identity.display_name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <ClaimBadge state={identity.is_claimed ? 'claimed' : 'unclaimed'} size="sm" />
            {/* 4. Handle et accroche. */}
            <span className="font-fu-mono text-fu-sm text-[var(--fu-text-secondary)]">@{identity.handle}</span>
          </div>
          {identity.headline && <p className="mt-2 text-fu-base text-[var(--fu-text-secondary)]">{identity.headline}</p>}

          {/* 5. « Travaille chez [Salon] » — le pont vers le profil salon.
              Un indépendant n'a pas d'employeur : sa page EST sa vitrine. */}
          {workplace && !isIndependent && (
            <p className="mt-2 text-fu-sm">
              <Link
                to={`/shop/${encodeURIComponent(workplace.organization_slug)}`}
                data-testid="works-at-link"
                className="inline-flex min-h-11 items-center gap-1.5 font-medium text-[var(--fu-accent-text)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
              >
                <IconShop aria-hidden="true" className="size-4" />
                {t('profile.header.worksAt', { salon: workplace.organization_name })}
              </Link>
            </p>
          )}

          {/* 6. Localisation — adresse OU zone de service, jamais d'adresse inventée. */}
          {location && (
            <p className="mt-1 flex items-center gap-1.5 text-fu-sm text-[var(--fu-text-secondary)]" data-testid="profile-location">
              <IconLocation aria-hidden="true" className="size-3.5 shrink-0" />
              {location.kind === 'service_area'
                ? t('profile.location.serviceArea', { city: location.city ?? '' })
                : [location.address_line1, location.city].filter(Boolean).join(', ')}
            </p>
          )}

          {/* Non revendiqué : transparent, neutre, digne de confiance. */}
          {isUnclaimed && (
            <p className="mt-3 text-fu-sm leading-relaxed text-[var(--fu-text-secondary)]" data-testid="unclaimed-explainer">
              {t('profile.unclaimed.explainer', { name: identity.display_name })}
            </p>
          )}
          {isUnclaimed && (
            <ClaimPrompt professionalName={identity.display_name} onOpen={() => setClaimOpen(true)} />
          )}

          {/* 9. Signaux opérationnels RÉELS — seulement quand un lieu existe. */}
          {workplace && operationalState && (
            <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="operational-signals">
              <StateBadge state={operationalState} size="sm" />
              {cta.queueOpen && myQueueFile && queueLink && (
                <Link
                  to={queueLink}
                  className="inline-flex min-h-11 items-center gap-1.5 text-fu-sm font-medium text-[var(--fu-accent-text)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
                >
                  <IconQueue aria-hidden="true" className="size-4" />
                  {t('profile.signals.inQueue', { count: myQueueFile.waiting_count })}
                </Link>
              )}
            </div>
          )}

          {identity.bio && <p className="mt-4 text-fu-base leading-relaxed">{identity.bio}</p>}

          {/* Les MÉTRIQUES — une ligne, cinq faits distincts, jamais un zéro
              fabriqué (Followers = fait du graphe ; Verified Clients et
              Likes sans contrat public : « — » ; Rating/Reviews = réputation
              B4, null sans avis). */}
          <SocialProof
            layout="row"
            className="mt-4"
            followers={identity.follower_count ?? null}
            verifiedClients={null}
            rating={reputationRow?.rating_average ?? null}
            reviews={reputationRow ? reputationRow.rating_count : null}
            likes={null}
          />

          {/* LE CTA — avant tout contenu (modèle X, MASTER §9). */}
          <div ref={inlineCtaRef} className="mt-4" data-testid="inline-cta">
            <ProfileCtaButtons {...ctaProps} />
          </div>
        </div>

        {/* Services d'abord (D1 §6), durée et prix en mono. */}
        {workplace && (
          <section className="mt-8 px-4" aria-label={t('profile.services.title')}>
            <h2 className="text-fu-lg font-semibold">{t('profile.services.title')}</h2>
            {(services.data ?? []).length > 0 ? (
              <div className="mt-3 overflow-hidden rounded-[var(--radius-card)] bg-[var(--fu-surface)] shadow-[var(--fu-shadow-card)] [&>*:last-child]:border-b-0">
                {(services.data ?? []).map((service) => (
                  <Row
                    key={service.id}
                    clampTitle
                    title={<span className="text-fu-base font-medium">{service.name}</span>}
                    subtitle={<Duration minutes={service.duration_minutes} />}
                    trailing={<Money cents={service.price_cents} currency={currency} />}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('profile.services.emptyDescription')}</p>
            )}
          </section>
        )}

        {/* Puis les réalisations en grille. */}
        <section className="mt-8 px-4" aria-label={t('profile.portfolio.title')}>
          <h2 className="text-fu-lg font-semibold">{t('profile.portfolio.title')}</h2>
          {allPosts.length > 0 ? (
            <>
              <PostGrid posts={allPosts} authorName={identity.display_name} className="mt-3" />
              {posts.hasNextPage && (
                <div className="mt-3 flex justify-center">
                  <Button variant="secondary" loading={posts.isFetchingNextPage} onClick={() => void posts.fetchNextPage()}>
                    {t('profile.portfolio.loadMore')}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="mt-2" data-testid="portfolio-empty">
              <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('profile.portfolio.emptyDescription')}</p>
              {/* Un état vide propose une action (§20) : suivre, pour être
                  là quand le travail arrivera. */}
              {!following && (
                <Button variant="secondary" size="sm" className="mt-3" onClick={toggleFollow} loading={follow.isPending}>
                  {t('common.action.follow')}
                </Button>
              )}
            </div>
          )}
        </section>
      </div>

      <aside className="px-4 lg:px-0 lg:pt-6">
        {/* Avis — jamais zéro étoile. */}
        <section className="mt-8" aria-label={t('profile.reviews.title')}>
          <h2 className="text-fu-lg font-semibold">{t('profile.reviews.title')}</h2>
          {reviewRows.length > 0 ? (
            <ReviewList reviews={reviewRows} timezone={timezone} className="mt-2" />
          ) : (
            <div className="mt-2" data-testid="reviews-empty">
              <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('states.rating.none')}</p>
              <p className="mt-1 text-fu-xs text-[var(--fu-text-secondary)]">{t('profile.reviews.emptyDescription')}</p>
            </div>
          )}
        </section>
      </aside>

      {/* La barre COLLANTE — repli de conversion, seulement quand la paire
          inline du modèle X est sortie de l'écran. */}
      <ProfileCtaBar {...ctaProps} hidden={inlineCtaInView} />

      {isUnclaimed && professionalId && (
        <ClaimSheet open={claimOpen} onOpenChange={setClaimOpen} professionalId={professionalId} />
      )}
    </div>
  )
}
