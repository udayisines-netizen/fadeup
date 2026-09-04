import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { resolveDestination } from '@/features/auth/api/auth'
import { AuthLayout } from '@/features/auth/components/AuthLayout'
import { useSession } from '@/shared/hooks/useSession'
import { Button } from '@/shared/ui/Button'
import { Spinner } from '@/shared/ui/Spinner'

const FAILURE_DELAY_MS = 6000

/**
 * Atterrissage des liens e-mail (magique, vérification). supabase-js
 * consomme les jetons du fragment d'URL (`detectSessionInUrl`) ; cette page
 * attend la session puis route. Un lien mort (expiré, déjà utilisé, ou
 * `error_description` dans le fragment) aboutit à un échec explicite avec
 * une sortie — jamais un spinner éternel.
 */
export function CallbackPage() {
  const { t } = useTranslation('v2')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirect = params.get('redirect')
  const { session } = useSession()
  const [failed, setFailed] = useState(() => window.location.hash.includes('error'))

  useEffect(() => {
    if (!session) return
    let active = true
    void (async () => {
      const destination = redirect ?? (await resolveDestination())
      if (active) navigate(destination, { replace: true })
    })()
    return () => {
      active = false
    }
  }, [session, redirect, navigate])

  useEffect(() => {
    if (session || failed) return
    const timer = window.setTimeout(() => setFailed(true), FAILURE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [session, failed])

  if (failed && !session) {
    return (
      <AuthLayout title={t('auth.callback.failedTitle')} subtitle={t('auth.callback.failedDescription')}>
        <Button variant="primary" size="lg" fullWidth onClick={() => navigate('/auth/magic')}>
          {t('auth.callback.failedAction')}
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.callback.verifying')}>
      <div className="flex justify-center py-8">
        <Spinner size="lg" announce />
      </div>
    </AuthLayout>
  )
}
