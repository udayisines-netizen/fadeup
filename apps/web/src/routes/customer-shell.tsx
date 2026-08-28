import { useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, CalendarPlus, CircleUserRound, Compass, Search } from 'lucide-react'
import { ProminentTab, TabBar, type TabItem } from '@/components/ui/tab-bar'
import { BookSheet } from '@/components/customer/book-sheet'
import { FadeUpLockup } from '@/components/brand/fadeup-mark'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { AppNavLink } from '@/components/ui/nav-link'
import { buttonVariants } from '@/components/ui/button'
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
 * FIVE DESTINATIONS, AND ONE OF THEM IS NOT A DESTINATION
 * ============================================================================
 *
 *   Discover · Search · BOOK · Appointments · Profile
 *
 * V2 shipped four tabs and no central action, on the reasoning that a customer
 * books a haircut every few weeks and a permanent create button for a rare act
 * is screen real estate spent on nothing. R5 reverses that, and the reversal is
 * a product decision rather than a visual one: booking is not one of the things
 * FadeUp does, it is the thing FadeUp is for. Everything else on this bar —
 * browsing, searching, checking a time, editing a profile — exists because
 * somebody is going to book, or already has.
 *
 * DISCOVER AND SEARCH ARE NOW DIFFERENT SCREENS. They were merged in V2
 * because Discover had been a card containing a button to Search, which was a
 * dead end worth removing. The merge fixed that and created a subtler problem:
 * one screen was doing two jobs with two different rhythms — "show me what is
 * around me and who I follow" and "find the specific thing I am looking for".
 * Splitting them lets Discover be social and Search be a marketplace, which is
 * what §8 and §9 actually describe.
 *
 * FADE PASSPORT LEFT THE TAB BAR. It is an identity artefact people look at
 * occasionally, not a destination they navigate to weekly, and it was holding a
 * fifth of the primary navigation. It lives inside Profile now, which is where
 * an identity card belongs and where §18 puts it.
 *
 * DESKTOP GETS A HEADER, NOT THE SAME BAR. Five tabs pinned to the bottom of a
 * 1440px display is a phone pattern stretched. The MENTAL MODEL is identical —
 * the same five names, the same order, BOOK still the most prominent control —
 * but expressed as a header nav with BOOK as a real button, because that is
 * what "the primary action" looks like on a desktop.
 */
export function CustomerShell() {
  const { t } = useTranslation()
  const [bookOpen, setBookOpen] = useState(false)

  // Here rather than on any one page: a customer arriving from the booking
  // success screen may land on Discover, Onboarding or Appointments depending
  // on their redirect, and the appointment they just booked must attach to
  // their new account in all of those cases.
  usePendingClaimRedemption()

  // Named in two halves because that is what the bar renders: TabBar splits
  // its items around the centre action, so `leading` sits to the left of BOOK
  // and `trailing` to its right. Four destinations split evenly two and two,
  // which is the only arrangement that leaves BOOK actually centred.
  const leading: TabItem[] = [
    { to: '/app/customer', label: t('common:customerNav.discover'), icon: Compass, end: true },
    { to: '/app/customer/search', label: t('common:customerNav.search'), icon: Search },
  ]
  const trailing: TabItem[] = [
    { to: '/app/customer/appointments', label: t('common:customerNav.appointments'), icon: CalendarDays },
    { to: '/app/customer/profile', label: t('common:customerNav.profile'), icon: CircleUserRound },
  ]

  return (
    <div data-fu-customer className="flex min-h-svh flex-col bg-paper-50">
      <header className="sticky top-0 z-[--fu-z-header] border-b border-border/70 bg-paper-0/85 backdrop-blur supports-[backdrop-filter]:bg-paper-0/80">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-4 px-4 sm:px-6">
          <Link
            to="/app/customer"
            className="shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            aria-label="FadeUp"
          >
            <FadeUpLockup className="h-6 w-auto text-ink-950" />
          </Link>

          <nav aria-label={t('common:customerNav.customerAppNavigation')} className="ms-2 hidden items-center gap-1 md:flex">
            {[...leading, ...trailing].map((tab) => (
              <AppNavLink key={tab.to} to={tab.to} end={tab.end}>
                {tab.label}
              </AppNavLink>
            ))}
          </nav>

          <div className="ms-auto flex shrink-0 items-center gap-1">
            {/* BOOK on desktop. Same action, same sheet, same position in the
                reading order relative to the other destinations — expressed as
                the `book` button variant, which outranks primary by elevation
                so it still wins against anything on the page below it. */}
            <button
              type="button"
              onClick={() => setBookOpen(true)}
              aria-haspopup="dialog"
              className={buttonVariants({ variant: 'book' }, 'me-1 hidden md:inline-flex')}
            >
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              {t('common:customerNav.book')}
            </button>

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

      <TabBar
        items={[...leading, ...trailing]}
        ariaLabel={t('common:customerNav.customerAppNavigation')}
        className="md:hidden"
        centerAction={
          <ProminentTab
            label={t('common:customerNav.book')}
            icon={CalendarPlus}
            onPress={() => setBookOpen(true)}
            ariaLabel={t('common:customerNav.bookAction')}
          />
        }
      />

      <BookSheet open={bookOpen} onOpenChange={setBookOpen} />
    </div>
  )
}
