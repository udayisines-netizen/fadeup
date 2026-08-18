import { NavLink, Outlet } from 'react-router-dom'
import { Container } from '@/components/ui/container'
import { cn } from '@/lib/cn'

const OUTREACH_NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: '/platform/outreach/whatsapp', label: 'WhatsApp campaigns' },
  { to: '/platform/outreach/templates', label: 'Templates' },
  { to: '/platform/outreach/experiments', label: 'Experiments' },
  { to: '/platform/outreach/replies', label: 'Replies' },
]

/**
 * Shell for /platform/outreach — the approved-template outreach engine
 * (see db/migrations/20260818100100_prospect_outreach_whatsapp_ml.sql).
 *
 * Nested inside PlatformLayout, which already enforces RequirePlatformRole,
 * so every route here has an authenticated platform staff member. Pages
 * further gate write actions to platform_owner/platform_admin via
 * usePlatformRole(), and the database enforces the same boundary
 * independently — the UI gate is convenience, not security.
 *
 * Kept separate from /platform/acquisition because outreach is a distinct
 * operational surface: acquisition is about discovering and understanding
 * businesses, outreach is about contacting them, and the two have
 * different approval semantics.
 */
export function PlatformOutreachLayout() {
  return (
    <Container size="xl" className="py-8">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">Outreach</h1>
        <p className="mt-1 text-sm text-ink-500">
          Approved WhatsApp templates, campaigns, experiments and replies. All message copy is written and approved by
          an administrator — never generated.
        </p>
      </div>

      <nav aria-label="Outreach sections" className="fu-scroll-shadow-x mt-6 overflow-x-auto">
        <ul className="flex items-center gap-1 whitespace-nowrap border-b border-border">
          {OUTREACH_NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    '-mb-px inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium text-ink-500 transition-colors',
                    'hover:text-ink-950',
                    isActive && 'border-accent-600 text-ink-950',
                  )
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6">
        <Outlet />
      </div>
    </Container>
  )
}
