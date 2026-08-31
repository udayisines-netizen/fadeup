/**
 * FadeUp V3 — professional shell: a serious operating environment on the
 * Clean Data Canvas (BG-07).
 *
 * One shell for three shapes of business. Scope (organization → location) is
 * resolved exactly once — stored preference → first membership, location
 * selector only when more than one genuinely exists — and handed to every
 * page through the outlet context. Role gates mirror RLS; no client role
 * table is invented. The scope logic is carried over from the audited R5R
 * shell verbatim; the chrome is V3.
 */
import { useMemo, useState } from 'react'
import { NavLink, Outlet, useOutletContext } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/lib/auth-context'
import { useResolvedOrganization } from '@/lib/queries/memberships'
import type { MembershipRole } from '@/lib/types'
import { useOrgLocations, type Location } from '@/lib/queries/locations'
import { FadeUpMark } from '@/components/brand/fadeup-mark'
import { changeLocale } from '@/i18n'
import { SUPPORTED_LOCALES, LOCALE_LABELS, isSupportedLocale } from '@/lib/locale'
import { PRO_V3_ROUTES } from '@/pro-v3/routes'

import '@/ui-v3/ui-v3.css'
import '@/customer-v3/app.css'
import '@/pro-v3/pro-v3.css'

export interface ProScope {
  organizationId: string
  organizationName: string
  role: MembershipRole
  /** null = all locations. */
  locationId: string | null
  locations: Location[]
}

export function useProV3Scope(): ProScope {
  return useOutletContext<ProScope>()
}

export function ProV3Shell() {
  const { t, i18n } = useTranslation('v3')
  const { user } = useAuth()

  const { membershipsQuery, membership, organizationId } = useResolvedOrganization(user?.id)
  const locationsQuery = useOrgLocations(organizationId ?? undefined)
  const [locationId, setLocationId] = useState<string | null>(null)

  const locations = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data])

  const navItems = [
    { to: PRO_V3_ROUTES.dashboard, label: t('pro.nav.dashboard'), end: true },
    { to: PRO_V3_ROUTES.calendar, label: t('pro.nav.calendar') },
    { to: PRO_V3_ROUTES.customers, label: t('pro.nav.customers') },
    { to: PRO_V3_ROUTES.analytics, label: t('pro.nav.analytics') },
    { to: PRO_V3_ROUTES.retention, label: t('pro.nav.retention') },
    { to: PRO_V3_ROUTES.profile, label: t('pro.nav.profile') },
  ]

  if (!membershipsQuery.isPending && (!membership || !organizationId)) {
    return (
      <div data-fu-v3 className="v3pro-shell">
        <div className="v3a-empty" style={{ margin: 'auto' }}>
          <p className="v3a-empty-title">{t('pro.noWorkspaceTitle')}</p>
          <p className="v3-meta">{t('pro.noWorkspaceBody')}</p>
        </div>
      </div>
    )
  }

  if (!membership || !organizationId) {
    return <div data-fu-v3 className="v3pro-shell" />
  }

  const scope: ProScope = {
    organizationId,
    organizationName: membership.organizationName,
    role: membership.role,
    locationId,
    locations,
  }

  return (
    <div data-fu-v3 className="v3pro-shell">
      <header className="v3pro-topbar">
        <div className="v3pro-topbar-inner">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <FadeUpMark />
            <span className="v3pro-badge">{t('pro.badge')}</span>
          </span>
          <p className="v3pro-org">
            <bdi>{membership.organizationName}</bdi>
          </p>
          {locations.length > 1 ? (
            <select
              className="v3pro-scope"
              aria-label={t('pro.scopeLabel')}
              value={locationId ?? 'all'}
              onChange={(event) =>
                setLocationId(event.target.value === 'all' ? null : event.target.value)
              }
            >
              <option value="all">{t('pro.allLocations')}</option>
              {locations.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          ) : null}
          <select
            className="v3pro-scope"
            aria-label={t('landing.nav.language')}
            value={i18n.language}
            onChange={(event) => {
              const next = event.target.value
              if (isSupportedLocale(next)) void changeLocale(next)
            }}
          >
            {SUPPORTED_LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {LOCALE_LABELS[locale]}
              </option>
            ))}
          </select>
        </div>
        <nav className="v3pro-nav" aria-label={t('pro.navLabel')}>
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="v3pro-main">
        <Outlet context={scope} />
      </main>
    </div>
  )
}
