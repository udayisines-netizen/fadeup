import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth-context'
import { useMyMemberships, type MembershipWithOrganization } from '@/lib/queries/memberships'
import { getStoredOrganizationId, setStoredOrganizationId } from '@/lib/current-organization'

interface CurrentOrgContextValue {
  membershipsQuery: UseQueryResult<MembershipWithOrganization[]>
  memberships: MembershipWithOrganization[]
  /** The org the user is currently working in. Null only while memberships is empty. */
  currentMembership: MembershipWithOrganization | null
  setCurrentOrganizationId: (organizationId: string) => void
}

const CurrentOrgContext = createContext<CurrentOrgContextValue | null>(null)

/**
 * Resolves and persists "the organization the user is currently working in".
 * A user can belong to multiple organizations; the choice is remembered in
 * localStorage (see lib/current-organization.ts) and defaults to the first
 * membership when nothing is stored yet or the stored id no longer applies.
 */
export function CurrentOrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const membershipsQuery = useMyMemberships(user?.id)
  const [selectedId, setSelectedId] = useState<string | null>(() => getStoredOrganizationId())

  const memberships = useMemo(() => membershipsQuery.data ?? [], [membershipsQuery.data])

  const currentMembership = useMemo(() => {
    if (memberships.length === 0) return null
    const selected = memberships.find((membership) => membership.organizationId === selectedId)
    return selected ?? memberships[0] ?? null
  }, [memberships, selectedId])

  function setCurrentOrganizationId(organizationId: string) {
    setSelectedId(organizationId)
    setStoredOrganizationId(organizationId)
  }

  const value: CurrentOrgContextValue = {
    membershipsQuery,
    memberships,
    currentMembership,
    setCurrentOrganizationId,
  }

  return <CurrentOrgContext.Provider value={value}>{children}</CurrentOrgContext.Provider>
}

export function useCurrentOrg(): CurrentOrgContextValue {
  const ctx = useContext(CurrentOrgContext)
  if (!ctx) {
    throw new Error('useCurrentOrg must be used within a CurrentOrgProvider')
  }
  return ctx
}
