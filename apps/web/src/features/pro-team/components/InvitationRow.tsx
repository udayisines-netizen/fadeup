import { useTranslation } from 'react-i18next'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { IconButton } from '@/shared/ui/IconButton'
import { Row } from '@/shared/ui/Row'
import { IconClose } from '@/shared/ui/icons'
import type { TeamInvitation } from '@/features/pro-team/api/team'
import { invitationExpiry } from '@/features/pro-team/lib/invitations'

/**
 * OS-2 — une invitation en attente. L'échéance est un CHIFFRE : Geist Mono,
 * tabular-nums (contrat pro §4). Expirée, elle passe en `--fu-state-warn`
 * avec son libellé — jamais la couleur seule.
 *
 * Le jeton n'apparaît nulle part : il ne vit que dans l'e-mail.
 */

export interface InvitationRowProps {
  invitation: TeamInvitation
  now: number
  resending: boolean
  isLast: boolean
  onResend: (invitation: TeamInvitation) => void
  onRevoke: (invitation: TeamInvitation) => void
}

export function InvitationRow({ invitation, now, resending, isLast, onResend, onRevoke }: InvitationRowProps) {
  const { t } = useTranslation('v2')
  /* `is_expired` est calculé par la base à la lecture ; le compte à rebours
     local le confirme sans le contredire. */
  const expiry = invitationExpiry(invitation.expires_at, now)
  const expired = invitation.is_expired || expiry.expired

  return (
    <div data-testid="pro-team-invitation">
      <Row
        className={isLast ? 'border-b-0' : undefined}
        title={<span className="truncate">{invitation.email}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <Badge variant="outline">{t(`pro.team.role.${invitation.role}`)}</Badge>
            <span
              className={
                expired
                  ? 'font-fu-mono tabular-nums text-[color:var(--fu-state-warn)]'
                  : 'font-fu-mono tabular-nums'
              }
            >
              {expired ? t('pro.team.invitations.expired') : t('pro.team.invitations.expiresIn', { count: expiry.days })}
            </span>
            {invitation.invited_by_name && (
              <span className="truncate">{`· ${t('pro.team.invitations.invitedBy', { name: invitation.invited_by_name })}`}</span>
            )}
          </span>
        }
        trailing={
          <>
            <Button
              variant="secondary"
              size="sm"
              loading={resending}
              data-testid="pro-team-invitation-resend"
              onClick={() => onResend(invitation)}
            >
              {t('pro.team.invitations.resend')}
            </Button>
            <IconButton
              aria-label={t('pro.team.invitations.revoke')}
              data-testid="pro-team-invitation-revoke"
              onClick={() => onRevoke(invitation)}
            >
              <IconClose />
            </IconButton>
          </>
        }
      />
    </div>
  )
}
