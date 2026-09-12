import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useDocumentMeta } from '@/shared/hooks/useDocumentMeta'
import { Spinner } from '@/shared/ui/Spinner'
import { unsubscribeCustomerMarketing } from '@/features/pro-notifications/api/campaigns'

/**
 * OS-3 — la porte HUMAINE du désabonnement marketing.
 *
 * Le lien `List-Unsubscribe` des sollicitations pointe sur la fonction Edge
 * `unsubscribe-customer`, qui redirige un GET ici (un scanner d'e-mails suit
 * les liens : un GET ne doit jamais changer d'état côté Edge) et traite
 * elle-même le POST One-Click de RFC 8058.
 *
 * Ici, en revanche, l'action EST attendue : la personne a cliqué. On appelle
 * donc la RPC à l'arrivée et on confirme. La RPC répond toujours vrai — un
 * jeton inconnu, déjà utilisé ou inventé reçoit exactement la même page, sans
 * quoi cette URL deviendrait un oracle d'existence de fiche cliente.
 *
 * Aucune session : le destinataire d'un e-mail n'en a pas. C'est pour cela que
 * la RPC est au contrat de surface anonyme de X3.
 */

export function UnsubscribeCustomerPage() {
  const { t } = useTranslation('v2')
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<'pending' | 'done' | 'error'>('pending')

  useDocumentMeta({ title: t('pro.unsubscribe.title') })

  useEffect(() => {
    let cancelled = false
    if (!token) {
      setState('error')
      return
    }
    void unsubscribeCustomerMarketing(token)
      .then(() => {
        if (!cancelled) setState('done')
      })
      .catch(() => {
        // Seule une panne réseau amène ici : la RPC elle-même ne refuse pas.
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-16" data-testid="unsubscribe-customer">
      {state === 'pending' ? (
        <div className="flex justify-center">
          <Spinner size="lg" announce />
        </div>
      ) : state === 'done' ? (
        <div data-testid="unsubscribe-done">
          <h1 className="text-fu-xl font-semibold text-[var(--fu-text-primary)]">
            {t('pro.unsubscribe.doneTitle')}
          </h1>
          <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.unsubscribe.doneBody')}</p>
          <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.unsubscribe.transactional')}</p>
        </div>
      ) : (
        <div data-testid="unsubscribe-error">
          <h1 className="text-fu-xl font-semibold text-[var(--fu-text-primary)]">
            {t('pro.unsubscribe.errorTitle')}
          </h1>
          <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.unsubscribe.errorBody')}</p>
        </div>
      )}
    </div>
  )
}
