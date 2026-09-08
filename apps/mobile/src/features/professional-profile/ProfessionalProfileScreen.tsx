import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Animated, { FadeIn } from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import { deriveProfileCta, type ProfileCtaState } from '@/shared/lib/serviceState'
import { recordRecentProfile } from '@/shared/lib/recentProfiles'
import { resolveMediaSource } from '@/shared/lib/demoMedia'
import { FuText } from '@/shared/ui/Text'
import { MonoText } from '@/shared/ui/MonoText'
import { Badge } from '@/shared/ui/Badge'
import { ClaimBadge } from '@/shared/ui/ClaimBadge'
import { Duration } from '@/shared/ui/Duration'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Money } from '@/shared/ui/Money'
import { Skeleton } from '@/shared/ui/Skeleton'
import { SocialProof } from '@/shared/ui/SocialProof'
import { BackButton } from '@/shared/ui/BackButton'
import {
  PostGrid,
  ProfileCtaPair,
  ProfileHero,
  RatingLine,
  ReviewRow,
} from '@/shared/ui/profileParts'
import { useSession } from '@/shared/data/auth'
import { AuthSheet } from '@/shared/ui/AuthSheet'
import {
  useBarberServices,
  useProfessionalByHandle,
  useProfessionalPosts,
  useProfessionalReputation,
  useMyFollowedProfessionalIds,
  useProfessionalReviews,
  useProfileServiceState,
  useToggleFollowProfessional,
  usePublicBarber,
  usePublicLocations,
  useWorkplace,
  useWorkplaceOrganization,
} from '@/features/professional-profile/api/professionalProfile'
import { color, shadow, spacing, touchTarget } from '@/shared/theme/tokens'

/**
 * /pro/[handle] — le profil barber public au MODÈLE X (D1 §6), ordre imposé :
 * bannière → portrait en surimpression → nom → revendication + handle →
 * accroche → « Travaille chez [Salon] » (cliquable) → localisation →
 * signaux opérationnels réels → bio → métriques sur UNE ligne (cinq,
 * distinctes) → CTA Réserver + Suivre INLINE → services → réalisations →
 * avis.
 *
 * La paire de CTA existe en DEUX exemplaires EXCLUSIFS : inline et barre
 * collante — la barre ne se rend que quand la paire inline est sortie de
 * l'écran (jamais deux verts pleins visibles, D1 §6).
 *
 * Le média manquant est LA norme (profils scrapés) : chaque repli est un
 * état de première classe. Un profil non revendiqué reste NEUTRE et entier.
 */
export function ProfessionalProfileScreen() {
  const { handle: rawHandle } = useLocalSearchParams<{ handle: string }>()
  const handle = typeof rawHandle === 'string' ? rawHandle : null
  const { t } = useTranslation('v2')
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const professional = useProfessionalByHandle(handle)
  const professionalId = professional.data?.id ?? null
  const isClaimed = professional.data?.claim_state === 'claimed'

  const workplace = useWorkplace(professionalId)
  const work = workplace.data?.[0] ?? null
  const slug = work?.organization_slug ?? null
  const organization = useWorkplaceOrganization(slug)
  const barber = usePublicBarber(slug, work?.barber_id ?? null)
  const locations = usePublicLocations(slug)

  /* Repli de lieu (correctif de revue F2) : staff sans location_id →
     premier lieu actif de l'organisation ; aucun lieu → fermé, un FAIT. */
  const locationId = work?.location_id ?? locations.data?.[0]?.id ?? null
  const location = (locations.data ?? []).find((l) => l.id === locationId) ?? null

  const services = useBarberServices(slug, work?.barber_id ?? null)
  const serviceState = useProfileServiceState(slug, locationId, work?.barber_id ?? null)
  const reputation = useProfessionalReputation(professionalId)
  const reviews = useProfessionalReviews(professionalId)
  const posts = useProfessionalPosts(handle)

  /* Le CTA ne MENT jamais pendant la résolution (F2 §4) : tant que la
     chaîne handle → rattachement → lieu → état est en cours, il charge —
     ni panne ni fermeture affirmée. Rattachement résolu VIDE (non
     revendiqué, ou aucun lieu actif) : fermé — un fait. */
  const cta: ProfileCtaState = useMemo(() => {
    if (professional.isPending || workplace.isPending) {
      return { kind: 'loading', queueOpen: false, temporaryUntil: null }
    }
    if (!work || !locationId) {
      return { kind: 'closed', queueOpen: false, temporaryUntil: null }
    }
    return deriveProfileCta(serviceState.data, {
      isError: serviceState.isError,
      isLoading: serviceState.isPending || locations.isPending,
    })
  }, [professional.isPending, workplace.isPending, work, locationId, serviceState.data, serviceState.isError, serviceState.isPending, locations.isPending])

  /* Mémoire locale des profils consultés (D1 §7) — jamais envoyée au serveur. */
  useEffect(() => {
    const data = professional.data
    if (data && handle) {
      void recordRecentProfile({
        kind: 'pro',
        key: handle,
        name: data.display_name,
        city: location?.city ?? null,
        avatarUrl: data.avatar_url ?? null,
        organizationSlug: slug,
      })
    }
  }, [professional.data, handle, location?.city, slug])

  /* Exclusivité inline / barre collante : la barre ne se rend que quand la
     paire inline est sortie de l'écran. */
  const [ctaBottom, setCtaBottom] = useState<number | null>(null)
  const [showSticky, setShowSticky] = useState(false)
  const scrollRef = useRef<ScrollView>(null)

  /* Depuis un profil barber, le tunnel démarre barber PRÉSÉLECTIONNÉ
     (MASTER_SPEC §6) — l'étape barber sera sautée. */
  const onBook = () =>
    router.push({
      pathname: '/book/[slug]',
      params: { slug: slug ?? '', ...(work?.barber_id ? { b: work.barber_id } : {}) },
    })
  const onQueue = () => router.push(`/q/${encodeURIComponent(slug ?? '')}` as never)

  /* M1b — le follow réel : auth à l'action, l'intention rejouée à la
     session posée. Profil non revendiqué : bouton MASQUÉ (la base refuse
     de suivre une identité non revendiquée — 42704). */
  const { session } = useSession()
  const followedIds = useMyFollowedProfessionalIds(Boolean(session))
  const toggleFollow = useToggleFollowProfessional()
  const [authOpen, setAuthOpen] = useState(false)
  const pendingFollow = useRef(false)
  const following = professionalId ? followedIds.data?.has(professionalId) === true : false
  const follow =
    isClaimed && professionalId
      ? {
          following,
          busy: toggleFollow.isPending,
          name: professional.data?.display_name ?? '',
          onPress: () => {
            if (!session) {
              pendingFollow.current = true
              setAuthOpen(true)
              return
            }
            toggleFollow.mutate({ professionalId, follow: !following })
          },
        }
      : undefined
  const onAuthed = () => {
    if (pendingFollow.current && professionalId) {
      pendingFollow.current = false
      toggleFollow.mutate({ professionalId, follow: true })
    }
  }

  /* F4/M1b — non revendiqué SANS rattachement : le CTA devient la demande
     d'intérêt réelle, seulement une fois la résolution TERMINÉE (jamais
     pendant un chargement — le CTA ne ment pas). */
  const onInterest =
    workplace.isSuccess && !work && !isClaimed && handle
      ? () => router.push({ pathname: '/book/[slug]', params: { slug: handle, pro: handle } })
      : undefined

  if (professional.isPending) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loading} accessibilityElementsHidden>
          <Skeleton height={168} />
          <Skeleton width="60%" height={24} />
          <Skeleton width="40%" />
          <Skeleton height={52} />
        </View>
      </SafeAreaView>
    )
  }

  if (professional.isError || !professional.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <EmptyState
          title={t('profile.notFound.title')}
          body={t('profile.notFound.description')}
          actionLabel={t('mobile.placeholder.back')}
          onAction={() => router.back()}
        />
      </SafeAreaView>
    )
  }

  const data = professional.data
  const isServiceArea = location?.kind === 'service_area'
  const bio = barber.data?.bio ?? data.bio ?? null

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <BackButton onPress={() => router.back()} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={(event) => {
          if (ctaBottom !== null) {
            setShowSticky(event.nativeEvent.contentOffset.y > ctaBottom)
          }
        }}
      >
        <ProfileHero
          bannerSrc={null}
          avatarSrc={resolveMediaSource(data.avatar_url)}
          name={data.display_name}
        />

        <View style={styles.body}>
          <FuText variant="heading">{data.display_name}</FuText>

          <View style={styles.claimRow}>
            {isClaimed ? (
              <Badge variant="brand" label={t('states.claim.claimed')} />
            ) : (
              <ClaimBadge />
            )}
            <MonoText size="sm" tone="secondary">
              @{data.handle}
            </MonoText>
          </View>

          {data.headline ? (
            <FuText variant="body" tone="secondary">
              {data.headline}
            </FuText>
          ) : null}

          {!isClaimed ? (
            <FuText variant="sm" tone="secondary">
              {t('profile.unclaimed.explainer', { name: data.display_name })}
            </FuText>
          ) : null}

          {/* « Travaille chez [Salon] » — cliquable. Un indépendant n'a pas
              de salon : sa page EST son établissement, la ligne disparaît. */}
          {work && work.marketplace_supply_type === 'barbershop' ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push(`/shop/${encodeURIComponent(work.organization_slug)}` as never)}
              style={styles.worksAt}
            >
              <Ionicons name="storefront-outline" size={15} color={color.accentText} />
              <FuText variant="smMedium" tone="accent">
                {t('profile.header.worksAt', { salon: work.organization_name })}
              </FuText>
            </Pressable>
          ) : null}

          {location ? (
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={14} color={color.textSecondary} />
              <FuText variant="sm" tone="secondary" style={styles.locationText}>
                {isServiceArea
                  ? t('profile.location.serviceArea', { city: location.city ?? '' })
                  : [location.address_line1, location.city].filter(Boolean).join(', ')}
              </FuText>
            </View>
          ) : null}

          {/* Signaux opérationnels RÉELS — la file quand elle accepte. */}
          {cta.queueOpen ? <Badge variant="brand" label={t('states.queue.open')} /> : null}

          {bio ? (
            <FuText variant="sm" tone="secondary">
              {bio}
            </FuText>
          ) : null}

          {/* Les cinq métriques, UNE ligne, jamais agrégées. */}
          <View accessibilityLabel={t('profile.metrics.label')}>
            <SocialProof
              values={{
                followers: data.follower_count ?? null,
                verifiedClients: null,
                rating: reputation.data?.rating_average ?? null,
                reviews: reputation.data ? reputation.data.rating_count : null,
                likes: null,
              }}
            />
          </View>

          {/* LA paire de CTA inline — avant tout contenu (modèle X). */}
          <View
            onLayout={(event) => {
              const { y, height } = event.nativeEvent.layout
              setCtaBottom(y + height)
            }}
          >
            <ProfileCtaPair cta={cta} isManaged={isClaimed} onBook={onBook} onQueue={onQueue} follow={follow} onInterest={onInterest} />
          </View>

          {/* Services — la Row de liste dense demeure la primitive ici. */}
          <View>
            <FuText variant="title" style={styles.sectionTitle}>
              {t('profile.services.title')}
            </FuText>
            {services.isPending && work ? (
              <View style={styles.skeletons} accessibilityElementsHidden>
                <Skeleton width="75%" />
                <Skeleton width="66%" />
              </View>
            ) : (services.data ?? []).length > 0 ? (
              (services.data ?? []).map((service, index) => (
                <View key={service.id} style={[styles.serviceRow, index > 0 && styles.serviceDivider]}>
                  <View style={styles.serviceInfo}>
                    <FuText variant="smMedium" numberOfLines={1}>
                      {service.name}
                    </FuText>
                    <Duration minutes={service.duration_minutes} />
                  </View>
                  {organization.data?.currency ? (
                    <Money cents={service.price_cents} currency={organization.data.currency} />
                  ) : (
                    <FuText variant="sm" tone="secondary">
                      {t('states.metric.noData')}
                    </FuText>
                  )}
                </View>
              ))
            ) : (
              <FuText variant="sm" tone="secondary">
                {t('profile.services.emptyDescription')}
              </FuText>
            )}
          </View>

          {/* Réalisations — chaîne B4 réelle, médias signés. */}
          <View>
            <FuText variant="title" style={styles.sectionTitle}>
              {t('profile.portfolio.title')}
            </FuText>
            {(() => {
              const media = (posts.data?.pages ?? []).flat().flatMap((post) => post.media)
              if (posts.isPending) {
                return (
                  <View style={styles.skeletons} accessibilityElementsHidden>
                    <Skeleton height={110} />
                  </View>
                )
              }
              if (media.length === 0) {
                return (
                  <FuText variant="sm" tone="secondary">
                    {t('profile.portfolio.emptyDescription')}
                  </FuText>
                )
              }
              return <PostGrid media={media} />
            })()}
          </View>

          {/* Avis — `null` n'est jamais zéro étoile. */}
          <View>
            <FuText variant="title" style={styles.sectionTitle}>
              {t('profile.reviews.title')}
            </FuText>
            <RatingLine
              average={reputation.data?.rating_average ?? null}
              count={reputation.data ? reputation.data.rating_count : null}
            />
            {(reviews.data ?? []).length > 0 ? (
              (reviews.data ?? []).map((review) => (
                <ReviewRow
                  key={review.review_id}
                  rating={review.rating}
                  comment={review.comment}
                  reviewerName={review.reviewer_display_name ?? t('profile.reviews.anonymous')}
                  createdAt={review.created_at}
                  replyBody={review.reply_body}
                />
              ))
            ) : (
              <FuText variant="sm" tone="secondary" style={styles.reviewsEmpty}>
                {t('profile.reviews.emptyDescription')}
              </FuText>
            )}
          </View>
        </View>
      </ScrollView>

      {/* La barre collante — SEULEMENT quand la paire inline est sortie. */}
      {showSticky ? (
        <Animated.View
          entering={FadeIn.duration(120)}
          style={[styles.stickyBar, shadow.sticky, { paddingBottom: insets.bottom + spacing(2) }]}
        >
          <ProfileCtaPair cta={cta} isManaged={isClaimed} onBook={onBook} onQueue={onQueue} follow={follow} onInterest={onInterest} />
        </Animated.View>
      ) : null}

      <AuthSheet open={authOpen} context="follow" onClose={() => setAuthOpen(false)} onAuthed={onAuthed} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas },
  loading: { padding: spacing(4), gap: spacing(3) },
  content: { paddingBottom: spacing(10) },
  body: { paddingHorizontal: spacing(4), paddingTop: spacing(3), gap: spacing(3) },
  claimRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), flexWrap: 'wrap' },
  worksAt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
    minHeight: touchTarget - 12,
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },
  locationText: { flexShrink: 1 },
  sectionTitle: { marginBottom: spacing(2) },
  skeletons: { gap: spacing(2) },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(3),
    paddingVertical: spacing(2.5),
  },
  serviceDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },
  serviceInfo: { flexShrink: 1, gap: 2 },
  reviewsEmpty: { marginTop: spacing(2) },
  stickyBar: {
    position: 'absolute',
    bottom: 0,
    insetInlineStart: 0,
    insetInlineEnd: 0,
    backgroundColor: color.surface,
    paddingHorizontal: spacing(4),
    paddingTop: spacing(3),
  },
})
