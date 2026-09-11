import { createContext, useContext, type ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth-context'
import { useMyPlatformPermissions, useOwnPlatformRole } from '@/lib/queries/platform'
import { PageSpinner } from '@/components/ui/spinner'
import { Container } from '@/components/ui/container'
import { Alert } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import type { PlatformPermission, PlatformRole } from '@/lib/types'
import { useTranslation } from 'react-i18next'

const PlatformRoleContext = createContext<PlatformRole | null>(null)
const PlatformPermissionsContext = createContext<readonly PlatformPermission[] | null>(null)

/** The current user's platform role. Only valid inside RequirePlatformRole — that's what guarantees it's non-null. */
export function usePlatformRole(): PlatformRole {
  const role = useContext(PlatformRoleContext)
  if (!role) throw new Error('usePlatformRole must be used within RequirePlatformRole')
  return role
}

/**
 * Les droits internes de l'utilisateur courant (PLAT-1).
 *
 * LE FRONTEND CONDITIONNE, IL N'AUTORISE PAS. Ce que rend `can()` décide de
 * ce qui est RENDU — jamais de ce qui est permis : chaque RPC repose la
 * question côté serveur et refuse même appelée directement. Une capacité
 * absente ne rend rien du tout : ni bouton grisé, ni cadenas.
 */
export function usePlatformPermissions(): {
  permissions: readonly PlatformPermission[]
  can: (permission: PlatformPermission) => boolean
} {
  const permissions = useContext(PlatformPermissionsContext)
  if (!permissions) throw new Error('usePlatformPermissions must be used within RequirePlatformRole')
  return { permissions, can: (permission) => permissions.includes(permission) }
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
  const { t } = useTranslation()
  const { session, user, loading: authLoading } = useAuth()
  const location = useLocation()
  const roleQuery = useOwnPlatformRole(user?.id)
  const permissionsQuery = useMyPlatformPermissions(user?.id)

  if (authLoading) {
    return <PageSpinner label={t('common:access.checkingYourSession')} />
  }

  if (!session) {
    const redirectTarget = `${location.pathname}${location.search}`
    return <Navigate to={`/platform/login?redirect=${encodeURIComponent(redirectTarget)}`} replace />
  }

  if (roleQuery.isPending || permissionsQuery.isPending) {
    return <PageSpinner label={t('platform:nav.checkingPlatformAccess')} />
  }

  // Les droits sont attendus AVANT le premier rendu : une console qui affiche
  // d'abord tout, puis retire ce que le rôle n'a pas, a montré ce qu'elle ne
  // devait pas montrer. Mieux vaut un instant de plus sur le même spinner.
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
            {t('platform:nav.backToFadeup')}
          </Link>
        </Container>
      </main>
    )
  }

  return (
    <PlatformRoleContext.Provider value={roleQuery.data}>
      <PlatformPermissionsContext.Provider value={permissionsQuery.data ?? []}>
        {children}
      </PlatformPermissionsContext.Provider>
    </PlatformRoleContext.Provider>
  )
}
