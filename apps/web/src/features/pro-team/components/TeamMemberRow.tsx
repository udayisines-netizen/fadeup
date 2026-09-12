import { useTranslation } from 'react-i18next'
import { Avatar } from '@/shared/ui/Avatar'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { IconButton } from '@/shared/ui/IconButton'
import { Popover } from '@/shared/ui/Popover'
import { Row } from '@/shared/ui/Row'
import { Switch } from '@/shared/ui/Switch'
import { IconMenu } from '@/shared/ui/icons'
import type { TeamMember } from '@/features/pro-team/api/team'
import type { TeamPermissions } from '@/features/pro-team/lib/permissions'

/**
 * OS-2 — une rangée d'équipe, régime DENSE (contrat pro §3) : une ligne, le
 * rôle en badge, l'établissement, le handle et l'état opérationnel réel du
 * fauteuil. Rien de décoratif entre deux rangées.
 *
 * Les actions ne se RENDENT que si elles sont permises (§0bis) : pas de
 * bouton grisé, pas de cadenas. Quand rien n'est permis, la rangée n'a pas
 * de zone d'action du tout.
 */

export interface TeamMemberRowProps {
  member: TeamMember
  permissions: TeamPermissions
  revenuePending: boolean
  /** La dernière rangée du bloc ne porte pas de filet — il fermerait le bloc en double. */
  isLast: boolean
  onChangeRole: (member: TeamMember) => void
  onRemove: (member: TeamMember) => void
  onToggleRevenue: (member: TeamMember, visible: boolean) => void
}

export function TeamMemberRow({
  member,
  permissions,
  revenuePending,
  isLast,
  onChangeRole,
  onRemove,
  onToggleRevenue,
}: TeamMemberRowProps) {
  const { t } = useTranslation('v2')

  const hasActions = permissions.canChangeRole || permissions.canRemove || permissions.canToggleRevenue

  /* L'état du fauteuil se dit avec le mot juste : « pas de fauteuil » (aucun
     `barbers`) n'est pas « non réservable » (fauteuil fermé). */
  const seatNotice =
    member.barber_id === null
      ? t('pro.team.row.noSeat')
      : !member.is_bookable
        ? t('pro.team.row.notBookable')
        : null

  const meta: string[] = []
  if (member.location_name) meta.push(member.location_name)
  if (member.professional_handle) meta.push(t('pro.team.row.handle', { handle: member.professional_handle }))
  if (member.upcoming_appointments > 0) {
    meta.push(t('pro.team.row.upcoming', { count: member.upcoming_appointments }))
  }
  if (seatNotice) meta.push(seatNotice)

  return (
    /* `Row` ne relaie pas les attributs data-* : le repère de test vit sur
       l'enveloppe de la rangée, les actions portent le leur. */
    <div data-testid="pro-team-member">
    <Row
      className={isLast ? 'border-b-0' : undefined}
      leading={<Avatar name={member.display_name} src={member.avatar_url} size="sm" />}
      title={
        <span className="flex items-baseline gap-2">
          <span className="truncate">{member.display_name}</span>
          {member.is_me && (
            <span className="shrink-0 text-fu-xs font-normal text-[var(--fu-text-secondary)]">
              {t('pro.team.row.you')}
            </span>
          )}
        </span>
      }
      subtitle={
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <Badge variant="outline">{t(`pro.team.role.${member.role}`)}</Badge>
          {meta.map((entry, index) => (
            <span key={`${index}-${entry}`} className="truncate">{index === 0 ? entry : `· ${entry}`}</span>
          ))}
        </span>
      }
      trailing={
        hasActions ? (
          <Popover
            align="end"
            trigger={
              <IconButton aria-label={t('pro.team.row.actions', { name: member.display_name })}>
                <IconMenu />
              </IconButton>
            }
          >
            <div className="flex flex-col gap-1">
              {permissions.canChangeRole && (
                <Button
                  variant="tertiary"
                  size="sm"
                  fullWidth
                  className="justify-start"
                  data-testid="pro-team-change-role"
                  onClick={() => onChangeRole(member)}
                >
                  {t('pro.team.roleSheet.title')}
                </Button>
              )}
              {permissions.canToggleRevenue && (
                <div className="flex flex-col gap-1 border-t border-[var(--fu-border)] pt-2">
                  <Switch
                    label={t('pro.team.revenue.label')}
                    checked={member.can_view_revenue}
                    disabled={revenuePending}
                    onCheckedChange={(visible) => onToggleRevenue(member, visible)}
                  />
                  <p className="text-fu-xs text-[var(--fu-text-secondary)]">{t('pro.team.revenue.hint')}</p>
                </div>
              )}
              {permissions.canRemove && (
                <Button
                  variant="tertiary"
                  size="sm"
                  fullWidth
                  className="justify-start border-t border-[var(--fu-border)] text-[color:var(--fu-danger)]"
                  data-testid="pro-team-remove"
                  onClick={() => onRemove(member)}
                >
                  {t('pro.team.remove.action')}
                </Button>
              )}
            </div>
          </Popover>
        ) : undefined
      }
    />
    </div>
  )
}
