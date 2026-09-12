import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'

import { accountQueryKeys } from '@/features/account/api/account'
import { revokeThisDevice } from '@/features/notifications/usePushDevice'
import { forgetPersonalData } from '@/shared/data/persistence'
import { DeleteAccountSheet } from '@/features/account/DeleteAccountSheet'
import { FavoritesSection } from '@/features/account/FavoritesSection'
import { FollowsSection } from '@/features/account/FollowsSection'
import { NotificationsSection } from '@/features/account/NotificationsSection'
import { Card, Section } from '@/features/account/parts'
import { PreferencesSection } from '@/features/account/PreferencesSection'
import { ProfileSection } from '@/features/account/ProfileSection'
import { signOut, useSession } from '@/shared/data/auth'
import { setLocaleOverride, V2_LOCALES, type V2Locale } from '@/shared/i18n'
import { AuthSheet } from '@/shared/ui/AuthSheet'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { OptionRow } from '@/shared/ui/OptionRow'
import { Skeleton } from '@/shared/ui/Skeleton'
import { FuText } from '@/shared/ui/Text'
import { color, spacing, touchTarget } from '@/shared/theme/tokens'

/**
 * L'onglet Compte (M1b) — l'ordre est le contrat :
 *   profil · Fade Passport · favoris · abonnements · préférences de
 *   recommandation · langue · notifications · déconnexion, puis la
 *   suppression de compte.
 *
 * Sans session, l'écran ne barre RIEN : il propose la connexion (la feuille
 * se pose PAR-DESSUS, la session arrive sans navigation et l'écran se
 * remplit sur place) et laisse la langue réglable — le choix de langue est
 * une exigence de globalisation, pas une préférence de compte.
 *
 * Un manque est dit ici plutôt que masqué : le Fade Passport a sa PLACE
 * réservée, sans action ni promesse.
 *
 * L'autre manque de M1b est comblé : la suppression de compte en libre-service
 * a désormais sa RPC (B5, `delete_my_account`), et la feuille l'appelle
 * vraiment — avec l'export à côté, parce que le MASTER_SPEC §16 exige les
 * deux et qu'on n'efface pas ce qu'on n'a pas pu emporter.
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
      /* AVANT `signOut()`, et c'est tout l'intérêt : `revoke_push_device`
         n'accepte de retirer un appareil qui appartient à un compte QUE si
         l'appelant est ce compte. Après la déconnexion, l'appel part en rôle
         anonyme, `auth.uid()` est NULL et la garde du serveur n'apparie plus
         rien : l'appareil restait destinataire. Scénario mesuré en revue —
         téléphone familial, A se déconnecte, et les appels de file, rappels
         et confirmations de A continuaient de s'afficher sur l'écran
         verrouillé de B. */
      await revokeThisDevice()
      await signOut()
      // Les clés partagées avec le web ne portent pas d'utilisateur : sans
      // ce retrait, le compte suivant verrait un instant les données du
      // précédent.
      for (const queryKey of accountQueryKeys()) queryClient.removeQueries({ queryKey })
      // Et ce qui est PERSISTÉ au disque (réservations, préférences) doit
      // partir aussi — sinon il survit à la déconnexion pendant sept jours.
      await forgetPersonalData(queryClient)
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
            <PreferencesSection userId={session.user.id} />
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

      {/* Suppression réelle (B5). La feuille explique, propose l'export,
          puis demande une confirmation séparée : la RPC est immédiate et
          définitive, il n'existe aucune fenêtre d'annulation en base. */}
      {userId ? (
        <DeleteAccountSheet
          open={deleteOpen}
          userId={userId}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => void onSignOut()}
        />
      ) : null}
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
})
