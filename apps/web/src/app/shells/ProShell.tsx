import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { useApplySurfaceTheme } from '@/shared/theme/useTheme'
import { useRealtimeStatus } from '@/shared/realtime/RealtimeProvider'
import { ShellErrorBoundary } from '@/shared/ui/ErrorBoundary'
import { Sheet } from '@/shared/ui/Sheet'
import { IconButton } from '@/shared/ui/IconButton'
import { Spinner } from '@/shared/ui/Spinner'
import {
  IconAnalytics,
  IconCalendar,
  IconClients,
  IconHome,
  IconLocation,
  IconMenu,
  IconPending,
  IconQueue,
  IconServices,
  IconSettings,
  IconTeam,
} from '@/shared/ui/icons'
import { useProEntitlements, useProOrganization } from '@/features/pro/api/organization'

interface ProNavItem {
  to: string
  labelKey: string
  icon: React.ComponentType<{ className?: string }>
  end?: boolean
  /** Masqué pour un `solo_professional`. */
  requiresTeam?: boolean
  /** Clé RÉELLE de `commercial_capabilities` — jamais inventée. */
  capability?: string
}

const PRO_NAV: ProNavItem[] = [
  { to: '/dashboard', labelKey: 'nav.pro.today', icon: IconHome, end: true },
  { to: '/dashboard/agenda', labelKey: 'nav.pro.agenda', icon: IconCalendar, capability: 'booking' },
  { to: '/dashboard/requests', labelKey: 'nav.pro.requests', icon: IconPending, capability: 'booking' },
  { to: '/dashboard/queue', labelKey: 'nav.pro.queue', icon: IconQueue, capability: 'liveQueue' },
  { to: '/dashboard/catalog', labelKey: 'nav.pro.catalog', icon: IconServices, capability: 'services' },
  { to: '/dashboard/clients', labelKey: 'nav.pro.clients', icon: IconClients, capability: 'customers' },
  { to: '/dashboard/team', labelKey: 'nav.pro.team', icon: IconTeam, requiresTeam: true, capability: 'team' },
  { to: '/dashboard/insights', labelKey: 'nav.pro.insights', icon: IconAnalytics },
  { to: '/dashboard/settings', labelKey: 'nav.pro.settings', icon: IconSettings },
]

function ConnectionDot() {
  const { t } = useTranslation('v2')
  const { status } = useRealtimeStatus()
  const label =
    status === 'live' ? t('nav.connection.live') : status === 'offline' ? t('nav.connection.offline') : t('nav.connection.reconnecting')
  return (
    <span className="inline-flex items-center gap-1.5 text-fu-xs text-[var(--fu-text-secondary)]">
      <span
        aria-hidden="true"
        className={cn(
          'size-2 rounded-[var(--radius-avatar)]',
          status === 'live' ? 'bg-[var(--fu-state-ok)]' : 'bg-[var(--fu-state-neutral)]',
        )}
      />
      {label}
    </span>
  )
}

function ProNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation('v2')
  const { organization } = useProOrganization()
  const { entitlements, loading } = useProEntitlements(organization?.organizationId ?? null)

  if (loading) {
    return (
      <div className="flex justify-center p-6">
        <Spinner announce />
      </div>
    )
  }

  const capabilities = entitlements?.liveCapabilities ?? []
  const businessType = organization?.businessType ?? 'solo_professional'

  // Conditionnement DOUBLE : équipe ET capacité (`live_capabilities`).
  // Une capacité absente n'est PAS rendue — ni grisée, ni cadenassée,
  // aucune vente incitative dans le menu.
  const items = PRO_NAV.filter(
    (item) =>
      (!item.requiresTeam || businessType !== 'solo_professional') &&
      (!item.capability || capabilities.includes(item.capability)),
  )

  return (
    <nav aria-label={t('nav.platform.title')} className="flex flex-col gap-0.5 p-2">
      {items.map(({ to, labelKey, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end ?? false}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-fu-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]',
              isActive
                ? 'bg-[var(--fu-surface-hover)] font-semibold text-[var(--fu-text-primary)]'
                : 'text-[var(--fu-text-secondary)] hover:bg-[var(--fu-surface-subtle)] hover:text-[var(--fu-text-primary)]',
            )
          }
        >
          <Icon aria-hidden="true" className="size-4 shrink-0" />
          {t(labelKey)}
        </NavLink>
      ))}
    </nav>
  )
}

/**
 * Shell pro — sombre, dense. Barre latérale ≥ 1024 px, tiroir en dessous.
 * Affiche en permanence : organisation, lieu si multi-établissements,
 * indicateur de connexion realtime.
 */
export function ProShell() {
  useApplySurfaceTheme('pro')
  const { t } = useTranslation('v2')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { organization } = useProOrganization()

  const orgHeader = (
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-fu-sm font-semibold text-[var(--fu-text-primary)]">{organization?.name ?? '—'}</span>
      {organization && organization.locations.length > 1 && organization.locations[0] && (
        <span className="inline-flex items-center gap-1 truncate text-fu-xs text-[var(--fu-text-secondary)]">
          <IconLocation aria-hidden="true" className="size-3" />
          {organization.locations[0].name}
        </span>
      )}
    </div>
  )

  return (
    <ShellErrorBoundary>
      <div className="flex min-h-dvh bg-[var(--fu-canvas)] font-fu-sans text-[var(--fu-text-primary)]">
        {/* ≥ 1024 px : barre latérale permanente. */}
        <aside className="hidden w-60 shrink-0 flex-col border-e border-[var(--fu-border)] bg-[var(--fu-surface-subtle)] lg:flex">
          <div className="flex items-center gap-2.5 border-b border-[var(--fu-border)] p-4">
            <img src="/brand/fadeup-mark-primary.png" alt={t('common.brand.logoAlt')} className="size-8 shrink-0" />
            {orgHeader}
          </div>
          <div className="flex-1 overflow-y-auto">
            <ProNav />
          </div>
          <div className="border-t border-[var(--fu-border)] p-4">
            <ConnectionDot />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* < 1024 px : barre haute + tiroir. */}
          <header className="sticky top-0 z-[var(--fu-z-nav)] flex h-14 items-center justify-between gap-3 border-b border-[var(--fu-border)] bg-[var(--fu-canvas)] px-4 lg:hidden">
            <Sheet
              open={drawerOpen}
              onOpenChange={setDrawerOpen}
              title={organization?.name ?? t('common.brand.name')}
              trigger={
                <IconButton aria-label={t('nav.pro.openNav')}>
                  <IconMenu />
                </IconButton>
              }
            >
              <ProNav onNavigate={() => setDrawerOpen(false)} />
            </Sheet>
            {orgHeader}
            <ConnectionDot />
          </header>
          <main id="fu-main" className="min-w-0 flex-1">
            <Outlet />
          </main>
        </div>
      </div>
    </ShellErrorBoundary>
  )
}

// Export par défaut : la table de routes charge `m.default`, si bien que la
// CHAÎNE « ProShell » elle-même est absente du chunk d’entrée (P1b §15).
export default ProShell
