import { Fragment } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'

import { useMyFavorites, useRemoveFavorite, type MyFavorite } from '@/features/account/api/account'
import { Card, DataError, Divider, RowAction, RowsSkeleton, Section } from '@/features/account/parts'
import { resolveMediaSource } from '@/shared/lib/demoMedia'
import { Avatar } from '@/shared/ui/Avatar'
import { EmptyState } from '@/shared/ui/EmptyState'
import { FuText } from '@/shared/ui/Text'
import { spacing, touchTarget } from '@/shared/theme/tokens'

/**
 * Favoris — `get_my_favorites` tel quel. V2 ne crée plus que des favoris
 * SALON ; les favoris barber HISTORIQUES existent encore en base et sont
 * rendus tels qu'ils sont (nom du barber, son portrait), sans réécriture ni
 * migration silencieuse. Un favori sans slug n'est pas cliquable : on ne
 * devine pas une adresse.
 */
function favoriteTitle(favorite: MyFavorite): string {
  return favorite.organization_name ?? favorite.barber_display_name ?? ''
}

export function FavoritesSection({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation('v2')
  const router = useRouter()
  const favorites = useMyFavorites(enabled)
  const remove = useRemoveFavorite()

  const rows = favorites.data ?? []

  return (
    <Section title={t('mobile.account.favoritesSection')}>
      {favorites.isPending ? (
        <RowsSkeleton rows={2} />
      ) : favorites.isError ? (
        <DataError onRetry={() => void favorites.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('mobile.account.favoritesEmpty')}
          actionLabel={t('common.action.search')}
          onAction={() => router.push('/search')}
        />
      ) : (
        <Card>
          {rows.map((favorite, index) => {
            const title = favoriteTitle(favorite)
            const slug = favorite.organization_slug
            const secondary =
              favorite.organization_name && favorite.barber_display_name
                ? favorite.barber_display_name
                : null
            const busy = remove.isPending && remove.variables === favorite.favorite_id

            const content = (
              <>
                <Avatar name={title} src={resolveMediaSource(favorite.barber_avatar_url)} size="md" />
                <View style={styles.rowText}>
                  <FuText variant="bodyMedium" numberOfLines={1}>
                    {title}
                  </FuText>
                  {secondary ? (
                    <FuText variant="sm" tone="secondary" numberOfLines={1}>
                      {secondary}
                    </FuText>
                  ) : null}
                </View>
              </>
            )

            return (
              <Fragment key={favorite.favorite_id}>
                {index > 0 ? <Divider /> : null}
                <View style={styles.row}>
                  {slug ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={title}
                      onPress={() => router.push(`/shop/${encodeURIComponent(slug)}` as never)}
                      style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}
                    >
                      {content}
                    </Pressable>
                  ) : (
                    <View style={styles.rowMain}>{content}</View>
                  )}
                  <RowAction
                    label={t('mobile.account.removeFavorite')}
                    busy={busy}
                    onPress={() => remove.mutate(favorite.favorite_id)}
                  />
                </View>
              </Fragment>
            )
          })}
        </Card>
      )}

      {remove.isError ? (
        <FuText variant="sm" tone="danger" accessibilityRole="alert">
          {t('errors.data.unknown')}
        </FuText>
      ) : null}
    </Section>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget + 12 },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    minHeight: touchTarget,
    paddingVertical: spacing(1),
  },
  rowPressed: { opacity: 0.6 },
  rowText: { flex: 1, gap: spacing(0.5) },
})
