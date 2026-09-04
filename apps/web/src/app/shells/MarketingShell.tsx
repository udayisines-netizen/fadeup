import { Link, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useApplySurfaceTheme } from '@/shared/theme/useTheme'
import { ShellErrorBoundary } from '@/shared/ui/ErrorBoundary'
import { LanguageSwitcher } from '@/shared/i18n/LanguageSwitcher'

/**
 * Shell marketing — sombre éditorial. Porte /business (P4). La typographie
 * mène ; le dégradé de marque (`--fu-gradient-brand`) est réservé aux
 * moments de héros que P4 composera.
 */
export function MarketingShell() {
  useApplySurfaceTheme('editorial')
  const { t } = useTranslation('v2')

  return (
    <ShellErrorBoundary>
      <div className="flex min-h-dvh flex-col bg-[var(--fu-canvas)] font-fu-sans text-[var(--fu-text-primary)]">
        <header className="border-b border-[var(--fu-border)]">
          <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-6">
            <Link to="/business" className="flex items-center gap-2.5">
              <img src="/brand/fadeup-mark-primary.png" alt="" className="size-8" />
              <span className="text-fu-base font-semibold tracking-tight">{t('common.brand.name')}</span>
              <span className="text-fu-sm text-[var(--fu-text-secondary)]">{t('nav.marketing.forBusiness')}</span>
            </Link>
            <div className="flex items-center gap-3">
              <LanguageSwitcher />
              <Link
                to="/"
                className="flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-fu-sm text-[var(--fu-text-secondary)] hover:text-[var(--fu-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
              >
                {t('nav.marketing.openApp')}
              </Link>
            </div>
          </div>
        </header>
        <main id="fu-main" className="flex-1">
          <Outlet />
        </main>
      </div>
    </ShellErrorBoundary>
  )
}
