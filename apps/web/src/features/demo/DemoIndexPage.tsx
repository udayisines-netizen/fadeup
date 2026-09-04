import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useApplySurfaceTheme } from '@/shared/theme/useTheme'
import { EmptyState } from '@/shared/ui/EmptyState'

/**
 * Coquille /demo — protégée par VITE_ENABLE_DEMO (RequireDemo), en noindex,
 * absente de toute navigation. VIDE en P1b : P1c la remplit avec les trois
 * compositions réelles branchées sur de vraies RPC.
 */
export function DemoIndexPage() {
  useApplySurfaceTheme('consumer')
  const { t } = useTranslation('v2')
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl bg-[var(--fu-canvas)] px-4 py-8 font-fu-sans text-[var(--fu-text-primary)]">
      <h1 className="text-fu-xl font-semibold text-[var(--fu-text-primary)]">{t('nav.demo.title')}</h1>
      <EmptyState
        title={t('empty.demo.title')}
        description={t('empty.demo.description')}
        action={
          import.meta.env.DEV ? (
            <Link
              to="/dev/ui"
              className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[var(--fu-border-strong)] px-4 text-fu-sm font-medium text-[var(--fu-text-primary)] hover:bg-[var(--fu-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--fu-canvas)]"
            >
              {t('empty.demo.action')}
            </Link>
          ) : (
            <Link
              to="/"
              className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[var(--fu-border-strong)] px-4 text-fu-sm font-medium text-[var(--fu-text-primary)] hover:bg-[var(--fu-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--fu-canvas)]"
            >
              {t('common.action.goHome')}
            </Link>
          )
        }
      />
    </main>
  )
}
