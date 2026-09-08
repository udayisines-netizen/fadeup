/**
 * M1b — data du feed (première interface du backend social B4).
 *
 * Décisions de contrat (migration `b4_social_read_rpcs`) :
 *  - `get_feed` est accessible ANONYME (découverte publique seule,
 *    `liked_by_me` toujours false) — le feed se consulte sans compte ;
 *  - pagination au curseur temporel : min(created_at) de la page
 *    (`nextFeedCursor`), jamais d'offset ;
 *  - AUCUN realtime sur les tables sociales (décision B4 §8) : pull-to-
 *    refresh + invalidation, pas de canal ;
 *  - la géolocalisation n'est PAS envoyée : elle ne se demande qu'au geste
 *    (loi M1a), et le feed n'a pas de geste « autour de moi » — le signal
 *    de proximité reste à zéro, assumé.
 *
 * Likes : `like_post` idempotent (42501 sans session), `unlike_post` sans
 * erreur. `like_count` n'est jamais retourné par ces RPC → optimisme LOCAL
 * (le seul autorisé : « optimisme réservé au social », D1 §0bis), corrigé
 * par invalidation au succès comme à l'échec.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { getSupabase } from '@/shared/lib/supabase'
import { FEED_PAGE_SIZE, nextFeedCursor, type FeedRow } from '../lib/feedPage'

export const feedKeys = {
  all: ['feed'] as const,
  list: () => ['feed', 'list'] as const,
}

export function useFeed() {
  return useInfiniteQuery({
    queryKey: feedKeys.list(),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<FeedRow[]> => {
      const { data, error } = await getSupabase().rpc('get_feed', {
        p_cursor: pageParam ?? undefined,
        p_limit: FEED_PAGE_SIZE,
      })
      if (error) throw error
      return (data ?? []) as FeedRow[]
    },
    getNextPageParam: (lastPage) => nextFeedCursor(lastPage),
    staleTime: 60_000,
  })
}

/** Bascule optimiste d'un like dans le cache du feed (pages infinies). */
function patchFeedLike(pages: { pages: FeedRow[][]; pageParams: unknown[] } | undefined, postId: string, liked: boolean) {
  if (!pages) return pages
  return {
    ...pages,
    pages: pages.pages.map((page) =>
      page.map((row) =>
        row.post_id === postId
          ? {
              ...row,
              liked_by_me: liked,
              like_count: Math.max(0, (row.like_count ?? 0) + (liked === row.liked_by_me ? 0 : liked ? 1 : -1)),
            }
          : row,
      ),
    ),
  }
}

export function useToggleLike() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ postId, liked }: { postId: string; liked: boolean }) => {
      const supabase = getSupabase()
      const { error } = liked
        ? await supabase.rpc('like_post', { p_post_id: postId })
        : await supabase.rpc('unlike_post', { p_post_id: postId })
      if (error) throw error
    },
    onMutate: async ({ postId, liked }) => {
      await queryClient.cancelQueries({ queryKey: feedKeys.list() })
      const previous = queryClient.getQueryData<{ pages: FeedRow[][]; pageParams: unknown[] }>(feedKeys.list())
      queryClient.setQueryData(feedKeys.list(), (old: { pages: FeedRow[][]; pageParams: unknown[] } | undefined) =>
        patchFeedLike(old, postId, liked),
      )
      return { previous }
    },
    onError: (_error, _vars, context) => {
      // L'optimisme se répare : on restaure l'état vrai.
      if (context?.previous) queryClient.setQueryData(feedKeys.list(), context.previous)
    },
  })
}
