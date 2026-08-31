/**
 * FadeUp V3 — customer application shell.
 *
 * Exactly five destinations, in order: Home, Marketplace, Book, Appointments,
 * Profile (FADEUP_V3_PRODUCT_TRUTHS.md §H). Mobile: fixed bottom navigation,
 * safe-area aware, 44px+ targets, no floating dock. Desktop: horizontal
 * application navigation — customers never get a Pro sidebar. Notifications
 * live in the top bar, not a tab.
 *
 * Reuse ledger (nonvisual): useAuth, useNotifications, i18n. FadeUpMark is
 * the brand charter.
 */
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { FadeUpMark } from '@/components/brand/fadeup-mark'
import { useAuth } from '@/lib/auth-context'
import { useNotifications } from '@/lib/queries/notifications'
import { V3_ROUTES } from '@/customer-v3/routes'

import '@/ui-v3/ui-v3.css'
import '@/customer-v3/app.css'

export function CustomerV3Shell() {
  const { t } = useTranslation('v3')
  const { user } = useAuth()
  const notifications = useNotifications(user?.id)

  const destinations = [
    { to: V3_ROUTES.home, label: t('app.nav.home'), icon: HomeIcon, end: true },
    { to: V3_ROUTES.marketplace, label: t('app.nav.marketplace'), icon: CompassIcon },
    { to: V3_ROUTES.book, label: t('app.nav.book'), icon: ClippersIcon },
    { to: V3_ROUTES.appointments, label: t('app.nav.appointments'), icon: CalendarIcon },
    { to: V3_ROUTES.profile, label: t('app.nav.profile'), icon: PersonIcon },
  ]

  return (
    <div className="v3a-shell" data-fu-v3>
      <header className="v3a-topbar">
        <div className="v3a-topbar-inner">
          <Link to={V3_ROUTES.home} className="v3a-brand">
            <FadeUpMark />
            FadeUp
          </Link>
          <nav className="v3a-desktop-nav" aria-label={t('app.nav.label')}>
            {destinations.map((destination) => (
              <NavLink key={destination.to} to={destination.to} end={destination.end}>
                {destination.label}
              </NavLink>
            ))}
          </nav>
          <div className="v3a-top-actions">
            <Link
              to={V3_ROUTES.profile}
              className="v3a-icon-btn v3-press"
              aria-label={t('app.nav.notifications')}
            >
              <BellIcon />
              {notifications.unreadCount > 0 ? (
                <span className="v3a-badge" aria-hidden="true">
                  {notifications.unreadCount > 9 ? '9+' : notifications.unreadCount}
                </span>
              ) : null}
            </Link>
          </div>
        </div>
      </header>

      <main className="v3a-main">
        <Outlet />
      </main>

      <nav className="v3a-tabbar" aria-label={t('app.nav.label')}>
        {destinations.map((destination) => {
          const Icon = destination.icon
          return (
            <NavLink key={destination.to} to={destination.to} end={destination.end} className="v3a-tab v3-press">
              <Icon />
              {destination.label}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}

/* Outline iconography — 24px grid, 1.5px stroke, drawn for FadeUp. */

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z" strokeLinejoin="round" />
    </svg>
  )
}

function CompassIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" />
      <path d="m15 9-1.8 4.2L9 15l1.8-4.2L15 9Z" strokeLinejoin="round" />
    </svg>
  )
}

function ClippersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="8" y="7.5" width="8" height="12" rx="2" />
      <path d="M9 7.5V5.75A1.75 1.75 0 0 1 10.75 4h2.5A1.75 1.75 0 0 1 15 5.75V7.5M9.75 4v-1.5M12 4v-1.5M14.25 4v-1.5" strokeLinecap="round" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
      <path d="M4 10h16M8.5 3.5v3.5m7-3.5v3.5" strokeLinecap="round" />
    </svg>
  )
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5c1.6-3.2 4-4.5 7-4.5s5.4 1.3 7 4.5" strokeLinecap="round" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M6 10a6 6 0 0 1 12 0c0 3 .8 4.6 1.6 5.6a.6.6 0 0 1-.47.98H4.87a.6.6 0 0 1-.47-.98C5.2 14.6 6 13 6 10Z" strokeLinejoin="round" />
      <path d="M10 19.5a2.1 2.1 0 0 0 4 0" strokeLinecap="round" />
    </svg>
  )
}
