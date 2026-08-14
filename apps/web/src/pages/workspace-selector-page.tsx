import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth-context'
import { useOwnPlatformRole } from '@/lib/queries/platform'
import { useMyMemberships } from '@/lib/queries/memberships'
import { useMyProfessionalApplication } from '@/lib/queries/professional-applications'
import { setStoredOrganizationId } from '@/lib/current-organization'
import { PageSpinner } from '@/components/ui/spinner'
import { Container } from '@/components/ui/container'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { MembershipRole } from '@/lib/types'

const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  receptionist: 'Receptionist',
  barber: 'Barber',
}

/**
 * /workspace — the single, central post-login landing every login/signup
 * form (except /platform/login, which has no ambiguity to resolve) routes
 * to by default. CLAUDE.md section 16: "A user belonging to multiple
 * organizations/roles: show secure workspace selector. Do not use
 * user-controlled URL parameters to decide authorization." — this page is
 * exactly that: it resolves purely from the caller's OWN session
 * (platform_members/memberships, both RLS-scoped to the caller), never
 * from a query param, and auto-forwards silently in the common
 * single-context case so most users never see it at all.
 */
export function WorkspaceSelectorPage() {
  const { user, loading: authLoading } = useAuth()
  const platformRoleQuery = useOwnPlatformRole(user?.id)
  const membershipsQuery = useMyMemberships(user?.id)
  const applicationQuery = useMyProfessionalApplication(Boolean(user))

  if (authLoading || platformRoleQuery.isPending || membershipsQuery.isPending || applicationQuery.isPending) {
    return <PageSpinner label="Loading your workspaces" />
  }

  const platformRole = platformRoleQuery.data
  const memberships = membershipsQuery.data ?? []
  const application = applicationQuery.data
  const contextCount = (platformRole ? 1 : 0) + memberships.length

  if (contextCount === 0) {
    // An outstanding or refused professional application outranks the
    // signup-intent guess: this account applied, and the honest destination
    // is its status — not the "create your shop" flow, which the database
    // would refuse anyway (create_organization rejects pending/rejected
    // applicants), and not the customer app.
    if (application && application.status !== 'approved') {
      return <Navigate to="/pro/application" replace />
    }

    // Brand-new account with no workspace yet. A signup made through
    // /register has no shop-creation step; everything else (existing
    // accounts predating signup_intent, and /pro/register) keeps the
    // historical "go create your shop" default.
    const signupIntent = (user?.user_metadata as { signup_intent?: string } | undefined)?.signup_intent
    return <Navigate to={signupIntent === 'customer' ? '/app/customer' : '/onboarding'} replace />
  }

  if (contextCount === 1) {
    if (platformRole) return <Navigate to="/platform" replace />
    setStoredOrganizationId(memberships[0].organizationId)
    return <Navigate to="/app" replace />
  }

  return (
    <Container size="sm" className="py-16">
      <h1 className="text-xl font-semibold text-ink-950">Choose a workspace</h1>
      <p className="mt-1 text-sm text-ink-500">You have access to more than one. Pick where to go.</p>

      <div className="mt-6 flex flex-col gap-3">
        {platformRole ? (
          <WorkspaceCard
            title="FadeUp Platform"
            subtitle="Platform administration"
            badge="Platform"
            href="/platform"
          />
        ) : null}
        {memberships.map((membership) => (
          <WorkspaceCard
            key={membership.id}
            title={membership.organizationName}
            subtitle={ROLE_LABELS[membership.role]}
            badge={ROLE_LABELS[membership.role]}
            href="/app"
            onSelect={() => setStoredOrganizationId(membership.organizationId)}
          />
        ))}
      </div>
    </Container>
  )
}

function WorkspaceCard({
  title,
  subtitle,
  badge,
  href,
  onSelect,
}: {
  title: string
  subtitle: string
  badge: string
  href: string
  onSelect?: () => void
}) {
  return (
    <Link to={href} onClick={onSelect} className="block">
      <Card className="transition-colors hover:border-border-strong">
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div>
            <p className="font-medium text-ink-950">{title}</p>
            <p className="text-sm text-ink-500">{subtitle}</p>
          </div>
          <Badge variant="accent">{badge}</Badge>
        </CardContent>
      </Card>
    </Link>
  )
}
