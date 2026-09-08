import { Fragment, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'

import {
  useMyFollowedOrganizations,
  useMyFollowedProfessionals,
  useUnfollowProfessional,
  type FollowedProfessional,
} from '@/features/account/api/account'
import { Card, DataError, Divider, RowAction, RowsSkeleton, Section } from '@/features/account/parts'
import { resolveMediaSource } from '@/shared/lib/demoMedia'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Sheet } from '@/shared/ui/Sheet'
import { Skeleton } from '@/shared/ui/Skeleton'
import { FuText } from '@/shared/ui/Text'
import { spacing, touchTarget } from '@/shared/theme/tokens'

/**
 * Abonnements — deux contrats INÉGAUX, rendus tels qu'ils sont :
 *
 *  - `list_my_followed_professionals` rend une identité complète : la liste
 *    est réelle, cliquable vers /pro/[handle] quand un handle existe ;
 *  - `list_my_followed_organizations` ne rend QUE `organization_id` — pas de
 *    nom, pas de slug. MANQUE DE CONTRAT déclaré : on affiche un COMPTEUR
 *    honnête, jamais une liste d'identifiants ni une résolution N+1 qui
 *    ferait passer une bricole client pour un contrat.
 *
 * Le désabonnement est DURABLE (pierre tombale en base) : il est confirmé
 * avant d'être envoyé, et la feuille dit ce qu'il implique vraiment.
 */
export function FollowsSection({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation('v2')
  const router = useRouter()
  const pros = useMyFollowedProfessionals(enabled)
  const orgs = useMyFollowedOrganizations(enabled)
  const unfollow = useUnfollowProfessional()

  const [confirming, setConfirming] = useState<FollowedProfessional | null>(null)

  const proRows = pros.data ?? []
  const orgCount = orgs.data?.length ?? null
  const bothSettled = !pros.isPending && !orgs.isPending && !pros.isError && !orgs.isError
  const bothEmpty = bothSettled && proRows.length === 0 && orgCount === 0

  return (
    <Section title={t('mobile.account.followsSection')}>
      {pros.isPending ? (
        <RowsSkeleton rows={2} />
      ) : pros.isError ? (
        <DataError onRetry={() => void pros.refetch()} />
      ) : bothEmpty ? (
        <EmptyState
          title={t('mobile.account.followsEmpty')}
          actionLabel={t('common.action.search')}
          onAction={() => router.push('/search')}
        />
      ) : proRows.length > 0 ? (
        <View style={styles.block}>
          <FuText variant="smMedium" tone="secondary">
            {t('mobile.account.followsPros')}
          </FuText>
          <Card>
            {proRows.map((pro, index) => {
              const busy = unfollow.isPending && unfollow.variables === pro.id
              const handle = pro.handle
              const content = (
                <>
                  <Avatar name={pro.display_name} src={resolveMediaSource(pro.avatar_url)} size="md" />
                  <View style={styles.rowText}>
                    <FuText variant="bodyMedium" numberOfLines={1}>
                      {pro.display_name}
                    </FuText>
                    {pro.headline ? (
                      <FuText variant="sm" tone="secondary" numberOfLines={1}>
                        {pro.headline}
                      </FuText>
                    ) : null}
                  </View>
                </>
              )

              return (
                <Fragment key={pro.id}>
                  {index > 0 ? <Divider /> : null}
                  <View style={styles.row}>
                    {handle ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={pro.display_name}
                        onPress={() => router.push(`/pro/${encodeURIComponent(handle)}` as never)}
                        style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}
                      >
                        {content}
                      </Pressable>
                    ) : (
                      <View style={styles.rowMain}>{content}</View>
                    )}
                    <RowAction
                      label={t('mobile.account.unfollow')}
                      busy={busy}
                      onPress={() => setConfirming(pro)}
                    />
                  </View>
                </Fragment>
              )
            })}
          </Card>
        </View>
      ) : null}

      {/* Salons suivis — un compteur, rien de plus : le contrat ne rend
          aucun nom. `null` n'est pas 0 : rien ne s'affiche avant la réponse. */}
      {orgs.isPending ? (
        <Skeleton width="45%" height={20} />
      ) : orgs.isError ? (
        <DataError onRetry={() => void orgs.refetch()} />
      ) : orgCount !== null && orgCount > 0 ? (
        <FuText variant="sm" tone="secondary">
          {t('mobile.account.followsOrgs', { count: orgCount })}
        </FuText>
      ) : null}

      {unfollow.isError ? (
        <FuText variant="sm" tone="danger" accessibilityRole="alert">
          {t('errors.data.unknown')}
        </FuText>
      ) : null}

      <Sheet
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={t('mobile.account.unfollow')}
      >
        <View style={styles.sheet}>
          <FuText variant="title">{confirming?.display_name ?? ''}</FuText>
          <FuText variant="sm" tone="secondary">
            {t('mobile.account.unfollowBody')}
          </FuText>
          <Button
            label={t('mobile.account.unfollow')}
            variant="secondary"
            size="lg"
            fullWidth
            onPress={() => {
              const target = confirming
              setConfirming(null)
              if (target) unfollow.mutate(target.id)
            }}
          />
          <Button
            label={t('common.action.cancel')}
            variant="ghost"
            fullWidth
            onPress={() => setConfirming(null)}
          />
        </View>
      </Sheet>
    </Section>
  )
}

const styles = StyleSheet.create({
  block: { gap: spacing(2) },
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
  sheet: { gap: spacing(3), paddingBottom: spacing(2) },
})
