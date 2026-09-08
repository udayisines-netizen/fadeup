/**
 * M1b — l'écran Feed : abonnements et découverte locale entremêlés par le
 * backend (dédupliqués structurellement), pagination au curseur temporel.
 *
 * Non connecté : consultable librement ; l'interaction (like) ouvre la
 * feuille d'auth légère et REJOUE l'intention à la session posée — le
 * parcours reprend où il était, sans navigation.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useSession } from '@/shared/data/auth'
import { color, spacing } from '@/shared/theme/tokens'
import { AuthSheet } from '@/shared/ui/AuthSheet'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Skeleton } from '@/shared/ui/Skeleton'
import { FuText } from '@/shared/ui/Text'
import { useFeed, useToggleLike } from './api/feed'
import { PostCard } from './components/PostCard'
import { dedupeFeedPages, type FeedRow } from './lib/feedPage'

export function FeedScreen() {
  const { t } = useTranslation('v2')
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { session } = useSession()
  const feed = useFeed()
  const toggleLike = useToggleLike()

  const [authOpen, setAuthOpen] = useState(false)
  /** L'intention (postId à aimer) mise de côté le temps de la connexion. */
  const pendingLike = useRef<string | null>(null)

  const rows = useMemo(() => dedupeFeedPages(feed.data?.pages ?? []), [feed.data])

  const doLike = useCallback(
    (postId: string, liked: boolean) => {
      if (!session) {
        pendingLike.current = liked ? postId : null
        setAuthOpen(true)
        return
      }
      toggleLike.mutate({ postId, liked })
    },
    [session, toggleLike],
  )

  const onAuthed = useCallback(() => {
    // `liked_by_me` du cache anonyme est toujours false — on rejoue le like
    // demandé, puis on invalide pour refléter la vérité de la session.
    const postId = pendingLike.current
    pendingLike.current = null
    if (postId) toggleLike.mutate({ postId, liked: true })
    void feed.refetch()
  }, [toggleLike, feed])

  const renderItem = useCallback(
    ({ item }: { item: FeedRow }) => (
      <PostCard
        row={item}
        onOpenProfile={(route) => router.push(route as never)}
        onBook={({ slug, serviceId }) => router.push({ pathname: '/book/[slug]', params: { slug, s: serviceId } })}
        onToggleLike={doLike}
      />
    ),
    [router, doLike],
  )

  return (
    <View style={styles.screen}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.post_id}
        renderItem={renderItem}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing(3) }]}
        ItemSeparatorComponent={() => <View style={{ height: spacing(4) }} />}
        ListHeaderComponent={
          <FuText variant="heading" style={styles.title}>
            {t('mobile.feed.title')}
          </FuText>
        }
        ListEmptyComponent={
          feed.isPending ? (
            <View style={styles.skeletons} accessibilityState={{ busy: true }}>
              <Skeleton height={320} />
              <Skeleton height={320} />
            </View>
          ) : (
            <EmptyState
              title={t('mobile.feed.emptyTitle')}
              body={t('mobile.feed.emptyBody')}
              actionLabel={t('mobile.feed.emptyAction')}
              onAction={() => router.push('/search')}
            />
          )
        }
        ListFooterComponent={
          rows.length > 0 ? (
            <View style={styles.footer}>
              {feed.isFetchingNextPage ? (
                <ActivityIndicator color={color.accentText} />
              ) : !feed.hasNextPage ? (
                <FuText variant="sm" tone="tertiary">
                  {t('mobile.feed.endOfFeed')}
                </FuText>
              ) : null}
            </View>
          ) : null
        }
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage()
        }}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching && !feed.isFetchingNextPage}
            onRefresh={() => void feed.refetch()}
            tintColor={color.accentText}
          />
        }
      />
      <AuthSheet
        open={authOpen}
        context="like"
        onClose={() => setAuthOpen(false)}
        onAuthed={onAuthed}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  content: { paddingBottom: spacing(8) },
  title: {
    paddingHorizontal: spacing(4),
    paddingBottom: spacing(4),
  },
  skeletons: {
    gap: spacing(4),
    paddingHorizontal: spacing(4),
  },
  footer: {
    alignItems: 'center',
    paddingVertical: spacing(6),
  },
})
