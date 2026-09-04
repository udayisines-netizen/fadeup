import { useTranslation } from 'react-i18next'
import { useApplySurfaceTheme } from '@/shared/theme/useTheme'
import { Row } from '@/shared/ui/Row'

/**
 * Index /demo — les trois études réelles de P1c. Protégé par
 * VITE_ENABLE_DEMO (RequireDemo), en noindex, absent de toute navigation.
 */
export function DemoIndexPage() {
  useApplySurfaceTheme('consumer')
  const { t } = useTranslation('v2')

  const studies = [
    { to: '/demo/discovery', title: t('demo.index.discoveryTitle'), lede: t('demo.index.discoveryLede') },
    { to: '/demo/profile', title: t('demo.index.profileTitle'), lede: t('demo.index.profileLede') },
    { to: '/demo/pro', title: t('demo.index.proTitle'), lede: t('demo.index.proLede') },
  ]

  return (
    <main
      id="fu-main"
      className="fu-page-in mx-auto min-h-dvh w-full max-w-2xl bg-[var(--fu-canvas)] px-4 py-10 font-fu-sans text-[var(--fu-text-primary)]"
    >
      <div className="flex items-center gap-3">
        <img src="/brand/fadeup-mark-primary.png" alt={t('common.brand.logoAlt')} className="size-10" />
        <h1 className="text-fu-xl font-semibold tracking-tight">{t('nav.demo.title')}</h1>
      </div>
      <p className="mt-2 max-w-prose text-fu-sm text-[var(--fu-text-secondary)]">{t('demo.index.lede')}</p>

      <div className="mt-6 rounded-[var(--radius-card)] border border-[var(--fu-border)]">
        {studies.map((study) => (
          <Row key={study.to} as="link" to={study.to} title={study.title} subtitle={study.lede} chevron />
        ))}
      </div>
    </main>
  )
}
