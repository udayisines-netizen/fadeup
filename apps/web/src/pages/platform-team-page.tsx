import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import {
  useCreatePlatformInvitation,
  useCreatePlatformZone,
  usePlatformInvitations,
  usePlatformTeam,
  usePlatformZones,
  useRevokePlatformInvitation,
  useRevokePlatformMember,
  useSetPlatformMemberRole,
  useSetPlatformMemberZones,
  type PlatformInvitation,
  type PlatformTeamMember,
} from '@/lib/queries/platform'
import { TextField } from '@/components/ui/text-field'
import { SelectField } from '@/components/ui/select-field'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Container } from '@/components/ui/container'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import { PLATFORM_ROLES, type PlatformRole } from '@/lib/types'
import { useTranslation } from 'react-i18next'

const ROLE_BADGE_VARIANT: Record<PlatformRole, BadgeVariant> = {
  platform_owner: 'accent',
  platform_admin: 'info',
  platform_support: 'neutral',
  platform_sales: 'success',
  platform_moderator: 'warning',
  platform_intern: 'neutral',
}

/** platform_owner ne s'obtient jamais par invitation (contrainte platform_invitations_role_not_owner). */
const INVITABLE_ROLES = PLATFORM_ROLES.filter((role) => role !== 'platform_owner')

const inviteSchema = z.object({
  role: z.enum(['platform_admin', 'platform_support', 'platform_sales', 'platform_moderator', 'platform_intern']),
  invitedEmail: z.string(),
})
type InviteFormValues = z.infer<typeof inviteSchema>

const zoneSchema = z.object({
  country: z.string().min(2).max(2),
  city: z.string().min(1),
  postalCodeHint: z.string(),
})
type ZoneFormValues = z.infer<typeof zoneSchema>

/**
 * /platform/team — le trombinoscope interne et sa gestion.
 *
 * DEUX PUBLICS. Le fondateur et les admins VOIENT l'équipe (list_platform_team
 * est gardée par is_platform_admin). Seul le fondateur la GÈRE : rôle,
 * zones, invitation, révocation. Ce qu'un admin ne peut pas faire n'est pas
 * rendu — pas de bouton grisé, pas de cadenas. Et la garde qui compte est
 * côté serveur : set_platform_member_role refuse un admin même appelée
 * directement, ce que la suite verify_plat1.sql prouve (B1 à B4).
 */
export function PlatformTeamPage() {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()
  const { toast } = useToast()
  const canManage = can('internal_roles.manage')
  /*
   * `list_platform_team()` est gardée par `internal_team.read` et rend zéro
   * ligne aux autres : sans cette question, l'écran affichait un tableau vide
   * sans un mot d'explication — alors que le journal, lui, sait le dire.
   * Corrigé après revue.
   */
  const canReadRoster = can('internal_team.read')

  const teamQuery = usePlatformTeam()
  const zonesQuery = usePlatformZones()
  const invitationsQuery = usePlatformInvitations()
  const createInvitation = useCreatePlatformInvitation()
  const revokeInvitation = useRevokePlatformInvitation()
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdLink, setCreatedLink] = useState<string | null>(null)

  const roleLabel = useMemo(
    () => (role: PlatformRole) => t(`platform:roles.${role}`),
    [t],
  )

  const pendingInvitations = (invitationsQuery.data ?? []).filter(
    (invitation) => !invitation.acceptedAt && !invitation.revokedAt,
  )

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: 'platform_support', invitedEmail: '' },
  })

  async function onSubmit(values: InviteFormValues) {
    setCreateError(null)
    setCreatedLink(null)
    try {
      const { rawToken } = await createInvitation.mutateAsync({
        role: values.role,
        invitedEmail: values.invitedEmail.trim() || null,
      })
      setCreatedLink(`${window.location.origin}/platform/invite/${rawToken}`)
      toast({ title: t('platform:team.invitationCreated'), variant: 'success' })
      reset({ role: values.role, invitedEmail: '' })
    } catch (error) {
      setCreateError(getErrorMessage(error) ?? t('platform:team.couldntCreateInvitation'))
    }
  }

  function handleRevokeInvitation(invitation: PlatformInvitation) {
    revokeInvitation.mutate(invitation.id, {
      onSuccess: () => toast({ title: t('platform:team.invitationRevoked') }),
      onError: (error) =>
        toast({ title: t('platform:team.couldntRevokeInvitation'), description: getErrorMessage(error), variant: 'error' }),
    })
  }

  return (
    <Container size="lg" className="py-8">
      <h1 className="text-xl font-semibold text-ink-950">{t('platform:team.platformTeam')}</h1>
      <p className="mt-1 text-sm text-ink-500">
        {canManage ? t('platform:team.founderManagesRoles') : t('platform:team.whoHasFadeupPlatformAccess')}
      </p>

      {!canReadRoster ? (
        <EmptyState className="mt-8" title={t('platform:team.notVisibleForYourRole')} />
      ) : (
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink-950">{t('common:entity.members')}</h2>
        <div className="mt-3">
          {teamQuery.isPending ? (
            <RosterSkeleton />
          ) : teamQuery.isError ? (
            <ErrorState title={t('platform:team.couldntLoadPlatformTeam')} description={teamQuery.error.message} />
          ) : (
            <Table label={t('platform:team.platformTeamMembers')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('platform:team.user')}</TableHead>
                  <TableHead>{t('common:field.role')}</TableHead>
                  <TableHead>{t('platform:team.zones')}</TableHead>
                  <TableHead>{t('platform:team.since')}</TableHead>
                  {canManage ? (
                    <TableHead>
                      <span className="sr-only">{t('common:action.actions')}</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(teamQuery.data ?? []).length === 0 ? (
                  <TableStateRow colSpan={canManage ? 5 : 4}>
                    <EmptyState title={t('platform:team.notVisibleForYourRole')} className="border-none" />
                  </TableStateRow>
                ) : (
                  (teamQuery.data ?? []).map((member) => (
                    <MemberRow
                      key={member.userId}
                      member={member}
                      canManage={canManage}
                      roleLabel={roleLabel}
                      zones={zonesQuery.data ?? []}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
      )}

      {canManage ? <ZoneSection /> : null}

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink-950">{t('platform:team.pendingInvitations')}</h2>
        <div className="mt-3">
          {invitationsQuery.isPending ? (
            <RosterSkeleton />
          ) : invitationsQuery.isError ? (
            <ErrorState title={t('platform:team.couldntLoadInvitations')} description={invitationsQuery.error.message} />
          ) : (
            <Table label={t('platform:team.pendingPlatformInvitations')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:field.email')}</TableHead>
                  <TableHead>{t('common:field.role')}</TableHead>
                  <TableHead>{t('common:field.expires')}</TableHead>
                  {canManage ? (
                    <TableHead>
                      <span className="sr-only">{t('common:action.actions')}</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvitations.length === 0 ? (
                  <TableStateRow colSpan={canManage ? 4 : 3}>
                    <EmptyState title={t('platform:team.noPendingInvitations')} className="border-none" />
                  </TableStateRow>
                ) : (
                  pendingInvitations.map((invitation) => (
                    <TableRow key={invitation.id}>
                      <TableCell className="max-w-[16rem] truncate">
                        {invitation.invitedEmail ?? t('platform:team.anyoneWithTheLink')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={ROLE_BADGE_VARIANT[invitation.role]}>{roleLabel(invitation.role)}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-ink-500">
                        {new Date(invitation.expiresAt).toLocaleDateString()}
                      </TableCell>
                      {canManage ? (
                        <TableCell className="text-right">
                          <Button
                            variant="danger"
                            size="sm"
                            isLoading={revokeInvitation.isPending && revokeInvitation.variables === invitation.id}
                            onClick={() => handleRevokeInvitation(invitation)}
                          >
                            {t('platform:team.revoke')}
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      {canManage ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink-950">{t('platform:team.inviteSomeone')}</h2>
          <Card className="mt-3">
            <CardContent className="p-4 pt-4">
              <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
                {createError ? <Alert variant="error">{createError}</Alert> : null}
                {createdLink ? (
                  <Alert variant="success">
                    {t('platform:team.shareThisLink')}{' '}
                    <a href={createdLink} className="break-all font-medium underline underline-offset-2">
                      {createdLink}
                    </a>
                  </Alert>
                ) : null}

                <div className="flex flex-col gap-4 sm:flex-row">
                  <div className="flex-1">
                    <TextField
                      label={t('common:field.emailOptional')}
                      type="email"
                      hint={t('platform:team.leaveBlankToCreateA')}
                      autoComplete="off"
                      spellCheck={false}
                      {...register('invitedEmail')}
                    />
                  </div>
                  <div className="sm:w-56">
                    <SelectField
                      label={t('common:field.role')}
                      error={errors.role?.message}
                      options={INVITABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
                      {...register('role')}
                    />
                  </div>
                </div>

                <Button type="submit" isLoading={isSubmitting} className="sm:self-start">
                  {t('platform:team.sendInvitation')}
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </Container>
  )
}

function MemberRow({
  member,
  canManage,
  roleLabel,
  zones,
}: {
  member: PlatformTeamMember
  canManage: boolean
  roleLabel: (role: PlatformRole) => string
  zones: { id: string; label: string }[]
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const setRole = useSetPlatformMemberRole()
  const setZones = useSetPlatformMemberZones()
  const revokeMember = useRevokePlatformMember()
  const [open, setOpen] = useState(false)

  const assignedZoneIds = new Set(member.zones.map((zone) => zone.id))

  function report(error: unknown, title: string) {
    toast({ title, description: getErrorMessage(error), variant: 'error' })
  }

  return (
    <>
      <TableRow>
        <TableCell>
          <span className="block truncate font-medium text-ink-950">{member.email ?? member.userId}</span>
          {member.fullName ? <span className="block truncate text-xs text-ink-500">{member.fullName}</span> : null}
        </TableCell>
        <TableCell>
          <Badge variant={ROLE_BADGE_VARIANT[member.role]}>{roleLabel(member.role)}</Badge>
        </TableCell>
        <TableCell className="text-ink-500">
          {member.zones.length === 0 ? '—' : member.zones.map((zone) => zone.label).join(', ')}
        </TableCell>
        <TableCell className="whitespace-nowrap text-ink-500">
          {new Date(member.createdAt).toLocaleDateString()}
        </TableCell>
        {canManage ? (
          <TableCell className="text-right">
            <Button variant="secondary" size="sm" onClick={() => setOpen((value) => !value)}>
              {open ? t('platform:team.done') : t('platform:team.manage')}
            </Button>
          </TableCell>
        ) : null}
      </TableRow>

      {canManage && open ? (
        <TableRow>
          <TableCell colSpan={5} className="bg-paper-50">
            <div className="flex flex-col gap-4 py-2">
              <div className="sm:max-w-xs">
                <SelectField
                  label={t('platform:team.changeRole')}
                  value={member.role}
                  options={PLATFORM_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
                  onChange={(event) =>
                    setRole.mutate(
                      { userId: member.userId, role: event.target.value as PlatformRole },
                      {
                        onSuccess: () => toast({ title: t('platform:team.roleUpdated') }),
                        onError: (error) => report(error, t('platform:team.couldntUpdateRole')),
                      },
                    )
                  }
                />
              </div>

              <fieldset>
                <legend className="text-xs font-semibold text-ink-950">{t('platform:team.zones')}</legend>
                <p className="mt-1 text-xs text-ink-500">{t('platform:team.zonesHint')}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {zones.length === 0 ? (
                    <span className="text-xs text-ink-500">{t('platform:team.noZonesYet')}</span>
                  ) : (
                    zones.map((zone) => {
                      const assigned = assignedZoneIds.has(zone.id)
                      return (
                        <Button
                          key={zone.id}
                          type="button"
                          size="sm"
                          variant={assigned ? 'primary' : 'secondary'}
                          onClick={() => {
                            const next = new Set(assignedZoneIds)
                            if (assigned) next.delete(zone.id)
                            else next.add(zone.id)
                            setZones.mutate(
                              { userId: member.userId, zoneIds: [...next] },
                              {
                                onSuccess: () => toast({ title: t('platform:team.zonesUpdated') }),
                                onError: (error) => report(error, t('platform:team.couldntUpdateZones')),
                              },
                            )
                          }}
                        >
                          {zone.label}
                        </Button>
                      )
                    })
                  )}
                </div>
              </fieldset>

              <div>
                <Button
                  variant="danger"
                  size="sm"
                  isLoading={revokeMember.isPending}
                  onClick={() =>
                    revokeMember.mutate(
                      { userId: member.userId },
                      {
                        onSuccess: () => toast({ title: t('platform:team.accessRevoked') }),
                        onError: (error) => report(error, t('platform:team.couldntRevokeAccess')),
                      },
                    )
                  }
                >
                  {t('platform:team.revokeAccess')}
                </Button>
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

/** Les zones : un pays et une ville. Le découpage est justifié dans le rapport PLAT-1 §3. */
function ZoneSection() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const zonesQuery = usePlatformZones()
  const createZone = useCreatePlatformZone()
  const { register, handleSubmit, reset, formState } = useForm<ZoneFormValues>({
    resolver: zodResolver(zoneSchema),
    defaultValues: { country: 'FR', city: '', postalCodeHint: '' },
  })

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-ink-950">{t('platform:team.zones')}</h2>
      <p className="mt-1 text-sm text-ink-500">{t('platform:team.zoneModel')}</p>
      <Card className="mt-3">
        <CardContent className="p-4 pt-4">
          <div className="flex flex-wrap gap-2">
            {(zonesQuery.data ?? []).length === 0 ? (
              <span className="text-sm text-ink-500">{t('platform:team.noZonesYet')}</span>
            ) : (
              (zonesQuery.data ?? []).map((zone) => (
                <Badge key={zone.id} variant="neutral">
                  {zone.country} · {zone.label}
                </Badge>
              ))
            )}
          </div>

          <form
            noValidate
            className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end"
            onSubmit={handleSubmit((values) =>
              createZone.mutate(
                {
                  country: values.country.toUpperCase(),
                  city: values.city,
                  postalCodeHint: values.postalCodeHint.trim() || null,
                },
                {
                  onSuccess: () => {
                    toast({ title: t('platform:team.zoneCreated') })
                    reset({ country: values.country, city: '', postalCodeHint: '' })
                  },
                  onError: (error) =>
                    toast({ title: t('platform:team.couldntCreateZone'), description: getErrorMessage(error), variant: 'error' }),
                },
              ),
            )}
          >
            <div className="sm:w-24">
              <TextField label={t('platform:team.country')} maxLength={2} {...register('country')} />
            </div>
            <div className="flex-1">
              <TextField label={t('platform:team.city')} {...register('city')} />
            </div>
            <div className="sm:w-40">
              <TextField label={t('platform:team.postalHint')} {...register('postalCodeHint')} />
            </div>
            <Button type="submit" isLoading={formState.isSubmitting || createZone.isPending}>
              {t('platform:team.addZone')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  )
}

function RosterSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
