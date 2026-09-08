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
import { isOpenNow } from '@/shared/lib/openingHours'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/Button'
import { Duration } from '@/shared/ui/Duration'
import { EmptyState } from '@/shared/ui/EmptyState'
import { MediaFrame } from '@/shared/ui/MediaFrame'
import { Money } from '@/shared/ui/Money'
import { PostGrid } from '@/shared/ui/PostGrid'
import { ProfileCtaBar, ProfileCtaButtons } from '@/shared/ui/ProfileCtaBar'
import { QueueList } from '@/shared/ui/QueueList'
import { Rating } from '@/shared/ui/Rating'
import { ReviewList } from '@/shared/ui/ReviewList'
import { Row } from '@/shared/ui/Row'
import { SkeletonRect, SkeletonText } from '@/shared/ui/Skeleton'
import { SocialProof } from '@/shared/ui/SocialProof'
import { IconCheck, IconLocation, IconQueue } from '@/shared/ui/icons'
import {
  useFollowOrganization,
  useLocationHours,
  useMyFollowedOrganizations,
  useOrganizationFollowerCount,
  useOrganizationLocations,
  useOrganizationPosts,
  useOrganizationReputation,
  useOrganizationReviews,
  useOrganizationServices,
  useOrganizationTeam,
  usePublicOrganization,
  useShopQueues,
  useShopServiceState,
} from '@/features/organization-profile/api/organizationProfile'
import { TeamList } from '@/features/organization-profile/components/TeamList'
import { HoursSection } from '@/features/organization-profile/components/HoursSection'

/**
 * /shop/:slug — le profil public d'un salon (F2 §4), SANS authentification.
 *
 * Hiérarchie imposée (MASTER_SPEC §9) : imagerie du lieu → identité → note si
 * elle est réelle → adresse et état d'ouverture → RÉSERVER → Suivre →
 * Services → Équipe → Réalisations → Avis → Horaires.
 *
 * Cas mobile (B1) : une location `service_area` n'a AUCUNE adresse — la zone
 * se dit (« ville et alentours »), elle ne se localise jamais à un point, et
 * la file n'y existe pas (service_area_has_no_queue).
 */
export function OrganizationProfilePage() {
  useApplySurfaceTheme('consumer')
  const { t } = useTranslation('v2')
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const { session } = useSession()

  const organization = usePublicOrganization(slug)
  const organizationId = organization.data?.id ?? null

  const locations = useOrganizationLocations(slug)
  const locationRows = locations.data ?? []
  const [pickedLocationId, setPickedLocationId] = useState<string | null>(null)
  const location = locationRows.find((row) => row.id === pickedLocationId) ?? locationRows[0] ?? null
  const locationId = location?.id ?? null
  const isServiceArea = location?.kind === 'service_area'

  const services = useOrganizationServices(slug, locationId)
  const team = useOrganizationTeam(slug)
  const hours = useLocationHours(slug, locationId)
  const serviceState = useShopServiceState(slug, locationId)
  /* P1PRO §7 — « Réservable » vs « Sur demande » : la capacité commerciale
     décide de l'issue du tunnel ; le CTA le dit AVANT. */
  const capability = usePublicBookingCapability(slug)
  /* EN COURS tant que lieux/état n'ont pas répondu — jamais « panne » ni
     « fermé » pendant un chargement (revue F2). Lieu inexistant une fois
     résolu : rien n'est réservable, un fait. */
  const ctaResolving = locations.isPending || (Boolean(locationId) && serviceState.isPending)
  const noActiveLocation = locations.isSuccess && !locationId
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
  const queues = useShopQueues(slug, isServiceArea ? null : locationId, cta.queueOpen)

  const followerCount = useOrganizationFollowerCount(organizationId)
  const reputation = useOrganizationReputation(organizationId)
  const reviews = useOrganizationReviews(organizationId)
  const posts = useOrganizationPosts(slug)

  /* D1 (modèle X) — CTA inline dans l'en-tête ; barre collante en repli. */
  const [inlineCtaRef, inlineCtaInView] = useInView()

  const myFollows = useMyFollowedOrganizations(Boolean(session))
  const following = Boolean(
    organizationId && (myFollows.data ?? []).some((row) => row.organization_id === organizationId),
  )
  const follow = useFollowOrganization(organizationId)

  /* D1 §7 — mémoire LOCALE des profils consultés. Aucune écriture serveur. */
  const orgName = organization.data?.name ?? null
  const orgCity = location?.city ?? null
  useEffect(() => {
    if (!orgName) return
    recordRecentProfile({
      kind: 'shop',
      key: slug,
      name: orgName,
      city: orgCity,
      avatarUrl: null,
      organizationSlug: slug,
    })
  }, [orgName, orgCity, slug])

  useDocumentMeta({
    title: organization.data ? `${organization.data.name} — FadeUp` : null,
    description: organization.data ? t('profile.share.shopDescription', { name: organization.data.name }) : null,
    url: typeof window === 'undefined' ? null : window.location.href,
  })

  if (organization.isPending || locations.isPending) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-3 px-4 py-12" aria-busy="true">
        <SkeletonRect className="h-40 w-full" />
        <SkeletonText className="w-2/3" />
        <SkeletonText className="w-1/3" />
      </div>
    )
  }

  if (organization.isError) {
    return (
      <EmptyState
        className="min-h-[60dvh] justify-center"
        title={t('queue.public.error.title')}
        description={t('queue.public.error.description')}
        action={
          <Button variant="secondary" onClick={() => void organization.refetch()}>
            {t('common.action.retry')}
          </Button>
        }
      />
    )
  }

  const org = organization.data
  if (!org) {
    return (
      <EmptyState
        className="min-h-[60dvh] justify-center"
        title={t('profile.shop.notFoundTitle')}
        description={t('profile.shop.notFoundDescription')}
        action={
          <Link to="/" className="text-fu-sm font-medium text-[var(--fu-accent-text)] underline-offset-2 hover:underline">
            {t('common.action.goHome')}
          </Link>
        }
      />
    )
  }

  const reputationRow = reputation.data ?? null
  const reviewRows = reviews.data ?? []
  const postRows = posts.data ?? []
  /* Repli : fuseau de l'appareil — DateTime signale l'écart de lui-même. */
  const timezone = location?.timezone ?? deviceTimezone()
  /* « Ouvert / Fermé maintenant » appartient à l'EN-TÊTE, à côté de
     l'adresse (MASTER_SPEC §9 — position 4) ; la section Horaires détaille. */
  const openNow = location && !isServiceArea ? isOpenNow(hours.data ?? [], timezone) : null
  const queueLink = locationId ? `/q/${encodeURIComponent(slug)}?l=${locationId}` : null
  const bookLink = `/book/${encodeURIComponent(slug)}?l=${locationId ?? ''}`
  const hasCategories = (services.data ?? []).some((row) => row.category_name)

  const toggleFollow = () => {
    if (!session) {
      void navigate(`/auth/login?redirect=${encodeURIComponent(routerLocation.pathname)}`)
      return
    }
    follow.mutate(following ? 'unfollow' : 'follow')
  }

  const banner = demoBanner(slug)
  const ctaProps = {
    cta,
    name: org.name,
    bookTo: bookLink,
    queueTo: queueLink,
    timezone: location?.timezone ?? null,
    following,
    followBusy: follow.isPending,
    onToggleFollow: toggleFollow,
    onRequest: capability.data === false,
  }

  return (
    <div className="mx-auto w-full max-w-xl pb-40 lg:grid lg:max-w-4xl lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
      <div>
        {/* 1. Bannière de l'établissement, pleine largeur (modèle X) —
            image de démonstration marquée quand elle existe, sinon le cadre
            honnête (aucune fausse image). */}
        {banner ? (
          <div className="h-40 overflow-hidden md:h-48 lg:rounded-[var(--radius-card)]">
            <img src={banner} alt={t('profile.header.coverLabel', { name: org.name })} className="size-full object-cover" />
          </div>
        ) : (
          <MediaFrame alt={t('profile.header.coverLabel', { name: org.name })} ratio="landscape" />
        )}

        {/* Portrait rond en surimpression, décalé à gauche. */}
        <div className="-mt-10 flex items-end gap-4 px-4">
          <Avatar name={org.name} size="xl" className="fu-vt-portrait ring-4 ring-[var(--fu-canvas)]" />
        </div>

        <div className="mt-3 px-4">
          {/* 2. Identité. */}
          <h1 className="text-fu-2xl font-semibold tracking-tight">{org.name}</h1>

          {/* 3. Note — SEULEMENT si elle est réelle (jamais zéro étoile). */}
          {reputationRow?.rating_average != null && (
            <div className="mt-1.5">
              <Rating value={reputationRow.rating_average} count={reputationRow.rating_count} />
            </div>
          )}

          {/* 4. Adresse et état d'ouverture — ou la ZONE, sans point ni adresse. */}
          {location && (
            <p className="mt-2 flex items-center gap-1.5 text-fu-sm text-[var(--fu-text-secondary)]" data-testid="shop-location">
              <IconLocation aria-hidden="true" className="size-3.5 shrink-0" />
              {isServiceArea
                ? t('profile.location.serviceArea', { city: location.city ?? '' })
                : [location.address_line1, location.city].filter(Boolean).join(', ')}
              {openNow !== null && (
                <span
                  data-testid="header-open-now"
                  className={openNow ? 'font-medium text-[var(--fu-accent-text)]' : 'font-medium text-[var(--fu-text-primary)]'}
                >
                  {openNow ? t('states.opening.open') : t('states.opening.closed')}
                </span>
              )}
            </p>
          )}

          {/* Salon multi-lieux : choisir le lieu de référence. */}
          {locationRows.length > 1 && (
            <div className="mt-3 rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>*:last-child]:border-b-0">
              {locationRows.map((row) => (
                <Row
                  key={row.id}
                  as="button"
                  onClick={() => setPickedLocationId(row.id)}
                  title={row.name}
                  subtitle={row.city ?? undefined}
                  trailing={
                    row.id === locationId ? (
                      <IconCheck aria-hidden="true" className="size-4 text-[var(--fu-accent-text)]" />
                    ) : undefined
                  }
                />
              ))}
            </div>
          )}

          {/* Les MÉTRIQUES — une ligne, cinq faits distincts (Followers =
              fait du graphe ; Verified Clients et Likes sans contrat public
              côté salon : « — » ; jamais un zéro fabriqué). */}
          <SocialProof
            layout="row"
            className="mt-4"
            followers={followerCount.data ?? null}
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

        {/* 7. Services — rangées à filet fin, groupées par catégorie réelle. */}
        <section className="mt-8 px-4" aria-label={t('profile.shop.servicesTitle')}>
          <h2 className="text-fu-lg font-semibold">{t('profile.shop.servicesTitle')}</h2>
          {(services.data ?? []).length > 0 ? (
            <div className="mt-3 rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>*:last-child]:border-b-0">
              {(services.data ?? []).map((service, index, all) => {
                const previous = index > 0 ? all[index - 1] : undefined
                const newCategory =
                  hasCategories && service.category_name && service.category_name !== previous?.category_name
                return (
                  <div key={service.id}>
                    {newCategory && (
                      <p className="border-b border-[var(--fu-border)] bg-[var(--fu-surface-subtle)] px-4 py-1.5 text-fu-xs font-medium text-[var(--fu-text-secondary)]">
                        {service.category_name}
                      </p>
                    )}
                    <Row
                      clampTitle
                      title={<span className="text-fu-base font-medium">{service.name}</span>}
                      subtitle={<Duration minutes={service.duration_minutes} />}
                      trailing={<Money cents={service.price_cents} currency={org.currency} />}
                    />
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('profile.services.emptyDescription')}</p>
          )}
        </section>

        {/* 8. Équipe — CTA de réservation seulement pour les réservables. */}
        <section className="mt-8 px-4" aria-label={t('profile.shop.teamTitle')}>
          <h2 className="text-fu-lg font-semibold">{t('profile.shop.teamTitle')}</h2>
          {(team.data ?? []).length > 0 ? (
            <div className="mt-3">
              <TeamList slug={slug} members={team.data ?? []} locationId={locationId} />
            </div>
          ) : (
            <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('profile.shop.teamEmptyDescription')}</p>
          )}
        </section>

        {/* File en direct (F1b) — un FAIT : files par barber et nombre en
            attente, seulement quand la file accepte. Le pont F1 est évident. */}
        {cta.queueOpen && (queues.data ?? []).length > 0 && queueLink && (
          <section className="mt-8 px-4" aria-label={t('profile.shop.queueTitle')}>
            <h2 className="text-fu-lg font-semibold">{t('profile.shop.queueTitle')}</h2>
            <div className="mt-3 rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>div>*:last-child]:border-b-0">
              <QueueList queues={queues.data ?? []} />
            </div>
            <Link
              to={queueLink}
              data-testid="shop-queue-link"
              className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-fu-sm font-medium text-[var(--fu-accent-text)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
            >
              <IconQueue aria-hidden="true" className="size-4" />
              {t('profile.shop.queueLink')}
            </Link>
          </section>
        )}

        {/* 9. Réalisations — les posts du lieu (B4). */}
        <section className="mt-8 px-4" aria-label={t('profile.shop.portfolioTitle')}>
          <h2 className="text-fu-lg font-semibold">{t('profile.shop.portfolioTitle')}</h2>
          {postRows.length > 0 ? (
            <PostGrid posts={postRows} authorName={org.name} className="mt-3" />
          ) : (
            <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]" data-testid="portfolio-empty">
              {t('profile.portfolio.emptyDescription')}
            </p>
          )}
        </section>
      </div>

      <aside className="px-4 lg:px-0 lg:pt-6">
        {/* 10. Avis — jamais zéro étoile. */}
        <section className="mt-8" aria-label={t('profile.shop.reviewsTitle')}>
          <h2 className="text-fu-lg font-semibold">{t('profile.shop.reviewsTitle')}</h2>
          {reviewRows.length > 0 ? (
            <ReviewList reviews={reviewRows} timezone={timezone} className="mt-2" />
          ) : (
            <div className="mt-2" data-testid="reviews-empty">
              <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('states.rating.none')}</p>
              <p className="mt-1 text-fu-xs text-[var(--fu-text-secondary)]">{t('profile.reviews.emptyDescription')}</p>
            </div>
          )}
        </section>

        {/* 11. Horaires — fuseau du lieu ; zone de service : pas d'horaires
            de salle d'attente à inventer, la section dit ce qu'elle sait. */}
        <section className="mt-8" aria-label={t('profile.shop.hoursTitle')}>
          <h2 className="text-fu-lg font-semibold">{t('profile.shop.hoursTitle')}</h2>
          <HoursSection rows={hours.data ?? []} timezone={timezone} />
        </section>
      </aside>

      {/* La barre COLLANTE — repli de conversion, seulement quand la paire
          inline du modèle X est sortie de l'écran. */}
      <ProfileCtaBar {...ctaProps} hidden={inlineCtaInView} />
    </div>
  )
}
