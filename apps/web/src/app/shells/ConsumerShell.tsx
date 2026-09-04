import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/shared/lib/cn'
import { notificationKeys, bookingKeys } from '@/shared/data/keys'
import { useSession } from '@/shared/hooks/useSession'
import { useApplySurfaceTheme } from '@/shared/theme/useTheme'
import { useChannel } from '@/shared/realtime/useChannel'
import { ShellErrorBoundary } from '@/shared/ui/ErrorBoundary'
import {
  IconAccount,
  IconBookings,
  IconFeed,
  IconHome,
  IconSearch,
} from '@/shared/ui/icons'
import { useBookingActivity } from '@/features/bookings/api/activity'
import { signOut } from '@/features/auth/api/auth'
import { IconButton } from '@/shared/ui/IconButton'
import { IconSignOut } from '@/shared/ui/icons'
import { LanguageSwitcher } from '@/shared/i18n/LanguageSwitcher'

/**
 * Shell consumer — clair, direction A. CINQ onglets, dans cet ordre :
 * Accueil · Recherche · Feed · Réservations · Compte. Book n'est JAMAIS un
 * onglet : c'est un CTA contextuel (StickyActionBar sur les surfaces de
 * conversion).
 */
interface ConsumerTab {
  to: string
  labelKey: string
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>
  end?: boolean
}

const TABS: readonly ConsumerTab[] = [
  { to: '/', labelKey: 'nav.tabs.home', icon: IconHome, end: true },
  { to: '/search', labelKey: 'nav.tabs.search', icon: IconSearch },
  { to: '/feed', labelKey: 'nav.tabs.feed', icon: IconFeed },
  { to: '/bookings', labelKey: 'nav.tabs.bookings', icon: IconBookings },
  { to: '/account', labelKey: 'nav.tabs.account', icon: IconAccount },
]

function NotificationsChannel({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  // Le canal de démonstration P1b : notifications → invalidation de clés.
  useChannel({
    name: `notifications:${userId}`,
    table: 'notifications',
    filter: `user_id=eq.${userId}`,
    onInsert: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.lists() })
      // Une notification de réservation rend les listes de réservations obsolètes.
      void queryClient.invalidateQueries({ queryKey: bookingKeys.all })
    },
    onReconnect: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.lists() })
    },
  })
  return null
}

export function ConsumerShell() {
  useApplySurfaceTheme('consumer')
  const { t } = useTranslation('v2')
  const { session, user } = useSession()
  const { hasActivity } = useBookingActivity()

  return (
    <ShellErrorBoundary>
      {session && user && <NotificationsChannel userId={user.id} />}
      <div className="flex min-h-dvh flex-col bg-[var(--fu-canvas)] font-fu-sans text-[var(--fu-text-primary)]">
        <a
          href="#fu-main"
          className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-[var(--fu-z-toast)] focus:rounded-[var(--radius-control)] focus:bg-[var(--fu-surface)] focus:p-3 focus:ring-2 focus:ring-[var(--fu-focus)]"
        >
          {t('common.a11y.skipToContent')}
        </a>

        {/* ≥ 768 px : barre haute composée — logo, navigation, langue, compte. */}
        <header className="sticky top-0 z-[var(--fu-z-nav)] hidden border-b border-[var(--fu-border)] bg-[var(--fu-canvas)] md:block">
          <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-8 px-6">
            <NavLink to="/" className="flex shrink-0 items-center gap-2.5">
              <img src="/brand/fadeup-mark-primary.png" alt="" className="size-8" />
              <span className="text-fu-base font-semibold tracking-tight">{t('common.brand.name')}</span>
            </NavLink>
            <nav aria-label={t('common.brand.name')} className="flex flex-1 items-center gap-1">
              {TABS.map(({ to, labelKey, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end ?? false}
                  className={({ isActive }) =>
                    cn(
                      'relative flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-fu-sm',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]',
                      isActive
                        ? 'font-semibold text-[var(--fu-text-primary)]'
                        : 'text-[var(--fu-text-secondary)] hover:text-[var(--fu-text-primary)]',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {t(labelKey)}
                      {isActive && (
                        <span aria-hidden="true" className="absolute inset-x-3 bottom-1 h-0.5 bg-[var(--fu-accent)]" />
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
            <LanguageSwitcher />
            {session && (
              <IconButton aria-label={t('common.action.signOut')} onClick={() => void signOut()}>
                <IconSignOut />
              </IconButton>
            )}
          </div>
        </header>

        <main id="fu-main" className="w-full flex-1 pb-24 md:pb-8">
          <Outlet />
        </main>

        {/* < 768 px : barre basse fixe, cinq onglets, cibles 44 px. */}
        <nav
          aria-label={t('common.brand.name')}
          className={cn(
            'fixed start-0 end-0 bottom-0 z-[var(--fu-z-nav)] border-t border-[var(--fu-border)] bg-[var(--fu-canvas)] md:hidden',
            'pb-[env(safe-area-inset-bottom)]',
          )}
        >
          <div className="flex">
            {TABS.map(({ to, labelKey, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end ?? false}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--fu-focus)]',
                    // Couleur ET graisse : l'état actif n'est jamais porté par
                    // la seule couleur. Le vert texte est le vert profond (AA).
                    isActive ? 'font-semibold text-[var(--fu-accent-text)]' : 'text-[var(--fu-text-secondary)]',
                  )
                }
              >
                <span className="relative inline-flex">
                  <Icon aria-hidden="true" className="size-5" />
                  {to === '/bookings' && hasActivity && (
                    <span
                      role="status"
                      aria-label={t('nav.consumer.bookingsBadge')}
                      className="absolute -end-1 -top-0.5 size-2 rounded-[var(--radius-avatar)] bg-[var(--fu-accent)]"
                    />
                  )}
                </span>
                <span className="text-fu-xs">{t(labelKey)}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </ShellErrorBoundary>
  )
}
