import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import {
  useCustomerProfile,
  useSaveRecommendationPreferences,
  type CustomerGender,
  type HaircutFrequency,
} from '@/features/account/api/account'
import { Section } from '@/features/account/parts'
import { GENDER_ANSWERS, HAIRCUT_FREQUENCIES } from '@/features/onboarding/storage'
import { Button } from '@/shared/ui/Button'
import { OptionRow } from '@/shared/ui/OptionRow'
import { Skeleton } from '@/shared/ui/Skeleton'
import { FuText } from '@/shared/ui/Text'
import { spacing } from '@/shared/theme/tokens'

/**
 * Les deux réponses de l'onboarding, enfin modifiables (B5).
 *
 * M1a les posait à l'inscription et n'offrait plus jamais d'y revenir : la
 * fréquence partait bien en base (profileSync), le genre restait sur
 * l'appareil faute de colonne. B5 ouvre la colonne ET cet écran — une
 * préférence qu'on ne peut pas corriger n'est pas une préférence.
 *
 * Trois propriétés que cette section doit rendre littéralement vraies :
 *
 *  - LA FINALITÉ EST DITE, ici, à l'endroit où la donnée se modifie, et pas
 *    seulement dans un COMMENT de migration : ces réponses orientent la
 *    découverte vers barbershop ou salon mixte, rien d'autre.
 *  - EFFAÇABLE : « Ne pas répondre » n'est pas une valeur de l'enum, c'est
 *    NULL. Le bouton envoie donc explicitement `null`, ce qui EFFACE. C'est
 *    différent de « peu importe » (no_preference), qui est une RÉPONSE — les
 *    deux existent et l'écran ne les confond pas.
 *  - JAMAIS PUBLIQUE : aucune surface ne les affiche, et la suite anonyme le
 *    revérifie. On ne le promet pas à l'écran, on le tient en base.
 *
 * Les listes de valeurs viennent du module d'onboarding, pas d'une copie :
 * une dérive entre l'onboarding et le compte casserait la compilation.
 */
export function PreferencesSection({ userId }: { userId: string }) {
  const { t } = useTranslation('v2')
  const profile = useCustomerProfile(userId)
  const save = useSaveRecommendationPreferences(userId)

  /* Aucun effet de synchronisation, aucune copie du serveur dans un état
     local au montage : `draft` n'existe QUE si l'utilisateur a touché
     quelque chose, et l'affichage retombe sinon sur la valeur du serveur.
     Une invalidation de cache (reprise de focus) ne peut donc pas écraser un
     choix en cours, et un enregistrement réussi remet `draft` à null — la
     réponse fraîche du serveur reprend la main d'elle-même. */
  const [draft, setDraft] = useState<{
    gender: CustomerGender | null
    frequency: HaircutFrequency | null
  } | null>(null)

  const saved = profile.data
  const savedGender = saved?.gender ?? null
  const savedFrequency = saved?.haircut_frequency ?? null
  const gender = draft ? draft.gender : savedGender
  const frequency = draft ? draft.frequency : savedFrequency

  const dirty = draft !== null && (gender !== savedGender || frequency !== savedFrequency)
  const answered = gender !== null || frequency !== null

  const edit = (next: { gender?: CustomerGender | null; frequency?: HaircutFrequency | null }) => {
    setDraft({ gender, frequency, ...next })
  }
  const commit = (next: {
    gender: CustomerGender | null
    haircutFrequency: HaircutFrequency | null
  }) => {
    save.mutate(next, { onSuccess: () => setDraft(null) })
  }

  if (profile.isPending) {
    return (
      <Section title={t('mobile.account.prefsSection')}>
        <Skeleton height={120} />
      </Section>
    )
  }

  return (
    <Section title={t('mobile.account.prefsSection')}>
      <FuText variant="sm" tone="secondary">
        {t('mobile.account.prefsPurpose')}
      </FuText>

      <View style={styles.group}>
        <FuText variant="smMedium" tone="secondary">
          {t('mobile.onboarding.gender.title')}
        </FuText>
        {GENDER_ANSWERS.map((value) => (
          <OptionRow
            key={value}
            label={t(`mobile.account.prefsGender.${value}`)}
            selected={gender === value}
            onPress={() => edit({ gender: gender === value ? null : value })}
          />
        ))}
      </View>

      <View style={styles.group}>
        <FuText variant="smMedium" tone="secondary">
          {t('mobile.onboarding.frequency.title')}
        </FuText>
        {HAIRCUT_FREQUENCIES.map((value) => (
          <OptionRow
            key={value}
            label={t(`mobile.onboarding.frequency.${value}`)}
            selected={frequency === value}
            onPress={() => edit({ frequency: frequency === value ? null : value })}
          />
        ))}
      </View>

      <Button
        label={t('common.action.save')}
        size="lg"
        fullWidth
        disabled={!dirty}
        loading={save.isPending}
        onPress={() => commit({ gender, haircutFrequency: frequency })}
      />

      {/* Effacer ≠ « peu importe ». Le bouton n'apparaît que s'il y a
          quelque chose à effacer, et il envoie NULL sur les deux colonnes. */}
      {answered ? (
        <Button
          label={t('mobile.account.prefsClear')}
          variant="ghost"
          fullWidth
          onPress={() => commit({ gender: null, haircutFrequency: null })}
        />
      ) : null}

      {save.isError ? (
        <FuText variant="sm" tone="danger" accessibilityRole="alert">
          {t('errors.data.unknown')}
        </FuText>
      ) : null}
    </Section>
  )
}

const styles = StyleSheet.create({
  group: { gap: spacing(2) },
})
