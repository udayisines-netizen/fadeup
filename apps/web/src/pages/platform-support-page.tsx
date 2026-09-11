import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { usePlatformIntl } from '@/lib/platform-intl'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import { useAllOrganizations } from '@/lib/queries/platform'
import {
  useCompleteWithdrawal,
  useMarketplaceWithdrawals,
  useOpenSupportTicket,
  useSupportTickets,
  type SupportTicketRow,
  type WithdrawalRequestRow,
} from '@/lib/queries/platform-plat2'
import {
  DeadlineBadge,
  OrganizationDossier,
  SUPPORT_PERMISSION,
  failureDescription,
  useSupportVocabulary,
} from '@/pages/platform-support-ticket-page'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader, SectionHeader } from '@/components/ui/page-header'
import { SelectField } from '@/components/ui/select-field'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { TextField } from '@/components/ui/text-field'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'

/**
 * /platform/support — LA FILE DU SUPPORT.
 *
 * Le support prend un appel, cherche le dossier, vérifie, agit. L'écran est
 * ordonné par cette urgence-là, pas par l'ordre d'écriture des tables :
 *
 *   1. LES 72 HEURES D'ABORD. X2 a promis au professionnel que sa demande de
 *      retrait serait traitée en 72 heures ; PLAT-1 §15.7 constatait que « les
 *      72 heures ne sont pour l'instant tenues par personne », faute d'écran.
 *      C'est cet écran. Une demande en retard doit donc sauter aux yeux AVANT
 *      la file de tickets — un tableau de plus en bas de page enterre la
 *      promesse exactement comme son absence l'enterrait.
 *   2. la file de tickets, telle que la base la trie ;
 *   3. l'ouverture d'un dossier de salon.
 *
 * L'action la plus fréquente — décrocher et ouvrir un ticket — est dans
 * l'en-tête, atteignable sans faire défiler quoi que ce soit.
 *
 * CE QUE CET ÉCRAN NE MONTRE PAS, ET IL FAUT QUE ÇA SE VOIE : pas de CRM, pas
 * de facturation, pas de modération. Aucun hook de prospect, de pipeline, de
 * modération ni de plan commercial n'est importé ici — et le test unitaire le
 * verrouille en relisant ce fichier. Les notes clients privées
 * (`customers.notes`) ne sont rendues nulle part : aucun dossier ne les porte.
 */
export function PlatformSupportPage() {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()

  /*
   * LA GARDE EST UN COMPOSANT, PAS UN `if` DANS LE CORPS : tant qu'elle
   * refuse, aucun hook de la file n'est monté, donc aucune RPC n'est appelée
   * par un rôle qui n'a rien à faire ici. Le conditionnement d'interface ne
   * fait que ça ; l'autorisation, elle, est reposée par chaque RPC.
   */
  if (!can(SUPPORT_PERMISSION.tickets)) {
    return (
      <Container size="lg" className="py-8">
        <PageHeader title={t('platform:supportDesk.title')} />
        <Card className="mt-6">
          <CardContent className="p-4 pt-4">
            <EmptyState
              title={t('platform:supportDesk.notForYourRole')}
              description={t('platform:supportDesk.notForYourRoleHint')}
              className="border-none"
            />
          </CardContent>
        </Card>
      </Container>
    )
  }

  return <SupportDesk />
}

function SupportDesk() {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()
  const [includeResolved, setIncludeResolved] = useState(false)
  const [mineOnly, setMineOnly] = useState(false)
  const [newCallOpen, setNewCallOpen] = useState(false)
  const ticketsQuery = useSupportTickets({ includeResolved, mineOnly })

  return (
    <Container size="lg" className="py-8">
      <PageHeader
        title={t('platform:supportDesk.title')}
        subtitle={t('platform:supportDesk.subtitle')}
        actions={<Button onClick={() => setNewCallOpen(true)}>{t('platform:supportDesk.newCall')}</Button>}
      />

      {can('marketplace.withdraw') ? (
        <WithdrawalDeadlines tickets={ticketsQuery.data ?? []} />
      ) : (
        <section className="mt-8">
          <SectionHeader title={t('platform:supportDesk.deadlines')} />
          <Card className="mt-3">
            <CardContent className="p-4 pt-4">
              <p className="text-sm text-ink-500">{t('platform:supportDesk.deadlinesNotVisible')}</p>
            </CardContent>
          </Card>
        </section>
      )}

      <section className="mt-8">
        <SectionHeader title={t('platform:supportDesk.queue')} />
        <p className="mt-1 text-sm text-ink-500">{t('platform:supportDesk.queueHint')}</p>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-6">
          <Switch
            label={t('platform:supportDesk.includeResolved')}
            checked={includeResolved}
            onChange={(event) => setIncludeResolved(event.target.checked)}
          />
          <Switch
            label={t('platform:supportDesk.mineOnly')}
            checked={mineOnly}
            onChange={(event) => setMineOnly(event.target.checked)}
          />
        </div>

        <div className="mt-3">
          {ticketsQuery.isPending ? (
            <QueueSkeleton />
          ) : ticketsQuery.isError ? (
            <ErrorState
              title={t('platform:supportDesk.queueError')}
              description={failureDescription(ticketsQuery.error, t)}
            />
          ) : (
            <TicketTable tickets={ticketsQuery.data ?? []} mineOnly={mineOnly} />
          )}
        </div>
      </section>

      {can(SUPPORT_PERMISSION.dossier) ? <ShopDossierOpener /> : null}

      <NewCallDialog open={newCallOpen} onOpenChange={setNewCallOpen} />
    </Container>
  )
}

// ============================================================================
// 1. Les 72 heures
// ============================================================================

/**
 * `hours_remaining` et `is_overdue` sont CALCULÉS PAR LA BASE et jamais
 * recalculés ici : la promesse des 72 heures est celle du serveur, et un
 * compte à rebours dessiné à partir de l'horloge du poste dirait autre chose.
 * Le hook se rafraîchit toutes les 60 secondes — c'est ce qui fait défiler
 * l'échéance sans marteler la base.
 */
function WithdrawalDeadlines({ tickets }: { tickets: SupportTicketRow[] }) {
  const { t } = useTranslation()
  const withdrawalsQuery = useMarketplaceWithdrawals()
  const rows = withdrawalsQuery.data ?? []

  const overdue = rows.filter((row) => row.is_overdue).length
  /* CE QUI APPROCHE, pas seulement ce qui est déjà perdu : sous 12 heures. */
  const dueSoon = rows.filter((row) => !row.is_overdue && row.hours_remaining <= 12).length

  return (
    <section className="mt-8">
      <SectionHeader title={t('platform:supportDesk.deadlines')} />
      <p className="mt-1 text-sm text-ink-500">{t('platform:supportDesk.deadlinesHint')}</p>

      {overdue > 0 ? (
        <Alert variant="error" className="mt-3">
          {t('platform:supportDesk.overdueCount', { n: overdue })}
        </Alert>
      ) : dueSoon > 0 ? (
        <Alert variant="warning" className="mt-3">
          {t('platform:supportDesk.dueSoonCount', { n: dueSoon })}
        </Alert>
      ) : null}

      <div className="mt-3">
        {withdrawalsQuery.isPending ? (
          <QueueSkeleton />
        ) : withdrawalsQuery.isError ? (
          <ErrorState
            title={t('platform:supportDesk.withdrawalsError')}
            description={failureDescription(withdrawalsQuery.error, t)}
          />
        ) : (
          <Table label={t('platform:supportDesk.deadlines')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common:entity.professional')}</TableHead>
                <TableHead>{t('platform:supportDesk.requestedVia')}</TableHead>
                <TableHead>{t('platform:supportDesk.colDeadline')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common:action.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableStateRow colSpan={4}>
                  <EmptyState title={t('platform:supportDesk.noWithdrawals')} className="border-none" />
                </TableStateRow>
              ) : (
                rows.map((row) => (
                  <WithdrawalRow
                    key={row.id}
                    row={row}
                    ticket={tickets.find((ticket) => ticket.withdrawal_request_id === row.id) ?? null}
                  />
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  )
}

function WithdrawalRow({ row, ticket }: { row: WithdrawalRequestRow; ticket: SupportTicketRow | null }) {
  const { t } = useTranslation()
  const intl = usePlatformIntl()
  const { can } = usePlatformPermissions()
  const { toast } = useToast()
  const navigate = useNavigate()
  const complete = useCompleteWithdrawal()
  const openTicket = useOpenSupportTicket()
  const [completing, setCompleting] = useState(false)
  const canAct = can('marketplace.withdraw')

  return (
    <>
      <TableRow>
        <TableCell>
          <span className="block truncate font-medium text-ink-950">
            {row.professional_display_name ?? row.professional_id}
          </span>
          <span className="block truncate text-xs text-ink-500">
            {row.professional_handle ? `@${row.professional_handle}` : '—'}
            {row.is_still_public ? ` · ${t('platform:supportDesk.stillPublic')}` : ''}
          </span>
        </TableCell>
        <TableCell className="text-ink-500">{row.requested_via}</TableCell>
        <TableCell>
          <DeadlineBadge hoursRemaining={row.hours_remaining} isOverdue={row.is_overdue} />
          <span className="mt-1 block whitespace-nowrap text-xs text-ink-500">
            {intl.dateTime(row.deadline_at)}
          </span>
        </TableCell>
        <TableCell className="text-end">
          {canAct ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" onClick={() => setCompleting(true)}>
                {t('platform:supportDesk.completeWithdrawal')}
              </Button>
              {ticket ? (
                <Link
                  to={`/platform/support/${ticket.id}`}
                  className="self-center text-sm font-medium text-accent-600 underline underline-offset-2"
                >
                  {ticket.reference}
                </Link>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  isLoading={openTicket.isPending}
                  onClick={() =>
                    openTicket.mutate(
                      {
                        origin: 'gdpr_withdrawal',
                        withdrawalRequestId: row.id,
                        professionalId: row.professional_id,
                        subject: t('platform:supportDesk.withdrawalSubject', {
                          name: row.professional_display_name ?? row.professional_id,
                        }),
                      },
                      {
                        onSuccess: (created) => {
                          toast({ title: t('platform:supportDesk.ticketOpened'), variant: 'success' })
                          navigate(`/platform/support/${created.id}`)
                        },
                        onError: (error) =>
                          toast({
                            title: t('platform:supportDesk.ticketFailed'),
                            description: failureDescription(error, t),
                            variant: 'error',
                          }),
                      },
                    )
                  }
                >
                  {t('platform:supportDesk.openTicket')}
                </Button>
              )}
            </div>
          ) : null}
        </TableCell>
      </TableRow>

      <CompleteWithdrawalDialog
        open={completing}
        onOpenChange={setCompleting}
        isPending={complete.isPending}
        onConfirm={async (note) => {
          try {
            await complete.mutateAsync({ requestId: row.id, note: note || null })
            toast({ title: t('platform:supportDesk.withdrawalCompleted'), variant: 'success' })
            setCompleting(false)
          } catch (error) {
            toast({
              title: t('platform:supportDesk.completeFailed'),
              description: failureDescription(error, t),
              variant: 'error',
            })
          }
        }}
      />
    </>
  )
}

function CompleteWithdrawalDialog({
  open,
  onOpenChange,
  isPending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  isPending: boolean
  onConfirm: (note: string) => Promise<void>
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('platform:supportDesk.completeWithdrawal')}</DialogTitle>
          <DialogDescription>{t('platform:supportDesk.completeWithdrawalDescription')}</DialogDescription>
        </DialogHeader>
        <CompleteWithdrawalForm isPending={isPending} onCancel={() => onOpenChange(false)} onConfirm={onConfirm} />
      </DialogContent>
    </Dialog>
  )
}

function CompleteWithdrawalForm({
  isPending,
  onCancel,
  onConfirm,
}: {
  isPending: boolean
  onCancel: () => void
  onConfirm: (note: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const { register, handleSubmit, formState } = useForm<{ note: string }>({ defaultValues: { note: '' } })

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit(async (values) => {
        await onConfirm(values.note.trim())
      })}
    >
      <Textarea label={t('common:field.notesOptional')} {...register('note')} />
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('common:action.cancel')}
        </Button>
        <Button type="submit" isLoading={isPending || formState.isSubmitting}>
          {t('platform:supportDesk.completeWithdrawal')}
        </Button>
      </DialogFooter>
    </form>
  )
}

// ============================================================================
// 2. La file de tickets
// ============================================================================

/**
 * DÉJÀ TRIÉE PAR LA BASE : le retard d'abord, puis l'échéance, puis la date
 * (`list_support_tickets`, migration §3). Ne retrie pas — une deuxième règle
 * de tri côté client finirait par contredire la première.
 */
function TicketTable({ tickets, mineOnly }: { tickets: SupportTicketRow[]; mineOnly: boolean }) {
  const { t } = useTranslation()
  const vocabulary = useSupportVocabulary()

  return (
    <Table label={t('platform:supportDesk.queue')}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('platform:supportDesk.colReference')}</TableHead>
          <TableHead>{t('platform:supportDesk.colSubject')}</TableHead>
          <TableHead>{t('platform:supportDesk.colOrigin')}</TableHead>
          <TableHead>{t('common:field.status')}</TableHead>
          <TableHead>{t('platform:supportDesk.colDeadline')}</TableHead>
          <TableHead>{t('platform:supportDesk.colAssignee')}</TableHead>
          <TableHead>{t('platform:supportDesk.colMessages')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tickets.length === 0 ? (
          <TableStateRow colSpan={7}>
            <EmptyState
              title={mineOnly ? t('platform:supportDesk.queueEmptyMine') : t('platform:supportDesk.queueEmpty')}
              className="border-none"
            />
          </TableStateRow>
        ) : (
          tickets.map((ticket) => (
            <TableRow key={ticket.id}>
              <TableCell className="whitespace-nowrap font-mono text-xs">
                <Link
                  to={`/platform/support/${ticket.id}`}
                  className="font-medium text-accent-600 underline underline-offset-2"
                >
                  {ticket.reference}
                </Link>
              </TableCell>
              <TableCell className="max-w-[18rem] truncate font-medium text-ink-950">
                {/* Le sujet est la plus grande cible de la ligne : il mène au ticket lui aussi. */}
                <Link to={`/platform/support/${ticket.id}`} className="hover:underline">
                  {ticket.subject}
                </Link>
              </TableCell>
              <TableCell className="text-ink-500">{vocabulary.origin(ticket.origin)}</TableCell>
              <TableCell>
                <Badge variant={vocabulary.statusVariant(ticket.status)}>{vocabulary.status(ticket.status)}</Badge>
              </TableCell>
              <TableCell>
                <DeadlineBadge hoursRemaining={ticket.hours_remaining} isOverdue={ticket.is_overdue} />
              </TableCell>
              <TableCell className="max-w-[14rem] truncate text-ink-500">
                {ticket.assigned_to_email ?? t('platform:supportDesk.unassigned')}
              </TableCell>
              <TableCell className="text-ink-500">{ticket.message_count}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

// ============================================================================
// 3. Nouvel appel
// ============================================================================

const newCallSchema = z.object({
  subject: z.string().trim().min(1),
  body: z.string(),
  organizationId: z.string(),
})
type NewCallValues = z.infer<typeof newCallSchema>

function NewCallDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('platform:supportDesk.newCall')}</DialogTitle>
          <DialogDescription>{t('platform:supportDesk.newCallDescription')}</DialogDescription>
        </DialogHeader>
        <NewCallForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function NewCallForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const navigate = useNavigate()
  const organizationsQuery = useAllOrganizations()
  const openTicket = useOpenSupportTicket()
  const { register, handleSubmit, formState } = useForm<NewCallValues>({
    resolver: zodResolver(newCallSchema),
    defaultValues: { subject: '', body: '', organizationId: '' },
  })

  const organizationOptions = useMemo(
    () => [
      { value: '', label: t('platform:supportDesk.noOrganization') },
      ...(organizationsQuery.data ?? []).map((organization) => ({
        value: organization.id,
        label: organization.name,
      })),
    ],
    [organizationsQuery.data, t],
  )

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit(async (values) => {
        try {
          /*
           * ORIGINE `phone` — la saisie manuelle, la seule qu'un humain
           * déclenche depuis cet écran. `report` et `inbound_email` ne sont
           * PAS proposées : le serveur les refuse (`origin_not_wired`) parce
           * que rien ne les alimente. Les proposer laisserait croire à un
           * circuit qui n'existe pas ; une phrase honnête vaut mieux.
           */
          const created = await openTicket.mutateAsync({
            origin: 'phone',
            subject: values.subject.trim(),
            body: values.body.trim() || null,
            organizationId: values.organizationId || null,
          })
          toast({ title: t('platform:supportDesk.ticketOpened'), variant: 'success' })
          onDone()
          navigate(`/platform/support/${created.id}`)
        } catch (error) {
          toast({
            title: t('platform:supportDesk.ticketFailed'),
            description: failureDescription(error, t),
            variant: 'error',
          })
        }
      })}
    >
      <TextField
        label={t('platform:supportDesk.subjectLabel')}
        error={formState.errors.subject ? t('platform:supportDesk.subjectRequired') : undefined}
        autoComplete="off"
        {...register('subject')}
      />
      <Textarea label={t('common:field.description')} {...register('body')} />
      <SelectField
        label={t('platform:supportDesk.attachOrganization')}
        options={organizationOptions}
        {...register('organizationId')}
      />
      <p className="text-xs text-ink-500">{t('platform:supportDesk.originsNotWired')}</p>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('common:action.cancel')}
        </Button>
        <Button type="submit" isLoading={formState.isSubmitting || openTicket.isPending}>
          {t('platform:supportDesk.openTicket')}
        </Button>
      </DialogFooter>
    </form>
  )
}

// ============================================================================
// 4. Ouvrir un dossier de salon
// ============================================================================

/**
 * LE SEUL CHEMIN VERS UN DOSSIER SANS TICKET, et il ne mène qu'aux salons.
 *
 * Il n'existe AUCUNE recherche de client par téléphone ou par e-mail : X3 a
 * fermé les oracles d'existence et aucune RPC d'annuaire client n'existe. Le
 * dossier d'un client n'est donc atteignable que depuis un ticket qui le
 * référence. L'écran le DIT plutôt que de laisser chercher un champ absent.
 */
function ShopDossierOpener() {
  const { t } = useTranslation()
  const organizationsQuery = useAllOrganizations()
  const [choice, setChoice] = useState('')
  const [opened, setOpened] = useState<string | null>(null)

  return (
    <section className="mt-8">
      <SectionHeader title={t('platform:supportDesk.openShopDossier')} />
      <p className="mt-1 text-sm text-ink-500">{t('platform:supportDesk.openShopDossierHint')}</p>

      <Card className="mt-3">
        <CardContent className="p-4 pt-4">
          {organizationsQuery.isPending ? (
            <Skeleton className="h-11 w-full" />
          ) : organizationsQuery.isError ? (
            <ErrorState
              title={t('common:errors.somethingWentWrong')}
              description={failureDescription(organizationsQuery.error, t)}
            />
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="flex-1">
                <SelectField
                  label={t('platform:supportDesk.chooseShop')}
                  value={choice}
                  onChange={(event) => setChoice(event.target.value)}
                  options={[
                    { value: '', label: t('platform:supportDesk.noOrganization') },
                    ...(organizationsQuery.data ?? []).map((organization) => ({
                      value: organization.id,
                      label: organization.name,
                    })),
                  ]}
                />
              </div>
              {/*
                UN GESTE EXPLICITE OUVRE LE DOSSIER, jamais la simple sélection :
                `get_platform_organization_dossier` écrit une ligne d'audit AVANT
                de lire, et une ligne de journal doit correspondre à quelqu'un
                qui a décidé de regarder.
              */}
              <Button disabled={!choice} onClick={() => setOpened(choice)}>
                {t('platform:supportDesk.openDossier')}
              </Button>
              {opened ? (
                <Button variant="secondary" onClick={() => setOpened(null)}>
                  {t('platform:supportDesk.closeDossier')}
                </Button>
              ) : null}
            </div>
          )}

          <p className="mt-4 text-xs text-ink-500">{t('platform:supportDesk.noCustomerSearch')}</p>
        </CardContent>
      </Card>

      {opened ? (
        <div className="mt-4">
          <OrganizationDossier organizationId={opened} />
        </div>
      ) : null}
    </section>
  )
}

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
