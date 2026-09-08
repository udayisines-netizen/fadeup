import { useMemo } from 'react'
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native'
import { useTranslation } from 'react-i18next'
import { FuText } from '@/shared/ui/Text'
import { MonoText } from '@/shared/ui/MonoText'
import { Avatar } from '@/shared/ui/Avatar'
import { BannerImage } from '@/shared/ui/BannerImage'
import { Button } from '@/shared/ui/Button'
import { Skeleton } from '@/shared/ui/Skeleton'
import { useSignedPostMedia } from '@/shared/data/postMedia'
import type { PostMedia } from '@/shared/data/postMedia'
import type { ProfileCtaState } from '@/shared/lib/serviceState'
import { formatDateTime, deviceTimezone } from '@/shared/lib/format'
import { color, radius, spacing } from '@/shared/theme/tokens'
import { Ionicons } from '@expo/vector-icons'

/**
 * Les pièces du modèle X (D1 §6) partagées par les DEUX profils publics —
 * qui ne peuvent pas s'importer l'un l'autre : elles vivent donc ici,
 * comme la feuille (règle d'architecture P1/M1a).
 */

/** Bannière pleine largeur + portrait rond en surimpression décalé à gauche. */
export function ProfileHero({
  bannerSrc,
  avatarSrc,
  name,
}: {
  bannerSrc: ImageSourcePropType | null
  avatarSrc: ImageSourcePropType | null
  name: string
}) {
  return (
    <View>
      <BannerImage src={bannerSrc} name={name} height={168} watermarkSize={176} />
      <View style={heroStyles.portraitRow}>
        <Avatar name={name} src={avatarSrc} size="xl" ringColor={color.canvas} />
      </View>
    </View>
  )
}

const heroStyles = StyleSheet.create({
  portraitRow: { paddingHorizontal: spacing(4), marginTop: -40, flexDirection: 'row' },
})

/**
 * LA paire de CTA du modèle X : Réserver (dominant, encre sur vert, l'état
 * RÉEL) + Suivre (secondaire, jamais vert plein). Le CTA dit l'état
 * (`deriveProfileCta`) — indisponible : désactivé + note, le profil reste
 * entier.
 *
 * M1b : le follow est RÉEL. Ce composant reste de PRÉSENTATION — l'écran
 * appelant porte la mutation et la feuille d'auth (auth à l'action, le
 * parcours reprend sur place). `follow` absent = bouton masqué (profil non
 * revendiqué : `follow_professional` refuse les identités non revendiquées,
 * un bouton qui échouerait toujours serait un mensonge).
 */
export interface ProfileFollowProps {
  following: boolean
  busy?: boolean
  name: string
  onPress: () => void
}

export function ProfileCtaPair({
  cta,
  isManaged,
  onBook,
  onQueue,
  follow,
  onInterest,
}: {
  cta: ProfileCtaState
  /** false = profil non revendiqué : la note dit pourquoi, sans alerte. */
  isManaged: boolean
  onBook: () => void
  onQueue: () => void
  follow?: ProfileFollowProps
  /**
   * F4/M1b — le cul-de-sac du non revendiqué est levé : posé UNIQUEMENT une
   * fois la résolution terminée, le geste RÉEL devient la demande d'intérêt.
   */
  onInterest?: () => void
}) {
  const { t, i18n } = useTranslation('v2')

  const note = useMemo(() => {
    if (cta.kind === 'unknown') return t('profile.cta.unknownNote')
    if (cta.kind === 'closed') {
      return isManaged ? t('profile.cta.closedNote') : t('profile.unclaimed.bookingUnavailable')
    }
    return null
  }, [cta.kind, isManaged, t])

  return (
    <View style={ctaStyles.block}>
      <View style={ctaStyles.row}>
        <View style={ctaStyles.dominant}>
          {cta.kind === 'bookable' ? (
            <Button label={t('common.action.book')} size="lg" fullWidth onPress={onBook} />
          ) : onInterest && cta.kind !== 'loading' ? (
            <Button label={t('profile.cta.requestSlot')} size="lg" fullWidth onPress={onInterest} />
          ) : cta.kind === 'queue-only' ? (
            <Button label={t('profile.cta.joinQueue')} size="lg" fullWidth onPress={onQueue} />
          ) : (
            <Button
              label={t('common.action.book')}
              size="lg"
              fullWidth
              disabled
              loading={cta.kind === 'loading'}
            />
          )}
        </View>
        {follow ? (
          <Button
            label={follow.following ? t('profile.cta.following') : t('common.action.follow')}
            variant="secondary"
            size="lg"
            loading={follow.busy}
            accessibilityLabel={t(follow.following ? 'profile.cta.unfollowAria' : 'profile.cta.followAria', {
              name: follow.name,
            })}
            accessibilityState={{ selected: follow.following }}
            onPress={follow.onPress}
          />
        ) : null}
      </View>
      {note ? (
        <FuText variant="sm" tone="secondary">
          {note}
        </FuText>
      ) : null}
      {cta.temporaryUntil ? (
        <FuText variant="sm" tone="secondary">
          {t('profile.cta.temporaryUntilPrefix')}{' '}
          {formatDateTime(cta.temporaryUntil, deviceTimezone(), 'time', i18n.language)}
        </FuText>
      ) : null}
    </View>
  )
}

const ctaStyles = StyleSheet.create({
  block: { gap: spacing(2) },
  row: { flexDirection: 'row', gap: spacing(2.5), alignItems: 'center' },
  dominant: { flex: 1 },
})

/**
 * Grille de réalisations (B4) — médias signés depuis le bucket privé ; un
 * chemin qui ne signe pas rend l'état « média manquant » de première classe.
 * Vignettes NON cliquables : le viewer de post est un lot ultérieur (P4) —
 * une vignette vers rien serait un cul-de-sac.
 */
export function PostGrid({ media }: { media: PostMedia[] }) {
  const { t } = useTranslation('v2')
  const paths = useMemo(
    () => media.filter((m) => m.media_type.startsWith('image')).map((m) => m.storage_path),
    [media],
  )
  const signed = useSignedPostMedia(paths)

  if (paths.length === 0) return null

  return (
    <View style={gridStyles.grid}>
      {paths.map((path) => {
        const url = signed.data?.[path]
        return (
          <View key={path} style={gridStyles.cell}>
            {signed.isPending ? (
              <Skeleton height={110} style={gridStyles.fill} />
            ) : url ? (
              <Image source={{ uri: url }} style={gridStyles.fill} resizeMode="cover" />
            ) : (
              <View style={gridStyles.missing}>
                <Ionicons name="image-outline" size={20} color={color.textTertiary} />
                <FuText variant="badge" tone="tertiary">
                  {t('states.media.missing')}
                </FuText>
              </View>
            )}
          </View>
        )
      })}
    </View>
  )
}

const gridStyles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(1.5) },
  cell: {
    width: '31.5%',
    aspectRatio: 1,
    borderRadius: radius.media,
    overflow: 'hidden',
    backgroundColor: color.surfaceSubtle,
  },
  fill: { width: '100%', height: '100%' },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
})

/** Note agrégée — `null` n'est JAMAIS zéro étoile : « Pas encore d'avis ». */
export function RatingLine({
  average,
  count,
}: {
  average: number | null
  count: number | null
}) {
  const { t, i18n } = useTranslation('v2')
  if (average === null) {
    return (
      <FuText variant="sm" tone="secondary">
        {t('states.rating.none')}
      </FuText>
    )
  }
  const value = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(average)
  return (
    <View style={ratingStyles.row} accessibilityLabel={t('states.rating.valueLabel', { value })}>
      <Ionicons name="star" size={14} color={color.accentText} />
      <MonoText size="sm" weight="medium">
        {value}
      </MonoText>
      {count !== null ? (
        <FuText variant="sm" tone="secondary">
          {t('states.rating.countLabel', { count })}
        </FuText>
      ) : null}
    </View>
  )
}

const ratingStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
})

/** Une rangée d'avis public — la primitive de liste dense (Row) demeure. */
export function ReviewRow({
  rating,
  comment,
  reviewerName,
  createdAt,
  replyBody,
}: {
  rating: number
  comment: string | null
  reviewerName: string | null
  createdAt: string
  replyBody: string | null
}) {
  const { t, i18n } = useTranslation('v2')
  return (
    <View style={reviewStyles.row}>
      <View style={reviewStyles.head}>
        <View style={reviewStyles.stars} accessibilityLabel={t('states.rating.valueLabel', { value: rating })}>
          {Array.from({ length: 5 }, (_, index) => (
            <Ionicons
              key={index}
              name={index < rating ? 'star' : 'star-outline'}
              size={12}
              color={index < rating ? color.accentText : color.textTertiary}
            />
          ))}
        </View>
        <FuText variant="sm" tone="tertiary">
          {formatDateTime(createdAt, deviceTimezone(), 'date', i18n.language)}
        </FuText>
      </View>
      {reviewerName ? <FuText variant="smMedium">{reviewerName}</FuText> : null}
      {comment ? (
        <FuText variant="sm" tone="secondary">
          {comment}
        </FuText>
      ) : null}
      {replyBody ? (
        <View style={reviewStyles.reply}>
          <FuText variant="sm" tone="secondary">
            {replyBody}
          </FuText>
        </View>
      ) : null}
    </View>
  )
}

const reviewStyles = StyleSheet.create({
  row: { gap: spacing(1), paddingVertical: spacing(3), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stars: { flexDirection: 'row', gap: 2 },
  reply: {
    marginTop: spacing(1),
    padding: spacing(2.5),
    borderRadius: radius.control,
    backgroundColor: color.surfaceSubtle,
  },
})
