import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import {
  erasureRefusalOf,
  useDeleteMyAccount,
  useExportMyData,
  type AccountErasureReceipt,
} from '@/features/account/api/account'
import { Button } from '@/shared/ui/Button'
import { Sheet } from '@/shared/ui/Sheet'
import { FuText } from '@/shared/ui/Text'
import { color, radius, spacing } from '@/shared/theme/tokens'

type Step = 'explain' | 'confirm' | 'done'

/**
 * La suppression de compte, enfin réelle (B5). M1b avait posé ici un point
 * d'entrée honnête — une feuille qui disait « ça n'existe pas encore » et
 * n'appelait rien. La RPC existe ; la feuille l'appelle.
 *
 * Ce que cet écran doit porter, parce que le serveur ne peut pas :
 *
 *  - LA CONFIRMATION. `delete_my_account()` est IMMÉDIATE et DÉFINITIVE : il
 *    n'existe aucune fenêtre d'annulation côté base (décision B5, justifiée
 *    dans l'en-tête de la migration 20260911160200). Toute la protection
 *    contre le geste malheureux est donc ici, en deux temps : on explique
 *    d'abord ce qui part et ce qui reste, on ne propose le geste irréversible
 *    qu'ensuite, et le CTA est en registre danger secondaire — jamais le
 *    bouton le plus attirant de l'écran.
 *  - LA VÉRITÉ SUR CE QUI RESTE. Dire « tout est supprimé » serait faux :
 *    les rendez-vous passés restent au salon, anonymisés, parce que ce sont
 *    sa comptabilité ; les avis restent publiés, sans auteur. On le dit
 *    AVANT, pas après.
 *  - L'EXPORT D'ABORD. Le §16 exige les deux ; les proposer côte à côte au
 *    même moment est la seule façon honnête : on n'efface pas ce qu'on n'a
 *    pas pu emporter.
 *  - LES REFUS NOMMÉS, lus sur le CODE (`fadeup_erasure_refusal=…`) et
 *    jamais sur le statut HTTP — motif F1/F4/M1b verbatim. Les quatre ont
 *    chacun leur message et, quand c'est possible, leur issue.
 */
export function DeleteAccountSheet({
  open,
  userId,
  onClose,
  onDeleted,
}: {
  open: boolean
  userId: string
  onClose: () => void
  onDeleted: () => void
}) {
  const { t } = useTranslation('v2')
  const [step, setStep] = useState<Step>('explain')
  const [receipt, setReceipt] = useState<AccountErasureReceipt | null>(null)
  const [exported, setExported] = useState(false)

  const del = useDeleteMyAccount(userId)
  const exportData = useExportMyData()

  const close = () => {
    setStep('explain')
    setReceipt(null)
    setExported(false)
    del.reset()
    exportData.reset()
    onClose()
  }

  const refusal = del.isError
    ? erasureRefusalOf(del.error instanceof Error ? del.error.message : String(del.error))
    : null

  return (
    <Sheet open={open} onClose={close} title={t('mobile.account.deleteTitle')}>
      <ScrollView contentContainerStyle={styles.sheet} showsVerticalScrollIndicator={false}>
        {step === 'done' && receipt ? (
          <>
            <FuText variant="title">{t('mobile.account.deleteDoneTitle')}</FuText>
            <FuText variant="sm" tone="secondary">
              {t('mobile.account.deleteDoneBody')}
            </FuText>
            {/* Le reçu : la seule preuve qui existe côté personne. La trace
                en base ne porte AUCUN identifiant, volontairement. */}
            <View style={styles.receipt}>
              <FuText variant="sm" tone="secondary">
                {t('mobile.account.deleteReceipt')}
              </FuText>
              <FuText variant="smMedium" selectable>
                {receipt.erasure_id}
              </FuText>
            </View>
            {/* Fermer = partir : la session ne vaut plus rien, son compte
                n'existe plus. On la retire ici plutôt que d'attendre qu'une
                requête échoue en 401 devant l'utilisateur. */}
            <Button
              label={t('common.action.close')}
              size="lg"
              fullWidth
              onPress={() => {
                close()
                onDeleted()
              }}
            />
          </>
        ) : (
          <>
            <FuText variant="title">{t('mobile.account.deleteTitle')}</FuText>
            <FuText variant="sm" tone="secondary">
              {t('mobile.account.deleteBody')}
            </FuText>
            <FuText variant="sm" tone="secondary">
              {t('mobile.account.deleteKept')}
            </FuText>

            {/* L'export, au même moment : on n'efface pas ce qu'on n'a pas
                pu emporter. */}
            <Button
              label={exported ? t('mobile.account.exportDone') : t('mobile.account.exportAction')}
              variant="secondary"
              fullWidth
              loading={exportData.isPending}
              onPress={() => {
                exportData.mutate(undefined, { onSuccess: () => setExported(true) })
              }}
            />
            {exportData.isError ? (
              <FuText variant="sm" tone="danger" accessibilityRole="alert">
                {t('errors.data.unknown')}
              </FuText>
            ) : null}

            {/* L'export doit être LIVRÉ, pas annoncé.
                La première écriture récupérait le JSON et le jetait, puis
                affichait « Données exportées » — l'utilisateur ne recevait
                rien. Un bouton qui affirme un résultat qu'il ne produit pas
                est pire que pas de bouton. Le contenu est donc rendu ici,
                sélectionnable, sans dépendance native nouvelle (ni
                expo-file-system ni expo-sharing ne sont installés, et les
                ajouter déborderait ce lot). Le partage en fichier viendra avec
                l'écran d'export, hors périmètre B5. */}
            {exported && exportData.data ? (
              <View style={styles.export}>
                <FuText variant="smMedium">{t('mobile.account.exportReady')}</FuText>
                <ScrollView style={styles.exportScroll} nestedScrollEnabled>
                  <FuText variant="sm" tone="secondary" selectable>
                    {JSON.stringify(exportData.data, null, 2)}
                  </FuText>
                </ScrollView>
              </View>
            ) : null}

            {step === 'explain' ? (
              <Button
                label={t('mobile.account.deleteContinue')}
                variant="ghost"
                fullWidth
                onPress={() => setStep('confirm')}
              />
            ) : (
              <>
                <FuText variant="smMedium" tone="danger">
                  {t('mobile.account.deleteFinal')}
                </FuText>
                <Button
                  label={t('mobile.account.deleteConfirm')}
                  variant="secondary"
                  size="lg"
                  fullWidth
                  loading={del.isPending}
                  onPress={() => {
                    del.mutate(undefined, {
                      onSuccess: (result) => {
                        setReceipt(result)
                        setStep('done')
                      },
                    })
                  }}
                />
                <Button
                  label={t('common.action.cancel')}
                  variant="ghost"
                  fullWidth
                  onPress={close}
                />
              </>
            )}

            {refusal ? (
              <FuText variant="sm" tone="danger" accessibilityRole="alert">
                {t(`mobile.account.deleteRefusal.${refusal}`)}
              </FuText>
            ) : null}
          </>
        )}
      </ScrollView>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  sheet: { gap: spacing(3), paddingBottom: spacing(2) },
  export: {
    gap: spacing(1),
    padding: spacing(3),
    borderRadius: radius.card,
    backgroundColor: color.surfaceSubtle,
  },
  exportScroll: { maxHeight: 220 },
  receipt: {
    gap: spacing(1),
    padding: spacing(3),
    borderRadius: radius.card,
    backgroundColor: color.surfaceSubtle,
  },
})
