import { Navigate, Outlet } from 'react-router-dom'
import { isSoloOrganization, useProOrganization } from '@/shared/data/organization'
import { useSession } from '@/shared/hooks/useSession'
import { Spinner } from '@/shared/ui/Spinner'

/**
 * OS-2 — l'écran Équipe n'existe pas pour un `solo_professional`. Le
 * ProShell masque déjà l'entrée de menu (`requiresTeam`) ; cette garde ferme
 * l'URL directe, pour que « ce qui n'est pas permis n'est pas rendu »
 * (P1PRO §0bis) tienne aussi quand on colle un lien. À monter SOUS
 * RequireAuth + RequirePro.
 */
export function RequireTeamOrganization() {
  const { loading: sessionLoading } = useSession()
  const { organization, loading } = useProOrganization()

  if (sessionLoading || loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner size="lg" announce />
      </div>
    )
  }

  if (!organization || isSoloOrganization(organization)) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}
