import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { buttonVariants } from '@/components/ui/button'
import { AppNavLink } from '@/components/ui/nav-link'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'

const MARKETING_LINKS: { to: string; label: string; end: boolean }[] = [
  { to: '/', label: 'Home', end: true },
  { to: '/features', label: 'Features', end: false },
  { to: '/pricing', label: 'Pricing', end: false },
]

/** Shared top nav for the public marketing site (/, /features, /pricing) — mobile menu uses the Drawer primitive. */
export function MarketingHeader() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

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
          {MARKETING_LINKS.map((link) => (
            <AppNavLink key={link.to} to={link.to} end={link.end}>
              {link.label}
            </AppNavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link to="/login" className={buttonVariants({ variant: 'ghost' })}>
            Log in
          </Link>
          <Link to="/signup" className={buttonVariants({ variant: 'primary' })}>
            Start free
          </Link>
        </div>

        <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
          <DrawerTrigger
            className={buttonVariants({ variant: 'ghost' }, 'md:hidden')}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </DrawerTrigger>
          <DrawerContent side="right" aria-label="Mobile navigation">
            <DrawerHeader>
              <DrawerTitle>Menu</DrawerTitle>
            </DrawerHeader>
            <nav aria-label="Mobile" className="flex flex-col gap-1">
              {MARKETING_LINKS.map((link) => (
                <AppNavLink key={link.to} to={link.to} end={link.end} className="w-full">
                  {link.label}
                </AppNavLink>
              ))}
            </nav>
            <div className="mt-6 flex flex-col gap-2 border-t border-border pt-6">
              <Link to="/login" className={buttonVariants({ variant: 'secondary' }, 'w-full')}>
                Log in
              </Link>
              <Link to="/signup" className={buttonVariants({ variant: 'primary' }, 'w-full')}>
                Start free
              </Link>
            </div>
          </DrawerContent>
        </Drawer>
      </Container>
    </header>
  )
}
