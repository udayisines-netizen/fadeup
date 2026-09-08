import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'

import { accountQueryKeys } from '@/features/account/api/account'
import { FavoritesSection } from '@/features/account/FavoritesSection'
import { FollowsSection } from '@/features/account/FollowsSection'
import { NotificationsSection } from '@/features/account/NotificationsSection'
import { Card, Section } from '@/features/account/parts'
import { ProfileSection } from '@/features/account/ProfileSection'
import { signOut, useSession } from '@/shared/data/auth'
import { setLocaleOverride, V2_LOCALES, type V2Locale } from '@/shared/i18n'
import { AuthSheet } from '@/shared/ui/AuthSheet'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { OptionRow } from '@/shared/ui/OptionRow'
import { Sheet } from '@/shared/ui/Sheet'
import { Skeleton } from '@/shared/ui/Skeleton'
import { FuText } from '@/shared/ui/Text'
import { color, spacing, touchTarget } from '@/shared/theme/tokens'

/**
 * L'onglet Compte (M1b) — l'ordre est le contrat :
 *   profil · Fade Passport · favoris · abonnements · langue · notifications
 *   · déconnexion, puis la suppression de compte.
 *
 * Sans session, l'écran ne barre RIEN : il propose la connexion (la feuille
 * se pose PAR-DESSUS, la session arrive sans navigation et l'écran se
 * remplit sur place) et laisse la langue réglable — le choix de langue est
 * une exigence de globalisation, pas une préférence de compte.
 *
 * Deux manques sont dits ici plutôt que masqués :
 *   - le Fade Passport a sa PLACE réservée, sans action ni promesse ;
 *   - la suppression de compte en libre-service n'a AUCUNE RPC en base :
 *     l'écran ouvre une feuille qui le dit et n'appelle rien.
 */
export function AccountScreen() {
  const { t, i18n } = useTranslation('v2')
  const { session, ready } = useSession()
  const queryClient = useQueryClient()

  const [authOpen, setAuthOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutFailed, setSignOutFailed] = useState(false)

  const userId = session?.user.id ?? null
  const email = session?.user.email ?? null

  /* Reprise de focus : un favori posé depuis un profil, un Suivre depuis
     /pro ou le prénom écrit par la synchro d'onboarding se voient en
     revenant sur l'onglet — les listes ne restent jamais périmées. */
  useFocusEffect(
    useCallback(() => {
      if (!userId) return
      for (const queryKey of accountQueryKeys()) void queryClient.invalidateQueries({ queryKey })
    }, [userId, queryClient]),
  )

  const onSignOut = async () => {
    setSigningOut(true)
    setSignOutFailed(false)
    try {
      await signOut()
      // Les clés partagées avec le web ne portent pas d'utilisateur : sans
      // ce retrait, le compte suivant verrait un instant les données du
      // précédent.
      for (const queryKey of accountQueryKeys()) queryClient.removeQueries({ queryKey })
    } catch {
      setSignOutFailed(true)
    } finally {
      setSigningOut(false)
    }
  }

  const languageSection = (
    <Section title={t('mobile.language.label')}>
      <View style={styles.languageList}>
        {V2_LOCALES.map((locale: V2Locale) => (
          <OptionRow
            key={locale}
            label={t(`mobile.language.${locale}`)}
            selected={i18n.language === locale}
            onPress={() => {
              void setLocaleOverride(locale)
            }}
          />
        ))}
      </View>
    </Section>
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <FuText variant="heading" accessibilityRole="header">
          {t('mobile.account.title')}
        </FuText>

        {!ready ? (
          /* La session n'a pas encore répondu : on n'affirme ni connecté ni
             déconnecté — on attend, visiblement. */
          <View style={styles.booting} accessibilityElementsHidden>
            <Skeleton height={96} />
            <Skeleton width="60%" height={20} />
          </View>
        ) : session ? (
          <>
            <ProfileSection userId={session.user.id} email={email} />

            {/* Fade Passport — place RÉSERVÉE. Pas d'action, pas de teaser :
                le Passport appartient déjà au client, on ne le vend pas. */}
            <Card style={styles.passport}>
              <View style={styles.passportHead}>
                <FuText variant="bodyMedium">{t('mobile.account.passportRow')}</FuText>
                <Badge label={t('mobile.account.passportSoon')} />
              </View>
              <FuText variant="sm" tone="secondary">
                {t('mobile.account.passportBody')}
              </FuText>
            </Card>

            <FavoritesSection enabled={Boolean(userId)} />
            <FollowsSection enabled={Boolean(userId)} />
            {languageSection}
            <NotificationsSection />

            <View style={styles.footer}>
              <Button
                label={t('mobile.account.signOut')}
                variant="secondary"
                size="lg"
                fullWidth
                loading={signingOut}
                onPress={() => void onSignOut()}
              />
              {signOutFailed ? (
                <FuText variant="sm" tone="danger" accessibilityRole="alert">
                  {t('errors.data.unknown')}
                </FuText>
              ) : null}

              {/* Registre danger TEXTE — la suppression n'est pas un CTA. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('mobile.account.deleteRow')}
                onPress={() => setDeleteOpen(true)}
                style={({ pressed }) => [styles.deleteRow, pressed && styles.pressed]}
              >
                <FuText variant="smMedium" tone="danger">
                  {t('mobile.account.deleteRow')}
                </FuText>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Card style={styles.signedOut}>
              <FuText variant="title">{t('mobile.account.signedOutTitle')}</FuText>
              <FuText variant="sm" tone="secondary">
                {t('mobile.account.signedOutBody')}
              </FuText>
              <Button
                label={t('mobile.account.signIn')}
                size="lg"
                fullWidth
                onPress={() => setAuthOpen(true)}
              />
            </Card>
            {languageSection}
          </>
        )}
      </ScrollView>

      <AuthSheet open={authOpen} context="account" onClose={() => setAuthOpen(false)} />

      {/* Suppression : AUCUNE RPC n'existe en base. On ouvre la vérité, on
          n'appelle rien — un faux bouton serait pire que l'absence. */}
      <Sheet
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t('mobile.account.deleteTitle')}
      >
        <View style={styles.deleteSheet}>
          <FuText variant="title">{t('mobile.account.deleteTitle')}</FuText>
          <FuText variant="sm" tone="secondary">
            {t('mobile.account.deleteBody')}
          </FuText>
          <Button
            label={t('mobile.account.deleteAck')}
            variant="secondary"
            size="lg"
            fullWidth
            onPress={() => setDeleteOpen(false)}
          />
        </View>
      </Sheet>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas },
  content: {
    paddingHorizontal: spacing(4),
    paddingTop: spacing(2),
    paddingBottom: spacing(10),
    gap: spacing(6),
  },
  booting: { gap: spacing(3) },
  signedOut: { gap: spacing(3), paddingVertical: spacing(4) },
  passport: { gap: spacing(1.5) },
  passportHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing(3) },
  languageList: { gap: spacing(2) },
  footer: { gap: spacing(3), alignItems: 'stretch' },
  deleteRow: {
    minHeight: touchTarget,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pressed: { opacity: 0.6 },
  deleteSheet: { gap: spacing(3), paddingBottom: spacing(2) },
})
