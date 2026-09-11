import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useNow } from '@/shared/hooks/useNow'
import { useProOrganization } from '@/shared/data/organization'
import type { ProMembershipRole } from '@/shared/data/organization'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Dialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { SkeletonRow } from '@/shared/ui/Skeleton'
import { useToast } from '@/shared/ui/Toast'
import { IconTeam } from '@/shared/ui/icons'
import {
  useInviteTeamMember,
  useRemoveTeamMember,
  useRevokeInvitation,
  useSetRevenueVisibility,
  useSetTeamMemberRole,
  useTeamInvitations,
  useTeamMembers,
  type TeamInvitation,
  type TeamMember,
} from '@/features/pro-team/api/team'
import { InvitationRow } from '@/features/pro-team/components/InvitationRow'
import { TeamMemberRow } from '@/features/pro-team/components/TeamMemberRow'
import { InviteSheet } from '@/features/pro-team/components/InviteSheet'
import { RemoveMemberDialog } from '@/features/pro-team/components/RemoveMemberDialog'
import { RoleSheet } from '@/features/pro-team/components/RoleSheet'
import { teamPermissions } from '@/features/pro-team/lib/permissions'
import { isForbidden, teamErrorKey } from '@/features/pro-team/lib/refusals'

/**
 * OS-2 — `/dashboard/team`. Régime DENSE (contrat pro §3) : deux blocs de
 * rangées, membres puis invitations, un seul CTA primaire.
 *
 * Trois lois s'y appliquent :
 *  · ce qui n'est pas permis n'est pas RENDU (aucune action grisée) ;
 *  · retirer quelqu'un ne supprime pas son identité professionnelle ;
 *  · l'e-mail d'invitation part par `email_outbox` — cet écran ne connaît
 *    qu'une seule RPC d'invitation, jamais un second chemin d'envoi.
 *
 * La garde `RequireTeamOrganization` a déjà écarté le solo ; un barber qui
 * force l'URL reçoit un 42501 de la base, traduit ici en état neutre.
 */

const blockClass = 'overflow-hidden rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)]'
const blockTitleClass =
  'px-4 pb-2 pt-4 font-fu-mono text-fu-xs font-medium tracking-widest text-[var(--fu-text-secondary)]'

export function ProTeamPage() {
  const { t } = useTranslation('v2')
  const { toast } = useToast()
  /* Une échéance se compte en jours : une minute d'horloge suffit. */
  const now = useNow(60_000)

  const { organization, loading: organizationLoading } = useProOrganization()
  const organizationId = organization?.organizationId ?? null
  const viewerRole: ProMembershipRole = organization?.role ?? 'barber'

  const membersQuery = useTeamMembers(organizationId)
  const invitationsQuery = useTeamInvitations(organizationId)

  const invite = useInviteTeamMember(organizationId)
  /* Le renvoi est la MÊME RPC, mais une mutation distincte : l'état de
     chargement d'une rangée ne doit pas allumer le bouton de la feuille. */
  const resend = useInviteTeamMember(organizationId)
  const revoke = useRevokeInvitation(organizationId)
  const setRole = useSetTeamMemberRole(organizationId)
  const setRevenue = useSetRevenueVisibility(organizationId)
  const remove = useRemoveTeamMember(organizationId)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [roleTarget, setRoleTarget] = useState<TeamMember | null>(null)
  const [roleError, setRoleError] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<TeamInvitation | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [revenuePendingId, setRevenuePendingId] = useState<string | null>(null)

  const members = membersQuery.data ?? []
  const invitations = invitationsQuery.data ?? []
  const loading = organizationLoading || membersQuery.isPending || invitationsQuery.isPending
  const error = membersQuery.error ?? invitationsQuery.error ?? null
  const forbidden = error !== null && isForbidden(error)

  const failure = (raw: unknown) => toast({ tone: 'error', title: t(teamErrorKey(raw)) })

  const openInvite = () => {
    setInviteError(null)
    setInviteOpen(true)
  }

  const submitInvite = (input: { email: string; role: ProMembershipRole; locationId: string | null }) => {
    setInviteError(null)
    invite.mutate(input, {
      onSuccess: (result) => {
        setInviteOpen(false)
        toast({
          tone: 'success',
          title: t(result?.replaced_previous ? 'pro.team.toast.reinvited' : 'pro.team.toast.invited', {
            email: result?.email ?? input.email,
          }),
        })
      },
      onError: (raw) => setInviteError(t(teamErrorKey(raw))),
    })
  }

  const resendInvitation = (invitation: TeamInvitation) => {
    setResendingId(invitation.id)
    resend.mutate(
      { email: invitation.email, role: invitation.role, locationId: invitation.location_id },
      {
        onSuccess: () =>
          toast({ tone: 'success', title: t('pro.team.toast.reinvited', { email: invitation.email }) }),
        onError: failure,
        onSettled: () => setResendingId(null),
      },
    )
  }

  const confirmRevoke = () => {
    if (!revokeTarget) return
    revoke.mutate(revokeTarget.id, {
      onSuccess: () => {
        setRevokeTarget(null)
        toast({ tone: 'success', title: t('pro.team.toast.invitationRevoked') })
      },
      onError: failure,
    })
  }

  const submitRole = (role: ProMembershipRole) => {
    if (!roleTarget) return
    setRoleError(null)
    setRole.mutate(
      { membershipId: roleTarget.membership_id, role },
      {
        onSuccess: () => {
          setRoleTarget(null)
          toast({ tone: 'success', title: t('pro.team.toast.roleChanged') })
        },
        onError: (raw) => setRoleError(t(teamErrorKey(raw))),
      },
    )
  }

  const toggleRevenue = (member: TeamMember, visible: boolean) => {
    setRevenuePendingId(member.membership_id)
    setRevenue.mutate(
      { membershipId: member.membership_id, visible },
      {
        onSuccess: () => toast({ tone: 'success', title: t('pro.team.toast.revenueChanged') }),
        onError: failure,
        onSettled: () => setRevenuePendingId(null),
      },
    )
  }

  const confirmRemove = (reassignToBarberId: string | null) => {
    if (!removeTarget) return
    const name = removeTarget.display_name
    setRemoveError(null)
    remove.mutate(
      { membershipId: removeTarget.membership_id, reassignToBarberId },
      {
        onSuccess: (result) => {
          setRemoveTarget(null)
          const reassigned = result?.reassigned_appointments ?? 0
          toast({
            tone: 'success',
            title:
              reassigned > 0
                ? t('pro.team.toast.removedWithReassign', { name, count: reassigned })
                : t('pro.team.toast.removed', { name }),
          })
        },
        /* Un conflit de réassignation laisse la fenêtre OUVERTE : le
           professionnel change de remplaçant sans tout recommencer. */
        onError: (raw) => setRemoveError(t(teamErrorKey(raw))),
      },
    )
  }

  /* Un seul CTA primaire par surface (contrat pro §6) : quand l'état vide
     porte déjà « Inviter par e-mail », l'en-tête s'efface plutôt que de
     dédoubler le même geste. */
  const showEmptyMembers = !loading && error === null && members.length <= 1
  const inviteButton = (
    <Button variant="primary" data-testid="pro-team-invite" onClick={openInvite}>
      {t('pro.team.invite')}
    </Button>
  )

  if (forbidden) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-24">
        <EmptyState
          icon={<IconTeam />}
          title={t('pro.team.forbidden.title')}
          description={t('pro.team.forbidden.description')}
          action={
            <Link
              to="/dashboard"
              className="text-fu-sm font-medium text-[color:var(--fu-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
            >
              {t('pro.team.forbidden.action')}
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-24">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-fu-xl font-semibold text-[var(--fu-text-primary)]">{t('pro.team.title')}</h1>
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.team.subtitle')}</p>
        </div>
        {!showEmptyMembers && inviteButton}
      </header>

      {loading ? (
        <div className={blockClass} aria-busy="true" aria-label={t('pro.team.loading')}>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow className="border-b-0" />
        </div>
      ) : error ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)] p-4">
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t(teamErrorKey(error))}</p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => {
              void membersQuery.refetch()
              void invitationsQuery.refetch()
            }}
          >
            {t('common.action.retry')}
          </Button>
        </div>
      ) : (
        <>
          <section className={blockClass} data-testid="pro-team-members">
            <h2 className={blockTitleClass}>{t('pro.team.membersTitle').toLocaleUpperCase()}</h2>
            {showEmptyMembers ? (
              <EmptyState
                title={t('pro.team.empty.title')}
                description={t('pro.team.empty.description')}
                action={
                  /* Le même repère que l'en-tête : un seul des deux se rend. */
                  <Button variant="primary" data-testid="pro-team-invite" onClick={openInvite}>
                    {t('pro.team.empty.action')}
                  </Button>
                }
                className="py-8"
              />
            ) : (
              members.map((member, index) => (
                <TeamMemberRowItem
                  key={member.membership_id}
                  member={member}
                  viewerRole={viewerRole}
                  isLast={index === members.length - 1}
                  revenuePending={revenuePendingId === member.membership_id}
                  onChangeRole={(target) => {
                    setRoleError(null)
                    setRoleTarget(target)
                  }}
                  onRemove={(target) => {
                    setRemoveError(null)
                    setRemoveTarget(target)
                  }}
                  onToggleRevenue={toggleRevenue}
                />
              ))
            )}
          </section>

          <section className={blockClass} data-testid="pro-team-invitations">
            <h2 className={blockTitleClass}>{t('pro.team.invitationsTitle').toLocaleUpperCase()}</h2>
            {invitations.length === 0 ? (
              <p className="px-4 pb-4 text-fu-sm text-[var(--fu-text-secondary)]">
                {t('pro.team.invitations.empty')}
              </p>
            ) : (
              invitations.map((invitation, index) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  now={now.getTime()}
                  resending={resendingId === invitation.id}
                  isLast={index === invitations.length - 1}
                  onResend={resendInvitation}
                  onRevoke={setRevokeTarget}
                />
              ))
            )}
          </section>
        </>
      )}

      <InviteSheet
        open={inviteOpen}
        onOpenChange={(next) => {
          if (!next) setInviteError(null)
          setInviteOpen(next)
        }}
        canInviteOwner={viewerRole === 'owner'}
        locations={organization?.locations ?? []}
        pending={invite.isPending}
        error={inviteError}
        onSubmit={submitInvite}
      />

      <RoleSheet
        member={roleTarget}
        canAssignOwner={viewerRole === 'owner'}
        pending={setRole.isPending}
        error={roleError}
        onOpenChange={(next) => {
          if (!next) {
            setRoleTarget(null)
            setRoleError(null)
          }
        }}
        onSubmit={submitRole}
      />

      <RemoveMemberDialog
        member={removeTarget}
        members={members}
        pending={remove.isPending}
        error={removeError}
        onOpenChange={(next) => {
          if (!next) {
            setRemoveTarget(null)
            setRemoveError(null)
          }
        }}
        onConfirm={confirmRemove}
      />

      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRevokeTarget(null)
        }}
        title={t('pro.team.invitations.revokeTitle')}
        description={t('pro.team.invitations.revokeBody')}
      >
        <div data-testid="pro-team-revoke-dialog" className="flex flex-col gap-2">
          <Button
            variant="destructive"
            fullWidth
            loading={revoke.isPending}
            data-testid="pro-team-revoke-confirm"
            onClick={confirmRevoke}
          >
            {t('pro.team.invitations.revokeConfirm')}
          </Button>
          <Button variant="tertiary" fullWidth onClick={() => setRevokeTarget(null)}>
            {t('common.action.close')}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

/** Le calcul de permission par rangée — un seul endroit, le miroir des gardes SQL. */
function TeamMemberRowItem(props: {
  member: TeamMember
  viewerRole: ProMembershipRole
  isLast: boolean
  revenuePending: boolean
  onChangeRole: (member: TeamMember) => void
  onRemove: (member: TeamMember) => void
  onToggleRevenue: (member: TeamMember, visible: boolean) => void
}) {
  const permissions = teamPermissions(props.viewerRole, props.member)
  return (
    <TeamMemberRow
      member={props.member}
      permissions={permissions}
      isLast={props.isLast}
      revenuePending={props.revenuePending}
      onChangeRole={props.onChangeRole}
      onRemove={props.onRemove}
      onToggleRevenue={props.onToggleRevenue}
    />
  )
}
