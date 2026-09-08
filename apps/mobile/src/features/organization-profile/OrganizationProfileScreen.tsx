import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Animated, { FadeIn } from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import { deriveProfileCta, type ProfileCtaState } from '@/shared/lib/serviceState'
import { isOpenNow, orderedWeek, formatWallTime } from '@/shared/lib/openingHours'
import { recordRecentProfile } from '@/shared/lib/recentProfiles'
import { demoBanner, resolveMediaSource } from '@/shared/lib/demoMedia'
import { Avatar } from '@/shared/ui/Avatar'
import { Badge } from '@/shared/ui/Badge'
import { Duration } from '@/shared/ui/Duration'
import { EmptyState } from '@/shared/ui/EmptyState'
import { FuText } from '@/shared/ui/Text'
import { Money } from '@/shared/ui/Money'
import { MonoText } from '@/shared/ui/MonoText'
import { Skeleton } from '@/shared/ui/Skeleton'
import { SocialProof } from '@/shared/ui/SocialProof'
import {
  PostGrid,
  ProfileCtaPair,
  ProfileHero,
  RatingLine,
  ReviewRow,
} from '@/shared/ui/profileParts'
import { BackButton } from '@/shared/ui/BackButton'
import {
  useLocationHours,
  useMemberHandle,
  useOrganizationFollowerCount,
  useOrganizationLocations,
  useOrganizationPosts,
  useOrganizationReputation,
  useOrganizationReviews,
  useOrganizationServices,
  useOrganizationTeam,
  usePublicOrganization,
  useShopServiceState,
  type TeamMember,
} from '@/features/organization-profile/api/organizationProfile'
import { color, radius, shadow, spacing } from '@/shared/theme/tokens'

/**
 * /shop/[slug] — le profil salon public au modèle X (F2 transposée) :
 * imagerie du lieu → identité → note SEULEMENT si réelle → adresse et état
 * d'ouverture (fuseau du LIEU) → métriques → CTA Réserver + Suivre INLINE →
 * services (catégories réelles) → équipe → réalisations → avis → horaires
 * (semaine à 7 jours, « non renseigné » ≠ « fermé »).
 *
 * Le cas solo (indépendant) est le MÊME écran : sa page d'établissement
 * fusionne profil pro et lieu. La file en direct (F1b) arrive avec M1b.
 */
export function OrganizationProfileScreen() {
  const { slug: rawSlug } = useLocalSearchParams<{ slug: string }>()
  const slug = typeof rawSlug === 'string' ? rawSlug : null
  const { t, i18n } = useTranslation('v2')
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const organization = usePublicOrganization(slug)
  const organizationId = organization.data?.id ?? null
  const locations = useOrganizationLocations(slug)
  const location = locations.data?.[0] ?? null
  const locationId = location?.id ?? null

  const services = useOrganizationServices(slug, locationId)
  const team = useOrganizationTeam(slug)
  const hours = useLocationHours(slug, locationId)
  const serviceState = useShopServiceState(slug, locationId)
  const followerCount = useOrganizationFollowerCount(organizationId)
  const reputation = useOrganizationReputation(organizationId)
  const reviews = useOrganizationReviews(organizationId)
  const posts = useOrganizationPosts(slug)

  const cta: ProfileCtaState = useMemo(() => {
    if (organization.isPending || locations.isPending) {
      return { kind: 'loading', queueOpen: false, temporaryUntil: null }
    }
    if (!locationId) return { kind: 'closed', queueOpen: false, temporaryUntil: null }
    return deriveProfileCta(serviceState.data, {
      isError: serviceState.isError,
      isLoading: serviceState.isPending,
    })
  }, [organization.isPending, locations.isPending, locationId, serviceState.data, serviceState.isError, serviceState.isPending])

  /* « Ouvert maintenant » — calculé dans le FUSEAU DU LIEU ; null = aucun
     état affiché, jamais un état inventé. Calcul direct (bon marché). */
  const openNow = hours.data && location?.timezone ? isOpenNow(hours.data, location.timezone) : null

  useEffect(() => {
    const data = organization.data
    if (data && slug) {
      void recordRecentProfile({
        kind: 'shop',
        key: slug,
        name: data.name,
        city: location?.city ?? null,
        avatarUrl: null,
        organizationSlug: slug,
      })
    }
  }, [organization.data, slug, location?.city])

  const [ctaBottom, setCtaBottom] = useState<number | null>(null)
  const [showSticky, setShowSticky] = useState(false)
  const scrollRef = useRef<ScrollView>(null)

  const onBook = () => router.push(`/book/${encodeURIComponent(slug ?? '')}` as never)
  const onQueue = () => router.push(`/q/${encodeURIComponent(slug ?? '')}` as never)

  if (organization.isPending) {
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

  if (organization.isError || !organization.data) {
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

  const data = organization.data
  const isServiceArea = location?.kind === 'service_area'

  /* Services groupés par catégorie réelle. */
  const grouped = new Map<string, typeof services.data>()
  for (const service of services.data ?? []) {
    const key = service.category_name ?? ''
    const bucket = grouped.get(key)
    if (bucket) bucket.push(service)
    else grouped.set(key, [service])
  }

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
        <ProfileHero bannerSrc={demoBanner(slug)} avatarSrc={null} name={data.name} />

        <View style={styles.body}>
          <FuText variant="heading">{data.name}</FuText>

          {/* La note — SEULEMENT si réelle (null = « Pas encore d'avis »). */}
          <RatingLine
            average={reputation.data?.rating_average ?? null}
            count={reputation.data ? reputation.data.rating_count : null}
          />

          {location ? (
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={14} color={color.textSecondary} />
              <FuText variant="sm" tone="secondary" style={styles.locationText}>
                {isServiceArea
                  ? t('profile.location.serviceArea', { city: location.city ?? '' })
                  : [location.address_line1, location.postal_code, location.city]
                      .filter(Boolean)
                      .join(', ')}
              </FuText>
              {openNow !== null ? (
                <Badge
                  variant={openNow ? 'brand' : 'neutral'}
                  label={openNow ? t('states.opening.open') : t('states.opening.closedShort')}
                />
              ) : null}
            </View>
          ) : null}

          {cta.queueOpen ? <Badge variant="brand" label={t('states.queue.open')} /> : null}

          <View accessibilityLabel={t('profile.metrics.label')}>
            <SocialProof
              values={{
                followers: followerCount.data ?? null,
                verifiedClients: null,
                rating: reputation.data?.rating_average ?? null,
                reviews: reputation.data ? reputation.data.rating_count : null,
                likes: null,
              }}
            />
          </View>

          <View
            onLayout={(event) => {
              const { y, height } = event.nativeEvent.layout
              setCtaBottom(y + height)
            }}
          >
            <ProfileCtaPair cta={cta} isManaged onBook={onBook} onQueue={onQueue} />
          </View>

          {/* Services — groupés par catégorie réelle, prix en mono. */}
          <View>
            <FuText variant="title" style={styles.sectionTitle}>
              {t('profile.shop.servicesTitle')}
            </FuText>
            {services.isPending && locationId ? (
              <View style={styles.skeletons} accessibilityElementsHidden>
                <Skeleton width="75%" />
                <Skeleton width="66%" />
              </View>
            ) : grouped.size > 0 ? (
              [...grouped.entries()].map(([category, rows]) => (
                <View key={category || 'uncategorized'} style={styles.categoryBlock}>
                  {category ? (
                    <FuText variant="smMedium" tone="secondary">
                      {category}
                    </FuText>
                  ) : null}
                  {(rows ?? []).map((service, index) => (
                    <View key={service.id} style={[styles.serviceRow, index > 0 && styles.serviceDivider]}>
                      <View style={styles.serviceInfo}>
                        <FuText variant="smMedium" numberOfLines={1}>
                          {service.name}
                        </FuText>
                        <Duration minutes={service.duration_minutes} />
                      </View>
                      <Money cents={service.price_cents} currency={data.currency} />
                    </View>
                  ))}
                </View>
              ))
            ) : (
              <FuText variant="sm" tone="secondary">
                {t('profile.services.emptyDescription')}
              </FuText>
            )}
          </View>

          {/* L'équipe — tous les membres publics ; le lien /pro n'existe que
              pour une identité REVENDIQUÉE (frontière B1, rien d'inventé). */}
          <View>
            <FuText variant="title" style={styles.sectionTitle}>
              {t('profile.shop.teamTitle')}
            </FuText>
            {(team.data ?? []).length > 0 ? (
              <View style={styles.teamGrid}>
                {(team.data ?? []).map((member) => (
                  <TeamMemberCell key={member.barber_id} member={member} />
                ))}
              </View>
            ) : (
              <FuText variant="sm" tone="secondary">
                {t('profile.shop.teamEmptyDescription')}
              </FuText>
            )}
          </View>

          {/* Réalisations du lieu (B4). */}
          <View>
            <FuText variant="title" style={styles.sectionTitle}>
              {t('profile.shop.portfolioTitle')}
            </FuText>
            {posts.isPending ? (
              <View style={styles.skeletons} accessibilityElementsHidden>
                <Skeleton height={110} />
              </View>
            ) : (posts.data ?? []).length > 0 ? (
              <PostGrid media={(posts.data ?? []).flatMap((post) => post.media)} />
            ) : (
              <FuText variant="sm" tone="secondary">
                {t('profile.portfolio.emptyDescription')}
              </FuText>
            )}
          </View>

          {/* Avis. */}
          <View>
            <FuText variant="title" style={styles.sectionTitle}>
              {t('profile.shop.reviewsTitle')}
            </FuText>
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
              <FuText variant="sm" tone="secondary">
                {t('profile.reviews.emptyDescription')}
              </FuText>
            )}
          </View>

          {/* Horaires — semaine TOUJOURS à 7 jours ; un jour absent est
              « non renseigné », jamais « fermé » (leçon F2). */}
          {!isServiceArea ? (
            <View>
              <FuText variant="title" style={styles.sectionTitle}>
                {t('profile.shop.hoursTitle')}
              </FuText>
              {orderedWeek(hours.data ?? []).map(({ day, row }) => {
                const dayLabel = new Intl.DateTimeFormat(i18n.language, {
                  weekday: 'long',
                  timeZone: 'UTC',
                }).format(new Date(Date.UTC(2026, 0, 4 + day)))
                return (
                  <View key={day} style={styles.hoursRow}>
                    <FuText variant="sm" style={styles.hoursDay}>
                      {dayLabel}
                    </FuText>
                    {row === null ? (
                      <FuText variant="sm" tone="tertiary">
                        {t('profile.shop.hoursUnknown')}
                      </FuText>
                    ) : row.is_closed ? (
                      <FuText variant="sm" tone="secondary">
                        {t('profile.shop.hoursClosedDay')}
                      </FuText>
                    ) : (
                      <MonoText size="sm" tone="secondary">
                        {[
                          row.open_time && row.close_time
                            ? `${formatWallTime(row.open_time, i18n.language)}–${formatWallTime(row.close_time, i18n.language)}`
                            : null,
                          row.second_open_time && row.second_close_time
                            ? `${formatWallTime(row.second_open_time, i18n.language)}–${formatWallTime(row.second_close_time, i18n.language)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </MonoText>
                    )}
                  </View>
                )
              })}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {showSticky ? (
        <Animated.View
          entering={FadeIn.duration(120)}
          style={[styles.stickyBar, shadow.sticky, { paddingBottom: insets.bottom + spacing(2) }]}
        >
          <ProfileCtaPair cta={cta} isManaged onBook={onBook} onQueue={onQueue} />
        </Animated.View>
      ) : null}
    </SafeAreaView>
  )
}

/** Un membre d'équipe — avatar, nom, titre ; cliquable si revendiqué. */
function TeamMemberCell({ member }: { member: TeamMember }) {
  const { t } = useTranslation('v2')
  const router = useRouter()
  const handle = useMemberHandle(member.professional_id)

  const content = (
    <>
      <Avatar name={member.display_name} src={resolveMediaSource(member.avatar_url)} size="lg" />
      <FuText variant="smMedium" numberOfLines={1} style={styles.teamName}>
        {member.display_name}
      </FuText>
      {member.title ? (
        <FuText variant="badge" tone="tertiary" numberOfLines={1}>
          {member.title}
        </FuText>
      ) : null}
    </>
  )

  if (member.professional_id && handle.data) {
    return (
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('profile.shop.teamMemberAria', { name: member.display_name })}
        onPress={() => router.push(`/pro/${encodeURIComponent(handle.data ?? '')}` as never)}
        style={styles.teamCell}
      >
        {content}
      </Pressable>
    )
  }
  return <View style={styles.teamCell}>{content}</View>
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas },
  loading: { padding: spacing(4), gap: spacing(3) },
  content: { paddingBottom: spacing(10) },
  body: { paddingHorizontal: spacing(4), paddingTop: spacing(3), gap: spacing(3) },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), flexWrap: 'wrap' },
  locationText: { flexShrink: 1 },
  sectionTitle: { marginBottom: spacing(2) },
  skeletons: { gap: spacing(2) },
  categoryBlock: { marginBottom: spacing(2) },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(3),
    paddingVertical: spacing(2.5),
  },
  serviceDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },
  serviceInfo: { flexShrink: 1, gap: 2 },
  teamGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(3) },
  teamCell: {
    width: 96,
    alignItems: 'center',
    gap: spacing(1),
    paddingVertical: spacing(2),
    borderRadius: radius.card,
  },
  teamName: { textAlign: 'center' },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing(1.5),
  },
  hoursDay: { textTransform: 'capitalize' },
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
