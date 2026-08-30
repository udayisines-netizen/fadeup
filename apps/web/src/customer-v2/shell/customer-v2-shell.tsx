import { Link, NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, CircleUser, Compass, House, Scissors } from 'lucide-react'
import { FadeUpLockup } from '@/components/brand/fadeup-mark'
import { usePendingClaimRedemption } from '@/lib/use-pending-claim'
import { V2TabBar, type V2NavItem } from '@/customer-v2/shell/v2-tab-bar'
import { V2NotificationEntry } from '@/customer-v2/shell/v2-notification-entry'
import { V2_ROUTES } from '@/customer-v2/routes'

/**
 * The greenfield customer shell.
 *
 * ============================================================================
 * WHAT THE SHELL OWNS
 * ============================================================================
 *
 * Identity, notifications, navigation and the measure. Nothing else — and in
 * particular not language and theme controls, which R5 put in the customer
 * header where they consumed a third of a phone's top chrome to expose two
 * settings a customer changes approximately once. They belong in Profile.
 *
 * What is left is a 52px header carrying a discreet wordmark and one bell,
 * which is what "discreet FadeUp identity + notifications" in the blueprint
 * actually costs. Combined with the 64px tab bar, permanent chrome is ~116px
 * of an 844px viewport instead of R5's ~120px with more in it — the saving is
 * small, the clarity is not.
 *
 * ============================================================================
 * TWO EXPRESSIONS, ONE MENTAL MODEL
 * ============================================================================
 *
 * Mobile puts the five destinations at the bottom, where a thumb is. Desktop
 * puts the same five, in the same order, in the header, styled identically —
 * including Book. See the note at the nav itself for why Book is not green
 * here.
 *
 * The handoff is at 1024px, not 768px. An iPad in portrait is 744–834px wide
 * and is held in two hands: dropping the thumb bar there in favour of a header
 * nav trades the better control for the worse one on the exact device where it
 * matters most.
 *
 * The desktop measure is 1200px for content. Home decides internally which of
 * its blocks use all of it; the shell does not stretch anything on their
 * behalf.
 *
 * ============================================================================
 * REUSED FROM THE EXISTING APPLICATION
 * ============================================================================
 *
 * `usePendingClaimRedemption` — a customer who books anonymously and then
 * signs up carries a claim token that must be redeemed wherever they land.
 * That is real, tested booking-integrity machinery from before R5 and it stays
 * exactly where it works: at the shell, not on any one page.
 */
export function CustomerV2Shell() {
  const { t } = useTranslation()

  usePendingClaimRedemption()

  const navItems: V2NavItem[] = [
    { to: V2_ROUTES.home, label: t('customer-app:v2.nav.home'), icon: House, end: true },
    { to: V2_ROUTES.marketplace, label: t('customer-app:v2.nav.marketplace'), icon: Compass },
    { to: V2_ROUTES.book, label: t('customer-app:v2.nav.book'), icon: Scissors },
    { to: V2_ROUTES.appointments, label: t('customer-app:v2.nav.appointments'), icon: CalendarDays },
    { to: V2_ROUTES.profile, label: t('customer-app:v2.nav.profile'), icon: CircleUser },
  ]

  return (
    <div data-fu-v2 className="flex min-h-svh flex-col bg-v2-ground text-v2-ink">
      <header className="sticky top-0 z-20 border-b border-v2-hairline bg-v2-ground/92 backdrop-blur-sm">
        <div className="mx-auto flex h-13 w-full max-w-[75rem] items-center gap-3 px-4 sm:px-6">
          <Link
            to={V2_ROUTES.home}
            aria-label={t('customer-app:v2.shell.homeLink')}
            /*
              The wordmark is 23px of ink; the LINK is 44px so a thumb can hit
              it. Negative inline margin keeps the mark optically flush with the
              header's padding while the hit area extends past it.
            */
            className="v2-press -ms-2 flex h-11 shrink-0 items-center rounded-v2-2 px-2"
          >
            <FadeUpLockup tone="light" className="text-[0.9375rem]" />
          </Link>

          <nav
            aria-label={t('customer-app:v2.shell.primaryNavigation')}
            className="ms-4 hidden items-center gap-1 lg:flex"
          >
            {/*
              All five treated identically, including Book.

              A filled green Book here was the first thing the desktop render
              got wrong: it made a NAVIGATION target the loudest control on a
              page whose actual conversion actions — the Book on each result —
              are the same colour and the same word. Two greens both saying
              "Book", one leading to a tab and one leading to a booking, is the
              duplicate-CTA hesitation the R5 shop profile already demonstrated.

              Green now means exactly one thing in this product: an action that
              books a haircut. The tab bar makes the same choice on mobile, so
              the two expressions of the navigation finally agree.
            */}
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className="v2-press inline-flex h-9 items-center rounded-v2-2 px-3 text-v2-meta font-medium text-v2-ink-soft hover:bg-v2-fill hover:text-v2-ink aria-[current=page]:bg-v2-green-tint aria-[current=page]:font-semibold aria-[current=page]:text-v2-green-ink"
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ms-auto flex shrink-0 items-center">
            <V2NotificationEntry
              to={V2_ROUTES.profile}
              activityLabel={t('customer-app:v2.shell.notifications')}
            />
          </div>
        </div>
      </header>

      {/* pb-20 clears the fixed tab bar; released once the header nav takes over. */}
      <main className="mx-auto w-full max-w-[75rem] flex-1 px-4 pb-20 pt-4 sm:px-6 lg:pb-12 lg:pt-8">
        <Outlet />
      </main>

      <V2TabBar items={navItems} ariaLabel={t('customer-app:v2.shell.primaryNavigation')} />
    </div>
  )
}
