import { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useCustomerProfile, useSaveDisplayName } from '@/features/account/api/account'
import { Card, DataError, Section } from '@/features/account/parts'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/Button'
import { Skeleton } from '@/shared/ui/Skeleton'
import { FuText } from '@/shared/ui/Text'
import { color, radius, spacing, touchTarget } from '@/shared/theme/tokens'

/**
 * Profil : portrait (monogramme — aucun envoi de photo n'existe côté
 * client), prénom éditable, e-mail de la session.
 *
 * `customer_profiles` peut n'avoir AUCUNE ligne pour ce compte : c'est un
 * état légitime, pas une erreur — le champ est simplement vide et le
 * premier enregistrement crée la ligne (`upsert`).
 */
export function ProfileSection({ userId, email }: { userId: string; email: string | null }) {
  const { t } = useTranslation('v2')
  const profile = useCustomerProfile(userId)
  const save = useSaveDisplayName(userId)

  /** `null` = le champ n'a pas été touché : il suit la base. */
  const [draft, setDraft] = useState<string | null>(null)

  const stored = profile.data?.display_name ?? ''
  const value = draft ?? stored
  const trimmed = value.trim()
  const dirty = trimmed !== stored.trim()
  const canSave = trimmed.length > 0 && dirty && !save.isPending

  return (
    <Section title={t('mobile.account.profileSection')}>
      <Card style={styles.card}>
        <View style={styles.identity}>
          <Avatar name={stored || email || ''} size="lg" />
          <View style={styles.identityText}>
            {profile.isPending ? (
              <Skeleton width="60%" height={20} />
            ) : stored.length > 0 ? (
              <FuText variant="title" numberOfLines={1}>
                {stored}
              </FuText>
            ) : null}
            {email ? (
              <FuText variant="sm" tone="secondary" numberOfLines={1}>
                {t('mobile.account.emailRow', { email })}
              </FuText>
            ) : null}
          </View>
        </View>

        <View style={styles.field}>
          <FuText variant="smMedium" tone="secondary">
            {t('mobile.account.nameLabel')}
          </FuText>
          {profile.isPending ? (
            <Skeleton height={touchTarget + 8} />
          ) : (
            <TextInput
              value={value}
              onChangeText={setDraft}
              placeholder={t('mobile.account.namePlaceholder')}
              placeholderTextColor={color.textTertiary}
              autoCapitalize="words"
              autoComplete="given-name"
              returnKeyType="done"
              maxLength={80}
              editable={!save.isPending}
              onSubmitEditing={() => {
                if (canSave) save.mutate(trimmed)
              }}
              accessibilityLabel={t('mobile.account.nameLabel')}
              style={styles.input}
            />
          )}
          <View style={styles.saveRow}>
            <Button
              label={t('mobile.account.nameSave')}
              variant="secondary"
              disabled={!canSave}
              loading={save.isPending}
              onPress={() => save.mutate(trimmed)}
            />
            {save.isSuccess && !dirty ? (
              <FuText variant="smMedium" tone="accent" accessibilityLiveRegion="polite">
                {t('mobile.account.nameSaved')}
              </FuText>
            ) : null}
          </View>
          {save.isError ? (
            <FuText variant="sm" tone="danger" accessibilityRole="alert">
              {t('errors.data.unknown')}
            </FuText>
          ) : null}
        </View>
      </Card>

      {profile.isError ? <DataError onRetry={() => void profile.refetch()} /> : null}
    </Section>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing(4), paddingVertical: spacing(4) },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing(3) },
  identityText: { flex: 1, gap: spacing(1) },
  field: { gap: spacing(2) },
  input: {
    minHeight: touchTarget + 8,
    paddingHorizontal: spacing(4),
    borderRadius: radius.control,
    backgroundColor: color.surfaceSubtle,
    borderWidth: 1,
    borderColor: color.border,
    fontSize: 16,
    color: color.textPrimary,
  },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(3) },
})
