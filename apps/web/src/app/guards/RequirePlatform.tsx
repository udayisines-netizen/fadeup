import { Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAccess } from '@/shared/hooks/useAccess'
import { Spinner } from '@/shared/ui/Spinner'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Button } from '@/shared/ui/Button'

/**
 * Garde du futur PlatformShell (P5) : REFUS PAR DÉFAUT — seul un rôle
 * interne vérifié (`get_my_access.platform_available`) entre. La console
 * /platform existante garde sa propre garde legacy (RequirePlatformRole),
 * intouchée.
 */
export function RequirePlatform() {
  const { t } = useTranslation('v2')
  const { access, loading } = useAccess()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner size="lg" announce />
      </div>
    )
  }

  if (!access?.platformAvailable) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <EmptyState
          title={t('errors.data.forbidden')}
          description={t('errors.route.notFoundDescription')}
          action={
            <Button variant="primary" onClick={() => window.location.assign('/')}>
              {t('common.action.goHome')}
            </Button>
          }
        />
      </main>
    )
  }

  return <Outlet />
}
