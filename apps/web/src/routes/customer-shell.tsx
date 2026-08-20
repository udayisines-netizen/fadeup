import { Link, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, CircleUserRound, Compass, IdCard } from 'lucide-react'
import { TabBar, type TabItem } from '@/components/ui/tab-bar'
import { FadeUpLockup } from '@/components/brand/fadeup-mark'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { AppNavLink } from '@/components/ui/nav-link'
import { usePendingClaimRedemption } from '@/lib/use-pending-claim'

/**
 * The Customer application shell.
 *
 * Light by default — no `data-fu-pro` here — because this is the consumer half
 * of FadeUp and it should feel like a marketplace rather than an operations
 * console. That contrast is deliberate and is the clearest signal of which
 * product you are in.
 *
 * ============================================================================
 * FOUR DESTINATIONS, DOWN FROM FIVE
 * ============================================================================
 *
 * V1 had Home and Discover as separate tabs, where Home's discovery section
 * was a card containing a button to Discover. They have merged: the home IS
 * the search, so the tab that existed to reach it no longer needs to.
 *
 * Queue still has no tab — an active queue is contextual and a permanent tab
 * would be empty almost always. Favorites still lives inside Profile. Both
 * were right in V1 and neither changed.
 *
 * Mobile gets NO central action. The Professional bar has one because a shop
 * creates things constantly; a customer books a haircut every few weeks, and a
 * permanent create button for a rare act would be prime screen real estate
 * spent on nothing. Booking starts from discovery, which is the first tab.
 *
 * Desktop gets a slim header instead of the tab bar: four tabs pinned to the
 * bottom of a 1440px display would be a phone pattern stretched, which is
 * exactly what this rebuild exists to stop doing.
 */
export function CustomerShell() {
  const { t } = useTranslation()

  // Here rather than on any one page: a customer arriving from the booking
  // success screen may land on Discover, Onboarding or Appointments depending
  // on their redirect, and the appointment they just booked must attach to
  // their new account in all of those cases.
  usePendingClaimRedemption()

  const tabs: TabItem[] = [
    { to: '/app/customer', label: t('common:customerNav.discover'), icon: Compass, end: true },
    { to: '/app/customer/appointments', label: t('common:customerNav.appointments'), icon: CalendarDays },
    { to: '/app/customer/passport', label: t('common:customerNav.passport'), icon: IdCard },
    { to: '/app/customer/profile', label: t('common:customerNav.profile'), icon: CircleUserRound },
  ]

  return (
    <div data-fu-customer className="flex min-h-svh flex-col bg-paper-50">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-paper-0/85 backdrop-blur supports-[backdrop-filter]:bg-paper-0/80">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-4 px-4 sm:px-6">
          <Link
            to="/app/customer"
            className="shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            aria-label="FadeUp"
          >
            <FadeUpLockup className="h-6 w-auto text-ink-950" />
          </Link>

          <nav aria-label={t('common:customerNav.customerAppNavigation')} className="ms-2 hidden items-center gap-1 md:flex">
            {tabs.map((tab) => (
              <AppNavLink key={tab.to} to={tab.to} end={tab.end}>
                {tab.label}
              </AppNavLink>
            ))}
          </nav>

          <div className="ms-auto flex shrink-0 items-center gap-1">
            {/* Also refetches the booking list whenever a notification lands,
                so a customer sitting on Discover sees the badge AND has fresh
                appointments the moment they tap through. */}
            <NotificationBell extraInvalidation={[['my-appointments']]} />
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* pb-24 clears the tab bar; released once the header nav takes over. */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-5 sm:px-6 md:pb-10">
        <Outlet />
      </main>

      <TabBar items={tabs} ariaLabel={t('common:customerNav.customerAppNavigation')} className="md:hidden" />
    </div>
  )
}
