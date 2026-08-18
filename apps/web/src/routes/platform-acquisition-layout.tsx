import { NavLink, Outlet } from 'react-router-dom'
import { Container } from '@/components/ui/container'
import { cn } from '@/lib/cn'

const ACQUISITION_NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: '/platform/acquisition', label: 'Overview', end: true },
  { to: '/platform/acquisition/search', label: 'Search' },
  { to: '/platform/acquisition/map', label: 'Map' },
  { to: '/platform/acquisition/prospects', label: 'Prospects' },
  { to: '/platform/acquisition/competitors', label: 'Competitors' },
  { to: '/platform/acquisition/barbershops', label: 'Barbershops' },
  { to: '/platform/acquisition/independent-barbers', label: 'Independent barbers' },
  { to: '/platform/acquisition/pipeline', label: 'Pipeline' },
  { to: '/platform/acquisition/duplicates', label: 'Duplicates' },
  { to: '/platform/acquisition/jobs', label: 'Jobs' },
  { to: '/platform/acquisition/sources', label: 'Sources' },
  { to: '/platform/acquisition/api-usage', label: 'API usage' },
  { to: '/platform/acquisition/suppressions', label: 'Suppressions' },
]

/**
 * Shell for everything under /platform/acquisition — the Prospect Worker V2
 * frontend (see db/migrations/20260811150100_prospect_acquisition_schema.sql
 * and 20260811150200_prospect_job_queue.sql). Nested inside PlatformLayout,
 * which already enforces RequirePlatformRole, so every route here already
 * has an authenticated platform staff member; individual pages further gate
 * write actions to platform_owner/platform_admin via usePlatformRole().
 * Route-driven sub-nav (not the local-state `Tabs` primitive) since each
 * section is its own bookmarkable/linkable URL, matching how deep-linking
 * from e.g. the Overview page's "top cities" or Pipeline's per-stage links
 * needs to work.
 */
export function PlatformAcquisitionLayout() {
  return (
    <Container size="xl" className="py-8">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">Acquisition</h1>
        <p className="mt-1 text-sm text-ink-500">Prospect discovery, enrichment, scoring, and sales pipeline.</p>
      </div>

      <nav aria-label="Acquisition sections" className="fu-scroll-shadow-x mt-6 overflow-x-auto">
        <ul className="flex items-center gap-1 whitespace-nowrap border-b border-border">
          {ACQUISITION_NAV_ITEMS.map((item) => (
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
