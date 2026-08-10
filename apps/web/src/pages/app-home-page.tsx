import { Link } from 'react-router-dom'
import { useCurrentOrg } from '@/lib/current-org-context'
import { Container } from '@/components/ui/container'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
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
    <Container size="lg" className="py-8">
      <Card>
        <CardHeader>
          <CardTitle>{currentMembership?.organizationName ?? 'Your shop'}</CardTitle>
          <CardDescription>
            You&apos;re signed in as{' '}
            <Badge variant="accent">{currentMembership ? ROLE_LABELS[currentMembership.role] : 'a member'}</Badge>
            . Dashboards, scheduling and queue tools land in later lots.
          </CardDescription>
        </CardHeader>
      </Card>

      {memberships.length > 1 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-sm">Switch organization</CardTitle>
            <CardDescription>
              You belong to {memberships.length} organizations. Choose which one you&apos;re working in.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="flex flex-col gap-2">
              {memberships.map((membership) => {
                const isCurrent = membership.organizationId === currentMembership?.organizationId
                return (
                  <li key={membership.organizationId}>
                    <button
                      type="button"
                      onClick={() => setCurrentOrganizationId(membership.organizationId)}
                      aria-pressed={isCurrent}
                      className={cn(
                        'flex min-h-11 w-full items-center justify-between rounded-md border px-4 py-2 text-left text-sm transition-colors',
                        isCurrent
                          ? 'border-ink-950 bg-ink-950 text-on-accent'
                          : 'border-border text-ink-700 hover:bg-paper-50',
                      )}
                    >
                      <span className="truncate">{membership.organizationName}</span>
                      <span className={isCurrent ? 'text-ink-300' : 'text-ink-500'}>
                        {ROLE_LABELS[membership.role]}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {currentMembership && ['owner', 'manager'].includes(currentMembership.role) ? (
        <div className="mt-6">
          <Link to="/app/team" className={buttonVariants({ variant: 'secondary' })}>
            Manage team
          </Link>
        </div>
      ) : null}
    </Container>
  )
}
