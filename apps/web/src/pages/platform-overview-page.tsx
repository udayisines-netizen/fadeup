import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { usePlatformRole } from '@/routes/require-platform-role'

const ROLE_LABELS: Record<string, string> = {
  platform_owner: 'Platform Owner',
  platform_admin: 'Platform Admin',
  platform_support: 'Platform Support',
}

/**
 * Minimal /platform landing — proves the bootstrap → login → authorization
 * chain end to end. Organizations/Users/Team/Subscriptions/Audit/Tenant
 * Explorer/Support View (CLAUDE.md's Platform Control Center) are Phase D,
 * built on top of this same RequirePlatformRole shell.
 */
export function PlatformOverviewPage() {
  const role = usePlatformRole()

  return (
    <Container size="lg" className="py-8">
      <h1 className="text-xl font-semibold text-ink-950">Platform overview</h1>
      <p className="mt-1 text-sm text-ink-500">
        Signed in as <Badge variant="accent">{ROLE_LABELS[role] ?? role}</Badge>
      </p>
    </Container>
  )
}
