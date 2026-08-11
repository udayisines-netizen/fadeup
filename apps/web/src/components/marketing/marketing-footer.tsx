import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Container } from '@/components/ui/container'

/** Shared footer for the public marketing site (/, /features, /pricing). */
export function MarketingFooter() {
  const { t } = useTranslation()

  const productLinks = [
    { to: '/', label: t('nav.home') },
    { to: '/for-business', label: t('nav.forBusiness') },
    { to: '/features', label: t('nav.features') },
    { to: '/pricing', label: t('nav.pricing') },
  ]

  const accountLinks = [
    { to: '/pro/login', label: t('auth.logIn') },
    { to: '/pro/signup', label: t('auth.startFree') },
    { to: '/customer/login', label: t('auth.customerLogIn') },
  ]

  return (
    <footer className="border-t border-border bg-paper-50">
      <Container size="xl" className="flex flex-col gap-10 py-12 sm:flex-row sm:justify-between">
        <div className="max-w-xs">
          <p className="text-base font-semibold text-ink-950">FadeUp</p>
          <p className="mt-2 text-sm text-ink-500">{t('footer.tagline')}</p>
        </div>

        <div className="flex flex-wrap gap-12">
          <nav aria-label={t('footer.product')}>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{t('footer.product')}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {productLinks.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-sm text-ink-700 hover:text-ink-950">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label={t('footer.account')}>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{t('footer.account')}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {accountLinks.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-sm text-ink-700 hover:text-ink-950">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </Container>

      <div className="border-t border-border">
        <Container size="xl" className="py-6 text-sm text-ink-500">
          {t('footer.copyright', { year: new Date().getFullYear() })}
        </Container>
      </div>
    </footer>
  )
}
