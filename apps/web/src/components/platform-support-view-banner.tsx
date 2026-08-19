import { useSupportView } from '@/routes/platform-support-view-context'
import { useOrganization } from '@/lib/queries/platform'
import { useOrgStaffProfiles } from '@/lib/queries/staff-profiles'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import { useTranslation } from 'react-i18next'

/**
 * Persistent banner shown for the whole time a support-view session is
 * open — CLAUDE.md section 11: "Platform Support View — Viewing [Barber
 * Name]'s workspace" + "Exit Support View". Renders nothing when there is
 * no active session.
 */
export function PlatformSupportViewBanner() {
  const { t } = useTranslation()
  const { activeSession, exitSupportView, isExiting } = useSupportView()
  const { toast } = useToast()
  const organizationQuery = useOrganization(activeSession?.organizationId)
  const staffProfilesQuery = useOrgStaffProfiles(
    activeSession?.targetType === 'barber' ? activeSession.organizationId : undefined,
  )

  if (!activeSession) return null

  const targetStaffProfile = staffProfilesQuery.data?.find((profile) => profile.userId === activeSession.targetUserId)
  const workspaceLabel =
    activeSession.targetType === 'barber' && targetStaffProfile
      ? `${targetStaffProfile.displayName}'s workspace`
      : (organizationQuery.data?.name ?? 'this organization')

  async function handleExit() {
    try {
      await exitSupportView()
      toast({ title: t('platform:nav.exitedSupportView') })
    } catch (error) {
      toast({ title: t('platform:nav.couldntExitSupportView'), description: getErrorMessage(error), variant: 'error' })
    }
  }

  return (
    <div className="border-b border-warning-600 bg-warning-100">
      <Container size="lg" className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
        <span className="font-medium text-warning-700">
          Platform Support View — Viewing {workspaceLabel}
        </span>
        <Button variant="secondary" size="sm" isLoading={isExiting} onClick={() => void handleExit()}>
          {t('platform:nav.exitSupportView')}
        </Button>
      </Container>
    </div>
  )
}
