/**
 * M1b — LA carte de post du feed. Première composition du module social :
 * aucun précédent web (D1 §12.3 laisse le viewer de post ouvert — cette
 * composition est remontée au rapport M1b).
 *
 * Anatomie, de haut en bas :
 *   auteur (avatar, nom, attribution « chez X », source) → média plein
 *   cadre (carrousel paginé, points de position) → rangée d'actions (like
 *   public + CTA réservation si un service actif est lié) → légende → likes.
 *
 * Lois : média manquant = état de première classe (monogramme, jamais un
 *   carré gris) ; AUCUN commentaire, AUCUN hashtag, aucune publication
 *   client ; le CTA réservation n'existe que si le chemin est réel
 *   (`bookTargetForPost`) — la seule justification du module.
 */
import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useTranslation } from 'react-i18next'
import { VideoView, useVideoPlayer } from 'expo-video'

import { useSignedPostMedia, type PostMedia } from '@/shared/data/postMedia'
import { color, radius, spacing, touchTarget } from '@/shared/theme/tokens'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/Button'
import { FuText } from '@/shared/ui/Text'
import {
  bookTargetForPost,
  feedAttribution,
  feedAuthorAvatar,
  feedAuthorName,
  feedAuthorRoute,
  parseFeedMedia,
  parseFeedServices,
  type FeedRow,
} from '../lib/feedPage'

const SOURCE_KEY: Record<string, string> = {
  followed_professional: 'mobile.feed.sourceFollowedPro',
  followed_organization: 'mobile.feed.sourceFollowedOrg',
  discovery: 'mobile.feed.sourceDiscovery',
}

function FeedVideo({ url }: { url: string }) {
  const { t } = useTranslation('v2')
  const player = useVideoPlayer(url, (p) => {
    p.loop = true
    p.muted = true
  })
  const [playing, setPlaying] = useState(false)
  return (
    <Pressable
      style={styles.fill}
      accessibilityRole="button"
      accessibilityLabel={t('mobile.feed.videoBadge')}
      onPress={() => {
        if (playing) {
          player.pause()
        } else {
          player.play()
        }
        setPlaying(!playing)
      }}
    >
      <VideoView player={player} style={styles.fill} contentFit="cover" nativeControls={false} />
      {!playing ? (
        <View style={styles.playOverlay}>
          <Ionicons name="play" size={40} color={color.moment.textPrimary} />
        </View>
      ) : null}
    </Pressable>
  )
}

export interface PostCardProps {
  row: FeedRow
  onOpenProfile: (route: string) => void
  onBook: (target: { slug: string; serviceId: string }) => void
  /** liked/like_count affichés viennent du cache (optimisme social). */
  onToggleLike: (postId: string, liked: boolean) => void
}

export function PostCard({ row, onOpenProfile, onBook, onToggleLike }: PostCardProps) {
  const { t } = useTranslation('v2')
  const { width } = useWindowDimensions()
  const mediaWidth = Math.min(width, 560) - spacing(8)
  const mediaHeight = Math.round(mediaWidth * 1.15)

  const media = useMemo(() => parseFeedMedia(row.media), [row.media])
  const services = useMemo(() => parseFeedServices(row.services), [row.services])
  const paths = useMemo(() => media.map((m) => m.storage_path), [media])
  const signed = useSignedPostMedia(paths)
  const [page, setPage] = useState(0)

  const authorName = feedAuthorName(row)
  const authorRoute = feedAuthorRoute(row)
  const attribution = feedAttribution(row)
  const bookTarget = bookTargetForPost(row, services)
  const sourceKey = SOURCE_KEY[row.feed_source ?? 'discovery']

  const renderMedia = (item: PostMedia, index: number) => {
    const url = signed.data?.[item.storage_path]
    return (
      <View key={item.id} style={{ width: mediaWidth, height: mediaHeight }}>
        {url ? (
          item.media_type === 'video' ? (
            <FeedVideo url={url} />
          ) : (
            <Image
              source={{ uri: url }}
              style={styles.fill}
              resizeMode="cover"
              accessibilityLabel={t('mobile.feed.mediaOf', { index: index + 1, count: media.length })}
            />
          )
        ) : (
          // Média manquant ou signature en cours : état de première classe,
          // jamais une fausse image.
          <View style={styles.missing}>
            <FuText style={styles.watermark} accessibilityElementsHidden>
              F
            </FuText>
            {!signed.isPending ? (
              <FuText variant="badge" tone="tertiary">
                {t('states.media.missing')}
              </FuText>
            ) : null}
          </View>
        )}
        {item.media_type === 'video' ? (
          <View style={styles.videoBadge}>
            <Ionicons name="videocam" size={12} color={color.moment.textPrimary} />
            <FuText variant="badge" style={{ color: color.moment.textPrimary }}>
              {t('mobile.feed.videoBadge')}
            </FuText>
          </View>
        ) : null}
      </View>
    )
  }

  return (
    <View style={styles.card}>
      {/* Auteur */}
      <Pressable
        style={styles.authorRow}
        accessibilityRole="button"
        accessibilityLabel={t('mobile.feed.openPost', { name: authorName ?? '' })}
        disabled={!authorRoute}
        onPress={() => authorRoute && onOpenProfile(authorRoute)}
      >
        <Avatar name={authorName ?? '?'} src={feedAuthorAvatar(row) ?? undefined} size="sm" />
        <View style={styles.authorText}>
          <FuText variant="bodyMedium" numberOfLines={1}>
            {authorName ?? ''}
          </FuText>
          {attribution.name ? (
            <FuText variant="badge" tone="secondary" numberOfLines={1}>
              {t('mobile.feed.postedAt', { name: attribution.name })}
            </FuText>
          ) : null}
        </View>
        {sourceKey ? (
          <FuText variant="badge" tone="tertiary">
            {t(sourceKey)}
          </FuText>
        ) : null}
      </Pressable>

      {/* Média */}
      {media.length > 0 ? (
        <View style={[styles.mediaFrame, { height: mediaHeight }]}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / mediaWidth))}
          >
            {media.map(renderMedia)}
          </ScrollView>
          {media.length > 1 ? (
            <View style={styles.dots} accessibilityLabel={t('mobile.feed.mediaOf', { index: page + 1, count: media.length })}>
              {media.map((m, i) => (
                <View key={m.id} style={[styles.dot, i === page && styles.dotActive]} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Actions : like public + LE chemin vers la réservation */}
      <View style={styles.actionsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(row.liked_by_me ? 'mobile.feed.unlikeAria' : 'mobile.feed.likeAria')}
          accessibilityState={{ selected: row.liked_by_me === true }}
          hitSlop={8}
          style={styles.likeButton}
          onPress={() => onToggleLike(row.post_id, !(row.liked_by_me === true))}
        >
          <Ionicons
            name={row.liked_by_me ? 'heart' : 'heart-outline'}
            size={26}
            color={row.liked_by_me ? color.accentText : color.textPrimary}
          />
          {(row.like_count ?? 0) > 0 ? (
            <FuText variant="smMedium" tone={row.liked_by_me ? 'accent' : 'secondary'}>
              {t('mobile.feed.likes', { count: row.like_count ?? 0 })}
            </FuText>
          ) : null}
        </Pressable>
        {bookTarget ? (
          <Button label={t('mobile.feed.bookCta')} size="md" onPress={() => onBook(bookTarget)} />
        ) : null}
      </View>

      {/* Légende — pas de commentaire, pas de hashtag : le texte est celui du pro. */}
      {row.caption ? (
        <FuText variant="sm" style={styles.caption}>
          {row.caption}
        </FuText>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
    overflow: 'hidden',
    marginHorizontal: spacing(4),
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3),
    minHeight: touchTarget,
  },
  authorText: { flex: 1, gap: 1 },
  mediaFrame: {
    backgroundColor: color.surfaceSubtle,
  },
  fill: { width: '100%', height: '100%' },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(2),
    backgroundColor: color.surfaceSubtle,
  },
  watermark: {
    fontSize: 96,
    lineHeight: 104,
    color: color.brandWatermark,
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(7, 19, 16, 0.25)',
  },
  videoBadge: {
    position: 'absolute',
    top: spacing(3),
    right: spacing(3),
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1),
    backgroundColor: 'rgba(7, 19, 16, 0.55)',
    borderRadius: radius.control,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
  },
  dots: {
    position: 'absolute',
    bottom: spacing(3),
    alignSelf: 'center',
    flexDirection: 'row',
    gap: spacing(1.5),
    backgroundColor: 'rgba(7, 19, 16, 0.35)',
    borderRadius: radius.control,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(246, 248, 247, 0.55)',
  },
  dotActive: {
    backgroundColor: color.accent,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing(4),
    paddingTop: spacing(3),
    gap: spacing(3),
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    minHeight: touchTarget,
  },
  caption: {
    paddingHorizontal: spacing(4),
    paddingBottom: spacing(4),
    paddingTop: spacing(1),
  },
})
