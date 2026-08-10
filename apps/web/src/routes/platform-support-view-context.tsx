import { createContext, useContext, type ReactNode } from 'react'
import { useAuth } from '@/lib/auth-context'
import {
  useEndSupportSession,
  useMyActiveSupportSession,
  useStartSupportSession,
  type PlatformSupportSession,
  type SupportSessionTargetType,
} from '@/lib/queries/platform'

interface SupportViewContextValue {
  activeSession: PlatformSupportSession | null
  isLoading: boolean
  enterSupportView: (input: { organizationId: string; targetType: SupportSessionTargetType; targetUserId?: string | null; reason?: string | null }) => Promise<void>
  exitSupportView: () => Promise<void>
  isEntering: boolean
  isExiting: boolean
}

const SupportViewContext = createContext<SupportViewContextValue | null>(null)

/**
 * Tracks the calling platform staffer's own support-view session (at most
 * one open at a time — platform_support_sessions_one_open_per_actor).
 * Mounted once inside PlatformLayout so both the persistent banner and any
 * "Enter support view" button anywhere under /platform share one source of
 * truth. See db/migrations/20260810140000_platform_control_center.sql for
 * what this does and does NOT grant (it's an audited context, not a new
 * read-access mechanism — platform_owner/admin already read tenant data via
 * is_platform_admin()).
 */
export function PlatformSupportViewProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const sessionQuery = useMyActiveSupportSession(user?.id)
  const startMutation = useStartSupportSession()
  const endMutation = useEndSupportSession()

  const value: SupportViewContextValue = {
    activeSession: sessionQuery.data ?? null,
    isLoading: sessionQuery.isPending,
    enterSupportView: async (input) => {
      await startMutation.mutateAsync(input)
    },
    exitSupportView: async () => {
      const sessionId = sessionQuery.data?.id
      if (!sessionId) return
      await endMutation.mutateAsync(sessionId)
    },
    isEntering: startMutation.isPending,
    isExiting: endMutation.isPending,
  }

  return <SupportViewContext.Provider value={value}>{children}</SupportViewContext.Provider>
}

export function useSupportView(): SupportViewContextValue {
  const ctx = useContext(SupportViewContext)
  if (!ctx) throw new Error('useSupportView must be used within PlatformSupportViewProvider')
  return ctx
}
