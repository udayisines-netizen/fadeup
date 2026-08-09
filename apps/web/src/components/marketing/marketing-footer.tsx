import { Link } from 'react-router-dom'
import { Container } from '@/components/ui/container'

const PRODUCT_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/features', label: 'Features' },
  { to: '/pricing', label: 'Pricing' },
]

const ACCOUNT_LINKS = [
  { to: '/login', label: 'Log in' },
  { to: '/signup', label: 'Start free' },
]

/** Shared footer for the public marketing site (/, /features, /pricing). */
export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-paper-50">
      <Container size="xl" className="flex flex-col gap-10 py-12 sm:flex-row sm:justify-between">
        <div className="max-w-xs">
          <p className="text-base font-semibold text-ink-950">FadeUp</p>
          <p className="mt-2 text-sm text-ink-500">
            The operating system for modern barbershops &mdash; booking, live queue, chair
            operations and customer relationships in one connected system.
          </p>
        </div>

        <div className="flex flex-wrap gap-12">
          <nav aria-label="Product">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Product</p>
            <ul className="mt-3 flex flex-col gap-2">
              {PRODUCT_LINKS.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-sm text-ink-700 hover:text-ink-950">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Account">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Account</p>
            <ul className="mt-3 flex flex-col gap-2">
              {ACCOUNT_LINKS.map((link) => (
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
          &copy; {new Date().getFullYear()} FadeUp. All rights reserved.
        </Container>
      </div>
    </footer>
  )
}
