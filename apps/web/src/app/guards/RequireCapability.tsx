import { Navigate, Outlet } from 'react-router-dom'
import { useProEntitlements, useProOrganization } from '@/shared/data/organization'
import { useSession } from '@/shared/hooks/useSession'
import { Spinner } from '@/shared/ui/Spinner'

/**
 * Conditionne une branche de routes à une capacité RÉELLE de
 * `get_organization_entitlements.live_capabilities` — la même source que le
 * menu du ProShell. Une capacité absente n'est PAS rendue : ni grisée, ni
 * cadenassée — l'URL directe redirige vers l'accueil pro (MASTER_SPEC §4,
 * F1 §4). À monter SOUS RequireAuth + RequirePro.
 */
export function RequireCapability({ capability }: { capability: string }) {
  const { loading: sessionLoading } = useSession()
  const { organization, loading: organizationLoading } = useProOrganization()
  const { entitlements, loading: entitlementsLoading, error } = useProEntitlements(organization?.organizationId ?? null)

  // Tant que la session initiale n'est pas résolue, `organization` est nul
  // avec loading=false — rediriger là serait un faux négatif systématique.
  // Erreur d'entitlements : on redirige (jamais de spinner sans issue).
  if (sessionLoading || organizationLoading || entitlementsLoading || (organization && !entitlements && !error)) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner size="lg" announce />
      </div>
    )
  }

  if (!(entitlements?.liveCapabilities ?? []).includes(capability)) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}
