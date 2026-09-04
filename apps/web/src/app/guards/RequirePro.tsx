import { Navigate, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAccess } from '@/shared/hooks/useAccess'
import { Spinner } from '@/shared/ui/Spinner'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Button } from '@/shared/ui/Button'
import { errorMessageKey } from '@/shared/data/errors'

/**
 * Réservé aux comptes professionnels (`get_my_access.professional_available`).
 * Un client ordinaire n'est pas envoyé dans un mur : il voit un état
 * explicite avec une sortie. À monter SOUS RequireAuth.
 */
export function RequirePro() {
  const { t } = useTranslation('v2')
  const { access, loading, error } = useAccess()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner size="lg" announce />
      </div>
    )
  }

  if (error) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <EmptyState
          title={t('errors.boundary.title')}
          description={t(errorMessageKey(error))}
          action={
            <Button variant="primary" onClick={() => window.location.reload()}>
              {t('common.action.retry')}
            </Button>
          }
        />
      </main>
    )
  }

  if (!access?.professionalAvailable) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
