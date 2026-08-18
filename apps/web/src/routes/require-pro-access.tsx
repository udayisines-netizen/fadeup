import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth-context'
import { useResolvedOrganization } from '@/lib/queries/memberships'
import { useMyProfessionalApplication } from '@/lib/queries/professional-applications'
import { useOrganizationReadiness } from '@/lib/queries/onboarding'
import { PageSpinner } from '@/components/ui/spinner'

/**
 * Keeps an applicant out of the professional application while their request
 * is pending or refused.
 *
 * This is a redirect for the sake of the person using it, NOT the security
 * boundary. The real enforcement is in the database: an applicant holds no
 * membership, every tenant table is RLS-scoped to memberships, and
 * create_organization refuses callers with a pending or rejected
 * application, so even a hand-crafted request cannot produce a workspace.
 * Deleting this component would make the product confusing, not insecure.
 *
 * Someone with an actual membership is let through untouched, whatever their
 * application says — a barber invited to staff a shop may also have applied
 * for their own, and the membership is what grants access.
 */
export function RequireProAccess({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const location = useLocation()
  // This guard runs OUTSIDE CurrentOrgProvider — that provider is mounted by
  // AppLayout, which is the very thing this guard decides whether to render.
  // useResolvedOrganization gives the same answer without needing it.
  const { membershipsQuery, memberships, organizationId } = useResolvedOrganization(user?.id)
  const applicationQuery = useMyProfessionalApplication(Boolean(user))

  const readinessQuery = useOrganizationReadiness(organizationId ?? undefined)

  if (authLoading || membershipsQuery.isPending || applicationQuery.isPending) {
    return <PageSpinner label="Checking your access" />
  }

  const hasMembership = memberships.length > 0
  if (hasMembership) {
    // Holding a membership no longer means setup is finished — that
    // assumption is why approved shops sat on a placeholder home page with
    // no services and no hours, unable to be booked and with nothing telling
    // them so.
    //
    // Only the INDEX route bounces. /app/services, /app/locations,
    // /app/team and the rest stay reachable throughout setup, because the
    // wizard itself sends people to them; redirecting the whole subtree
    // would trap someone in a loop between a step and the screen it links
    // to. Readiness is the server's answer (get_organization_readiness),
    // never a local flag.
    const isAppIndex = location.pathname === '/app' || location.pathname === '/app/'
    if (isAppIndex && readinessQuery.isPending) {
      return <PageSpinner label="Checking your setup" />
    }
    if (isAppIndex && readinessQuery.data && !readinessQuery.data.readyToBook) {
      return <Navigate to="/onboarding" replace />
    }
    return <>{children}</>
  }

  const status = applicationQuery.data?.status
  if (status === 'pending_review' || status === 'rejected') {
    return <Navigate to="/pro/application" replace />
  }

  // No membership and no application: an ordinary account that wandered into
  // /app. Existing behaviour (onboarding / workspace selector) still applies.
  return <>{children}</>
}
