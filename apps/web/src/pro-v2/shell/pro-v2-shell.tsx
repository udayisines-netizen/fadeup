import { useMemo, useState } from 'react'
import { NavLink, Outlet, useOutletContext } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { LanguageMenu } from '@/customer-v2/ui/language-menu'
import { useResolvedOrganization } from '@/lib/queries/memberships'
import type { MembershipRole } from '@/lib/types'
import { useOrgLocations, type Location } from '@/lib/queries/locations'
import { FadeUpLockup } from '@/components/brand/fadeup-mark'
import { Notice } from '@/customer-v2/ui/notice'
import { PRO_V2_ROUTES } from '@/pro-v2/routes'

/**
 * The greenfield professional shell — LIGHT, on the same v2 foundation as the
 * customer product, deliberately not the R5 dark cockpit.
 *
 * ============================================================================
 * ONE SHELL FOR THREE SHAPES OF BUSINESS
 * ============================================================================
 *
 * An independent, a barbershop and a multi-location organization all open the
 * same cockpit; what differs is SCOPE. The shell resolves the active
 * organization through the existing membership chain (stored preference →
 * first membership) and, when the organization runs more than one location,
 * exposes the location scope the blueprint requires:
 *
 *   All locations
 *   Paris République
 *   Créteil …
 *
 * Scope is held here and handed to every page through the outlet context, so
 * "which slice of the business am I looking at" is decided exactly once. A
 * single-location business never sees the selector at all — the product must
 * never suggest 1 organization = 1 location, but it also must not make a solo
 * barber pick between one option.
 *
 * ============================================================================
 * PERMISSIONS ARE THE BACKEND'S
 * ============================================================================
 *
 * The shell renders whatever the membership row says the user is and queries
 * through the same org-scoped contracts the legacy cockpit uses; RLS decides
 * what each role can actually read. No client-side role table is invented.
 */

export interface ProScope {
  organizationId: string
  organizationName: string
  role: MembershipRole
  /** null = all locations. */
  locationId: string | null
  locations: Location[]
}

export function useProScope(): ProScope {
  return useOutletContext<ProScope>()
}

export function ProV2Shell() {
  const { t } = useTranslation()
  const { user } = useAuth()

  const { membershipsQuery, membership, organizationId } = useResolvedOrganization(user?.id)
  const locationsQuery = useOrgLocations(organizationId ?? undefined)
  const [locationId, setLocationId] = useState<string | null>(null)

  const locations = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data])
  const activeLocation = locations.find((entry) => entry.id === locationId) ?? null

  const navItems = [
    { to: PRO_V2_ROUTES.dashboard, label: t('app:v2pro.nav.dashboard'), end: true },
    { to: PRO_V2_ROUTES.calendar, label: t('app:v2pro.nav.calendar') },
    { to: PRO_V2_ROUTES.customers, label: t('app:v2pro.nav.customers') },
    { to: PRO_V2_ROUTES.analytics, label: t('app:v2pro.nav.analytics') },
    { to: PRO_V2_ROUTES.retention, label: t('app:v2pro.nav.retention') },
    { to: PRO_V2_ROUTES.profile, label: t('app:v2pro.nav.profile') },
  ]

  if (!membershipsQuery.isPending && (!membership || !organizationId)) {
    return (
      <div data-fu-v2 className="min-h-svh bg-v2-ground p-6 text-v2-ink">
        <div className="mx-auto max-w-[30rem]">
          <Notice
            tone="empty"
            title={t('app:v2pro.noWorkspaceTitle')}
            body={t('app:v2pro.noWorkspaceBody')}
            actionLabel={null}
            onAction={null}
          />
        </div>
      </div>
    )
  }

  if (!membership || !organizationId) {
    return <div data-fu-v2 className="min-h-svh bg-v2-ground" />
  }

  const scope: ProScope = {
    organizationId,
    organizationName: membership.organizationName,
    role: membership.role,
    locationId,
    locations,
  }

  return (
    <div data-fu-v2 className="flex min-h-svh flex-col bg-v2-ground text-v2-ink">
      <header className="sticky top-0 z-20 border-b border-v2-hairline bg-v2-ground/92 backdrop-blur-sm">
        <div className="mx-auto flex h-13 w-full max-w-[80rem] items-center gap-3 px-4 sm:px-6">
          <span className="flex shrink-0 items-center gap-2">
            <FadeUpLockup tone="light" className="text-[0.9375rem]" />
            <span className="rounded-v2-1 bg-v2-fill px-1.5 py-0.5 text-v2-caption font-semibold text-v2-ink-soft">
              {t('app:v2pro.proBadge')}
            </span>
          </span>

          <p className="min-w-0 flex-1 truncate text-v2-meta font-medium text-v2-ink-soft">
            <bdi>{membership.organizationName}</bdi>
          </p>

          {/* Location scope — only when there is genuinely more than one. */}
          {locations.length > 1 ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="v2-press inline-flex h-11 max-w-[14rem] items-center rounded-v2-2">
                <span className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-v2-2 border border-v2-hairline bg-v2-paper ps-2.5 pe-2 text-v2-meta font-medium text-v2-ink">
                  <span className="truncate">
                    {activeLocation ? <bdi>{activeLocation.name}</bdi> : t('app:v2pro.allLocations')}
                  </span>
                  <ChevronDown
                    className="h-3.5 w-3.5 shrink-0 text-v2-ink-mute"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </span>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  data-fu-v2
                  align="end"
                  sideOffset={6}
                  className="v2-plate z-40 min-w-[14rem] py-1 text-v2-ink"
                >
                  <DropdownMenu.RadioGroup
                    value={locationId ?? 'all'}
                    onValueChange={(value) => setLocationId(value === 'all' ? null : value)}
                  >
                    <ScopeItem value="all" label={t('app:v2pro.allLocations')} />
                    {locations.map((entry) => (
                      <ScopeItem key={entry.id} value={entry.id} label={entry.name} />
                    ))}
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : null}

          <LanguageMenu />
        </div>

        <nav
          aria-label={t('app:v2pro.navLabel')}
          className="mx-auto flex w-full max-w-[80rem] gap-1 overflow-x-auto px-4 pb-2 sm:px-6"
        >
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className="v2-press inline-flex h-11 shrink-0 items-center rounded-v2-2 px-3 text-v2-meta font-medium text-v2-ink-soft hover:bg-v2-fill hover:text-v2-ink aria-[current=page]:bg-v2-green-tint aria-[current=page]:font-semibold aria-[current=page]:text-v2-green-ink"
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[80rem] flex-1 px-4 py-4 sm:px-6 lg:py-6">
        <Outlet context={scope} />
      </main>
    </div>
  )
}

function ScopeItem({ value, label }: { value: string; label: string }) {
  return (
    <DropdownMenu.RadioItem
      value={value}
      className="flex min-h-11 cursor-pointer select-none items-center gap-2.5 px-3 py-2 text-v2-meta outline-none data-[highlighted]:bg-v2-fill"
    >
      <span className="flex-1 truncate">
        <bdi>{label}</bdi>
      </span>
      <DropdownMenu.ItemIndicator>
        <Check className="h-4 w-4 shrink-0 text-v2-green" strokeWidth={2.2} aria-hidden="true" />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  )
}
