import { Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useApplySurfaceTheme } from '@/shared/theme/useTheme'
import { ShellErrorBoundary } from '@/shared/ui/ErrorBoundary'

/**
 * Coquille Platform V2 — structure FUTURE uniquement (P5). La console
 * /platform en production reste servie par les layouts legacy, intouchés ;
 * ce shell n'est monté sur aucune de ses routes aujourd'hui. Toujours
 * derrière RequirePlatform (refus par défaut).
 */
export function PlatformShell() {
  useApplySurfaceTheme('editorial')
  const { t } = useTranslation('v2')

  return (
    <ShellErrorBoundary>
      <div className="flex min-h-dvh flex-col bg-[var(--fu-canvas)] font-fu-sans text-[var(--fu-text-primary)]">
        <header className="border-b border-[var(--fu-border)]">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2.5 px-6">
            <img src="/brand/fadeup-mark-primary.png" alt="" className="size-7" />
            <span className="text-fu-sm font-semibold">{t('nav.platform.title')}</span>
          </div>
        </header>
        <main id="fu-main" className="flex-1">
          <Outlet />
        </main>
      </div>
    </ShellErrorBoundary>
  )
}
