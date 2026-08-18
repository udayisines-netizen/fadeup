import { NavLink, Outlet } from 'react-router-dom'
import { Container } from '@/components/ui/container'
import { cn } from '@/lib/cn'

const DATA_SCIENCE_NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: '/platform/data-science', label: 'Models', end: true },
  { to: '/platform/data-science/dataset', label: 'Dataset & predictions' },
  { to: '/platform/data-science/performance', label: 'Performance' },
]

/**
 * Shell for /platform/data-science — the model registry, dataset health,
 * prediction audit trail and template/funnel performance.
 *
 * Nested inside PlatformLayout (RequirePlatformRole already applied).
 * Model ARTIFACTS are never reachable from here: the registry surfaces
 * metadata and metrics, never the file itself.
 */
export function PlatformDataScienceLayout() {
  return (
    <Container size="xl" className="py-8">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">Data science</h1>
        <p className="mt-1 text-sm text-ink-500">
          Model registry, training datasets, prediction audit trail, and what is actually deciding template selection
          right now.
        </p>
      </div>

      <nav aria-label="Data science sections" className="fu-scroll-shadow-x mt-6 overflow-x-auto">
        <ul className="flex items-center gap-1 whitespace-nowrap border-b border-border">
          {DATA_SCIENCE_NAV_ITEMS.map((item) => (
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
