import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useApplySurfaceTheme } from '@/shared/theme/useTheme'
import { LanguageSwitcher } from '@/shared/i18n/LanguageSwitcher'

/**
 * Cadre commun des écrans /auth/* (sans shell — table de routes P1b §7).
 * Clair, direction A : logo, titre, contenu, bascule de langue.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  useApplySurfaceTheme('consumer')
  const { t } = useTranslation('v2')

  return (
    <main className="flex min-h-dvh flex-col bg-[var(--fu-canvas)] font-fu-sans text-[var(--fu-text-primary)]">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
        <Link to="/" className="inline-flex items-center gap-2.5 self-start">
          <img src="/brand/fadeup-mark-primary.png" alt={t('common.brand.logoAlt')} className="size-9" />
        </Link>
        <div>
          <h1 className="text-fu-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">{subtitle}</p>}
        </div>
        {children}
        <div className="mt-2 self-start">
          <LanguageSwitcher />
        </div>
      </div>
    </main>
  )
}
