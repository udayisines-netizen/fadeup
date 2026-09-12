import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProMembershipRole } from '@/shared/data/organization'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { Sheet } from '@/shared/ui/Sheet'
import type { TeamMember } from '@/features/pro-team/api/team'

/**
 * OS-2 — changer le rôle d'un membre. Une seule décision par feuille.
 * Le rôle `owner` n'est proposé qu'à un owner (garde `owner_role_forbidden`
 * côté base) ; la phrase le dit plutôt que de laisser une option grisée.
 */

export interface RoleSheetProps {
  member: TeamMember | null
  canAssignOwner: boolean
  pending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (role: ProMembershipRole) => void
}

export function RoleSheet({ member, canAssignOwner, pending, error, onOpenChange, onSubmit }: RoleSheetProps) {
  const { t } = useTranslation('v2')
  const [role, setRole] = useState<ProMembershipRole>('barber')

  useEffect(() => {
    if (member) setRole(member.role)
  }, [member])

  const options = (
    canAssignOwner
      ? (['owner', 'manager', 'receptionist', 'barber'] as const)
      : (['manager', 'receptionist', 'barber'] as const)
  ).map((value) => ({ value, label: t(`pro.team.role.${value}`) }))

  return (
    <Sheet
      open={member !== null}
      onOpenChange={onOpenChange}
      title={t('pro.team.roleSheet.title')}
      description={member?.display_name}
      className="md:w-[26rem]"
    >
      <div data-testid="pro-team-role-sheet" className="flex flex-col gap-4">
        <Select
          label={t('pro.team.roleSheet.title')}
          options={options}
          value={role}
          error={error ?? undefined}
          onValueChange={(value) => setRole(value as ProMembershipRole)}
        />

        {!canAssignOwner && (
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.team.roleSheet.ownerNotice')}</p>
        )}

        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            fullWidth
            loading={pending}
            data-testid="pro-team-role-submit"
            onClick={() => onSubmit(role)}
          >
            {t('pro.team.roleSheet.save')}
          </Button>
          <Button variant="tertiary" fullWidth onClick={() => onOpenChange(false)}>
            {t('pro.team.roleSheet.cancel')}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
