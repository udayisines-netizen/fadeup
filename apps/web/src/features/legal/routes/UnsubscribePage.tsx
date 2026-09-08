import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/Button'
import { IconInfo } from '@/shared/ui/icons'
import { useDocumentMeta } from '@/shared/hooks/useDocumentMeta'
import { useUnsubscribe } from '@/features/legal/api/legal'

/**
 * X2 — `/unsubscribe/:token`, la destination du lien de désabonnement que B2
 * écrit dans chaque e-mail de prospection ET de l'e-mail d'information X2.
 * B2 avait posé l'URL dans les gabarits sans que la route existe : ce fichier
 * la crée.
 *
 * Le geste demande une CONFIRMATION explicite : les scanners d'e-mails
 * suivent les liens (GET) — un désabonnement au chargement de la page
 * désabonnerait tout destinataire dont l'antivirus ouvre les liens.
 *
 * La RPC répond toujours vrai (anti-énumération, B2) : le même écran de
 * succès s'affiche pour un jeton réel et pour un jeton inconnu — un tiers ne
 * peut pas tester des jetons pour savoir lesquels existent.
 */
export function UnsubscribePage() {
  const { t } = useTranslation('v2')
  const { token = '' } = useParams()
  const unsubscribe = useUnsubscribe()
  const [done, setDone] = useState(false)

  useDocumentMeta({ title: t('legal.unsubscribe.metaTitle') })

  const confirm = async () => {
    try {
      await unsubscribe.mutateAsync(token)
      setDone(true)
    } catch {
      // L'échec est réseau/serveur, jamais « jeton inconnu » — l'état d'erreur
      // propose simplement de réessayer.
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-24 pt-10" data-testid="unsubscribe-page">
      {done ? (
        <div role="status" data-testid="unsubscribe-done">
          <h1 className="text-fu-2xl font-semibold tracking-tight text-[var(--fu-text-primary)]">
            {t('legal.unsubscribe.doneTitle')}
          </h1>
          <p className="mt-3 text-fu-base leading-relaxed text-[var(--fu-text-secondary)]">
            {t('legal.unsubscribe.doneBody')}
          </p>
          <p className="mt-4">
            <Link
              to="/professionals-data"
              className="text-fu-base font-medium text-[var(--fu-accent-text)] underline-offset-2 hover:underline"
            >
              {t('legal.unsubscribe.dataPageLink')}
            </Link>
          </p>
        </div>
      ) : (
        <>
          <h1 className="text-fu-2xl font-semibold tracking-tight text-[var(--fu-text-primary)]">
            {t('legal.unsubscribe.title')}
          </h1>
          <p className="mt-3 text-fu-base leading-relaxed text-[var(--fu-text-secondary)]">
            {t('legal.unsubscribe.body')}
          </p>
          {unsubscribe.isError && (
            <p role="alert" className="mt-4 flex items-start gap-2 text-fu-sm text-[var(--fu-text-primary)]">
              <IconInfo aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t('legal.unsubscribe.error')}
            </p>
          )}
          <div className="mt-6">
            <Button
              variant="primary"
              size="lg"
              loading={unsubscribe.isPending}
              onClick={() => void confirm()}
              data-testid="unsubscribe-confirm"
            >
              {t('legal.unsubscribe.confirm')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export default UnsubscribePage
