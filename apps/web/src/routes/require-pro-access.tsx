import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth-context'
import { useMyMemberships } from '@/lib/queries/memberships'
import { useMyProfessionalApplication } from '@/lib/queries/professional-applications'
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
  const membershipsQuery = useMyMemberships(user?.id)
  const applicationQuery = useMyProfessionalApplication(Boolean(user))

  if (authLoading || membershipsQuery.isPending || applicationQuery.isPending) {
    return <PageSpinner label="Checking your access" />
  }

  const hasMembership = (membershipsQuery.data ?? []).length > 0
  if (hasMembership) {
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
