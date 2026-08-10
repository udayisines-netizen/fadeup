import { createContext, useContext, type ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth-context'
import { useOwnPlatformRole } from '@/lib/queries/platform'
import { PageSpinner } from '@/components/ui/spinner'
import { Container } from '@/components/ui/container'
import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import type { PlatformRole } from '@/lib/types'

const PlatformRoleContext = createContext<PlatformRole | null>(null)

/** The current user's platform role. Only valid inside RequirePlatformRole — that's what guarantees it's non-null. */
export function usePlatformRole(): PlatformRole {
  const role = useContext(PlatformRoleContext)
  if (!role) throw new Error('usePlatformRole must be used within RequirePlatformRole')
  return role
}

/**
 * Gates everything under /platform. Two checks, in order: (1) an
 * authenticated Supabase session at all — same as RequireAuth elsewhere —
 * then (2) a public.platform_members row for that user. Deliberately does
 * NOT redirect a signed-in-but-not-platform-staff user into /app: someone
 * hitting /platform by mistake with an ordinary customer/pro account should
 * see a clear "you don't have platform access" state, not get silently
 * dropped into an unrelated part of the product.
 */
export function RequirePlatformRole({ children }: { children: ReactNode }) {
  const { session, user, loading: authLoading } = useAuth()
  const location = useLocation()
  const roleQuery = useOwnPlatformRole(user?.id)

  if (authLoading) {
    return <PageSpinner label="Checking your session" />
  }

  if (!session) {
    const redirectTarget = `${location.pathname}${location.search}`
    return <Navigate to={`/platform/login?redirect=${encodeURIComponent(redirectTarget)}`} replace />
  }

  if (roleQuery.isPending) {
    return <PageSpinner label="Checking platform access" />
  }

  if (roleQuery.isError || !roleQuery.data) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-paper-50 p-8">
        <Container size="sm">
          <Alert variant="error">
            {roleQuery.isError
              ? `Couldn't check platform access: ${roleQuery.error.message}`
              : "This account doesn't have FadeUp platform access."}
          </Alert>
          <Link to="/" className={buttonVariants({ variant: 'secondary' }, 'mt-4 w-full')}>
            Back to FadeUp
          </Link>
        </Container>
      </main>
    )
  }

  return <PlatformRoleContext.Provider value={roleQuery.data}>{children}</PlatformRoleContext.Provider>
}
