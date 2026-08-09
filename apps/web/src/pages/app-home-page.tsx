import { Link } from 'react-router-dom'
import { useCurrentOrg } from '@/lib/current-org-context'
import { cn } from '@/lib/cn'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  receptionist: 'Receptionist',
  barber: 'Barber',
}

// Full dashboards land in LOT 39-41 — this is intentionally a minimal
// placeholder home that establishes the current-organization concept.
export function AppHomePage() {
  const { memberships, currentMembership, setCurrentOrganizationId } = useCurrentOrg()

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="rounded-lg border border-neutral-200 bg-white p-6">
        <h1 className="text-xl font-semibold text-neutral-900">
          {currentMembership?.organizationName ?? 'Your shop'}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          You&apos;re signed in as{' '}
          <span className="font-medium text-neutral-700">
            {currentMembership ? ROLE_LABELS[currentMembership.role] : 'a member'}
          </span>
          . Dashboards, scheduling and queue tools land in later lots.
        </p>
      </div>

      {memberships.length > 1 ? (
        <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-neutral-900">Switch organization</h2>
          <p className="mt-1 text-sm text-neutral-500">
            You belong to {memberships.length} organizations. Choose which one you&apos;re working in.
          </p>
          <ul className="mt-4 flex flex-col gap-2">
            {memberships.map((membership) => {
              const isCurrent = membership.organizationId === currentMembership?.organizationId
              return (
                <li key={membership.organizationId}>
                  <button
                    type="button"
                    onClick={() => setCurrentOrganizationId(membership.organizationId)}
                    aria-pressed={isCurrent}
                    className={cn(
                      'flex w-full min-h-11 items-center justify-between rounded-md border px-4 py-2 text-left text-sm',
                      isCurrent
                        ? 'border-neutral-900 bg-neutral-900 text-white'
                        : 'border-neutral-200 text-neutral-700 hover:bg-neutral-50',
                    )}
                  >
                    <span>{membership.organizationName}</span>
                    <span className={isCurrent ? 'text-neutral-300' : 'text-neutral-400'}>
                      {ROLE_LABELS[membership.role]}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {currentMembership && ['owner', 'manager'].includes(currentMembership.role) ? (
        <div className="mt-6">
          <Link
            to="/app/team"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
          >
            Manage team
          </Link>
        </div>
      ) : null}
    </main>
  )
}
