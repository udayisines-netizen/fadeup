import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Container } from '@/components/ui/container'
import { buttonVariants } from '@/components/ui/button'
import { AppNavLink } from '@/components/ui/nav-link'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { useAuth } from '@/lib/auth-context'

/**
 * Shared top nav for the public marketing site (/, /features, /pricing) and,
 * importantly, /search — mobile menu uses the Drawer primitive.
 *
 * The auth area offers exactly TWO actions, both CUSTOMER: Log in (/login)
 * and Sign up (/register). It previously offered three — a generic "Log in"
 * that went to /pro/login, a generic "Start free" that went to /pro/signup,
 * and a separate "Customer login" — which asked an ordinary visitor to pick
 * between three identity concepts before they knew FadeUp had more than one.
 * Professional auth is reached deliberately, through "For business", not by
 * a consumer guessing which of three buttons belongs to them.
 *
 * Session-aware on purpose: Discover in the customer app's bottom tab bar
 * points at /search, which renders out here rather than inside the app
 * shell. Without a way back, the first tap on Discover stranded a signed-in
 * customer on a page offering them "Log in" and "Sign up", with only the
 * browser Back button to reach their appointments again.
 */
export function MarketingHeader() {
  const { t } = useTranslation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const { session } = useAuth()

  const marketingLinks: { to: string; label: string; end: boolean }[] = [
    { to: '/', label: t('nav.home'), end: true },
    { to: '/for-business', label: t('nav.forBusiness'), end: false },
  ]

  // Close the mobile drawer automatically on navigation (route change).
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-paper-0/95 backdrop-blur">
      <Container size="xl" className="flex h-16 items-center justify-between gap-4">
        <Link to="/" className="shrink-0 text-base font-semibold tracking-tight text-ink-950">
          FadeUp
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {marketingLinks.map((link) => (
            <AppNavLink key={link.to} to={link.to} end={link.end}>
              {link.label}
            </AppNavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-1 md:flex">
          <LanguageSwitcher />
          <ThemeToggle />
          {session ? (
            <Link to="/app/customer" className={buttonVariants({ variant: 'primary' })}>
              {t('nav.myFadeUp')}
            </Link>
          ) : (
            <>
              <Link to="/login" className={buttonVariants({ variant: 'ghost' })}>
                {t('auth.logIn')}
              </Link>
              <Link to="/register" className={buttonVariants({ variant: 'primary' })}>
                {t('auth.signUp')}
              </Link>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 md:hidden">
          <LanguageSwitcher />
          <ThemeToggle />
          <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
            <DrawerTrigger className={buttonVariants({ variant: 'ghost' })} aria-label="Open menu">
              <Menu className="h-5 w-5" aria-hidden="true" />
            </DrawerTrigger>
            <DrawerContent side="right" aria-label="Mobile navigation">
              <DrawerHeader>
                <DrawerTitle>Menu</DrawerTitle>
              </DrawerHeader>
              <nav aria-label="Mobile" className="flex flex-col gap-1">
                {marketingLinks.map((link) => (
                  <AppNavLink key={link.to} to={link.to} end={link.end} className="w-full">
                    {link.label}
                  </AppNavLink>
                ))}
              </nav>
              <div className="mt-6 flex flex-col gap-2 border-t border-border pt-6">
                {session ? (
                  <Link to="/app/customer" className={buttonVariants({ variant: 'primary' }, 'w-full')}>
                    {t('nav.myFadeUp')}
                  </Link>
                ) : (
                  <>
                    <Link to="/login" className={buttonVariants({ variant: 'secondary' }, 'w-full')}>
                      {t('auth.logIn')}
                    </Link>
                    <Link to="/register" className={buttonVariants({ variant: 'primary' }, 'w-full')}>
                      {t('auth.signUp')}
                    </Link>
                  </>
                )}
              </div>
            </DrawerContent>
          </Drawer>
        </div>
      </Container>
    </header>
  )
}
