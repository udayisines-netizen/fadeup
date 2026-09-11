import { useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import { usePlatformTeam } from '@/lib/queries/platform'
import {
  useAddSupportTicketMessage,
  useAssignSupportTicket,
  useCancelAppointmentAsPlatform,
  usePlatformDossier,
  useRemoveQueueEntryAsPlatform,
  useResendPlatformEmail,
  useSetSupportTicketStatus,
  useSupportTicket,
  type SupportTicketMessageKind,
  type SupportTicketOrigin,
  type SupportTicketStatus,
} from '@/lib/queries/platform-plat2'
import { Alert } from '@/components/ui/alert'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader, SectionHeader } from '@/components/ui/page-header'
import { SelectField } from '@/components/ui/select-field'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import type { PlatformPermission } from '@/lib/types'

/**
 * /platform/support/:ticketId — LE TICKET ET SON DOSSIER.
 *
 * CETTE PAGE ÉCRIT AU JOURNAL RIEN QU'EN S'OUVRANT. `get_support_ticket`
 * insère une ligne `support_ticket_viewed` à chaque appel, et chaque dossier
 * insère un `support_dossier_viewed` AVANT de lire (migration §4). C'est
 * voulu : « chaque consultation de dossier est tracée ». La contrepartie est
 * une règle que cette page tient strictement — AUCUN rafraîchissement
 * automatique. Pas de `refetchInterval`, pas de `refetchOnWindowFocus`, pas
 * de `refetch()` appelé à la main, pas d'`invalidate` gratuit : un onglet
 * laissé ouvert écrirait une ligne d'audit par minute et le journal ne
 * voudrait plus rien dire. Les hooks sont déjà réglés ainsi dans
 * `platform-plat2.ts` ; ce fichier ne doit pas les contourner.
 *
 * Les seuls rafraîchissements sont ceux qu'un GESTE humain déclenche : les
 * mutations invalident leur propre clé, ce qui est la trace d'un humain qui a
 * agi, pas d'un onglet qui respire.
 */

/**
 * Les quatre droits posés par la migration PLAT-2 §1 ne figurent pas encore
 * dans l'union `PlatformPermission` de `@/lib/types` — fichier partagé, hors
 * du périmètre de ce lot. La conversion est donc nommée ici une seule fois
 * plutôt que dispersée : `get_my_platform_permissions` rend des chaînes et
 * `can()` compare des chaînes, le comportement d'exécution est exact.
 * À REMONTER : ajouter ces quatre clés à `PlatformPermission`.
 */
export const SUPPORT_PERMISSION = {
  tickets: 'support.tickets' as PlatformPermission,
  dossier: 'support.dossier' as PlatformPermission,
  queueRemove: 'queue.remove' as PlatformPermission,
  emailResend: 'email.resend' as PlatformPermission,
}

/** Les rôles que le serveur accepte comme assignataires (`assignee_not_support`). */
const TICKET_HANDLING_ROLES = ['platform_owner', 'platform_admin', 'platform_support']

const ORIGIN_KEY: Record<SupportTicketOrigin, string> = {
  phone: 'originPhone',
  gdpr_withdrawal: 'originGdprWithdrawal',
  report: 'originReport',
  inbound_email: 'originInboundEmail',
}

const STATUS_KEY: Record<SupportTicketStatus, string> = {
  open: 'statusOpen',
  waiting: 'statusWaiting',
  resolved: 'statusResolved',
}

const STATUS_BADGE: Record<SupportTicketStatus, BadgeVariant> = {
  open: 'info',
  waiting: 'warning',
  resolved: 'success',
}

const MESSAGE_KIND_KEY: Record<SupportTicketMessageKind, string> = {
  note: 'kindNote',
  inbound: 'kindInbound',
  outbound: 'kindOutbound',
  status_change: 'kindStatusChange',
  assignment: 'kindAssignment',
  action: 'kindAction',
}

/**
 * Le vocabulaire du ticket, traduit à CHAQUE lecture.
 *
 * Une `Record<Status, string>` de mots constants serait évaluée au chargement
 * du module, avant qu'une langue existe — c'est le motif que
 * `no-untranslated-status-maps.test.ts` rejette. Les tables ci-dessus ne
 * portent que des CLÉS.
 */
export function useSupportVocabulary() {
  const { t } = useTranslation()
  return useMemo(
    () => ({
      origin: (value: SupportTicketOrigin) => t(`platform:supportDesk.${ORIGIN_KEY[value]}`),
      status: (value: SupportTicketStatus) => t(`platform:supportDesk.${STATUS_KEY[value]}`),
      messageKind: (value: SupportTicketMessageKind) => t(`platform:supportDesk.${MESSAGE_KIND_KEY[value]}`),
      statusVariant: (value: SupportTicketStatus) => STATUS_BADGE[value],
    }),
    [t],
  )
}

/** Le motif nommé d'un refus serveur (`fadeup_*_refusal=…`), s'il y en a un. */
export function refusalOf(error: unknown): string | undefined {
  const details =
    error && typeof error === 'object' && 'details' in error ? (error as { details?: unknown }).details : undefined
  const haystack = `${typeof details === 'string' ? details : ''} ${getErrorMessage(error) ?? ''}`
  return /fadeup_[a-z_]*refusal=([a-z_]+)/.exec(haystack)?.[1]
}

/** La description d'un toast d'échec : le message serveur, et son motif quand il en porte un. */
export function failureDescription(error: unknown): string | undefined {
  const parts = [getErrorMessage(error), refusalOf(error)].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * L'ÉCHÉANCE QUI DÉFILE, telle que la base la calcule.
 *
 * `hours_remaining` et `is_overdue` viennent de Postgres (B2, puis PLAT-2) :
 * rien n'est recalculé ici. Un compte à rebours dessiné côté client dériverait
 * de l'horloge du poste et dirait autre chose que le serveur — et c'est le
 * serveur qui tient la promesse des 72 heures.
 */
export function DeadlineBadge({
  hoursRemaining,
  isOverdue,
}: {
  hoursRemaining: number | null
  isOverdue: boolean
}) {
  const { t, i18n } = useTranslation()
  const formatter = useMemo(
    () => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }),
    [i18n.language],
  )

  if (hoursRemaining === null) return <span className="text-ink-300">—</span>

  const hours = formatter.format(Math.abs(hoursRemaining))
  if (isOverdue) {
    return <Badge variant="danger">{t('platform:supportDesk.overdueBy', { hours })}</Badge>
  }
  return (
    <Badge variant={hoursRemaining <= 12 ? 'warning' : 'neutral'}>
      {t('platform:supportDesk.hoursLeft', { hours })}
    </Badge>
  )
}

// ============================================================================
// Le motif obligatoire — une seule modale pour les trois actions
// ============================================================================

/**
 * Les trois actions de premier niveau EXIGENT un motif côté serveur
 * (`fadeup_platform_refusal=reason_required`). Le formulaire l'exige aussi,
 * pour que le refus n'ait pas à servir de validation.
 */
function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  required,
  isPending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  required: boolean
  isPending: boolean
  onConfirm: (reason: string) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ReasonForm
          confirmLabel={confirmLabel}
          required={required}
          isPending={isPending}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      </DialogContent>
    </Dialog>
  )
}

function ReasonForm({
  confirmLabel,
  required,
  isPending,
  onCancel,
  onConfirm,
}: {
  confirmLabel: string
  required: boolean
  isPending: boolean
  onCancel: () => void
  onConfirm: (reason: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const schema = useMemo(
    () =>
      z.object({
        reason: required
          ? z.string().trim().min(1, t('platform:supportDesk.reasonRequired'))
          : z.string(),
      }),
    [required, t],
  )
  const { register, handleSubmit, formState } = useForm<{ reason: string }>({
    resolver: zodResolver(schema),
    defaultValues: { reason: '' },
  })

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit(async (values) => {
        await onConfirm(values.reason.trim())
      })}
    >
      <Textarea
        label={required ? t('common:field.reason') : t('common:field.notesOptional')}
        error={formState.errors.reason?.message}
        {...register('reason')}
      />
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('common:action.cancel')}
        </Button>
        <Button type="submit" isLoading={isPending || formState.isSubmitting}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

// ============================================================================
// La page
// ============================================================================

export function PlatformSupportTicketPage() {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()

  /*
   * LA GARDE EST UN COMPOSANT, PAS UN `if` DANS LE CORPS. Tant qu'elle refuse,
   * `useSupportTicket` n'est jamais monté — donc aucune ligne d'audit et aucun
   * appel RPC pour un rôle qui n'a rien à faire ici.
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

  return <SupportTicket />
}

function SupportTicket() {
  const { t } = useTranslation()
  const { ticketId } = useParams<{ ticketId: string }>()
  const vocabulary = useSupportVocabulary()
  const ticketQuery = useSupportTicket(ticketId)

  const backLink = (
    <Link to="/platform/support" className="text-sm font-medium text-accent-600 underline underline-offset-2">
      {t('platform:supportDesk.backToQueue')}
    </Link>
  )

  if (ticketQuery.isPending) {
    return (
      <Container size="lg" className="py-8">
        {backLink}
        <div className="mt-4 flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Container>
    )
  }

  if (ticketQuery.isError) {
    return (
      <Container size="lg" className="py-8">
        {backLink}
        <ErrorState
          className="mt-4"
          title={t('platform:supportDesk.loadTicketFailed')}
          description={failureDescription(ticketQuery.error)}
        />
      </Container>
    )
  }

  const { ticket, messages } = ticketQuery.data

  return (
    <Container size="lg" className="py-8">
      {backLink}

      <PageHeader
        className="mt-4"
        title={ticket.subject}
        subtitle={`${ticket.reference} · ${vocabulary.origin(ticket.origin)}`}
        actions={
          <>
            <Badge variant={vocabulary.statusVariant(ticket.status)}>{vocabulary.status(ticket.status)}</Badge>
            {ticket.due_at ? (
              <DeadlineBadge hoursRemaining={ticket.hours_remaining} isOverdue={ticket.is_overdue} />
            ) : null}
          </>
        }
      />

      {ticket.is_overdue ? (
        <Alert variant="error" className="mt-4">
          {t('platform:supportDesk.ticketOverdue')}
        </Alert>
      ) : null}

      <Card className="mt-6">
        <CardContent className="grid gap-4 p-4 pt-4 sm:grid-cols-2">
          <KeyValue label={t('platform:supportDesk.colReference')} value={ticket.reference} />
          <KeyValue label={t('platform:supportDesk.colOrigin')} value={vocabulary.origin(ticket.origin)} />
          <KeyValue
            label={t('platform:supportDesk.colAssignee')}
            value={ticket.assigned_to_email ?? t('platform:supportDesk.unassigned')}
          />
          <KeyValue label={t('platform:supportDesk.openedBy')} value={ticket.opened_by_email ?? '—'} />
          <KeyValue label={t('common:field.created')} value={new Date(ticket.created_at).toLocaleString()} />
          <KeyValue
            label={t('platform:supportDesk.colDeadline')}
            value={ticket.due_at ? new Date(ticket.due_at).toLocaleString() : '—'}
          />
          {ticket.organization_name ? (
            <KeyValue label={t('platform:supportDesk.dossierOrganization')} value={ticket.organization_name} />
          ) : null}
          {ticket.professional_display_name ? (
            <KeyValue
              label={t('platform:supportDesk.dossierProfessional')}
              value={ticket.professional_display_name}
            />
          ) : null}
          {ticket.subject_user_email ? (
            <KeyValue label={t('platform:supportDesk.dossierCustomer')} value={ticket.subject_user_email} />
          ) : null}
          {ticket.body ? (
            <div className="sm:col-span-2">
              <KeyValue label={t('common:field.description')} value={ticket.body} />
            </div>
          ) : null}
          {ticket.resolution ? (
            <div className="sm:col-span-2">
              <KeyValue label={t('platform:supportDesk.resolutionHeading')} value={ticket.resolution} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <TicketActions
        ticketId={ticket.id}
        status={ticket.status}
        assignedTo={ticket.assigned_to}
      />

      <section className="mt-8">
        <SectionHeader title={t('platform:supportDesk.thread')} />
        <p className="mt-1 text-sm text-ink-500">{t('platform:supportDesk.threadAppendOnly')}</p>
        {/*
          AJOUT SEUL. Le déclencheur `reject_support_ticket_message_mutation`
          refuse toute mise à jour et toute suppression — y compris au
          propriétaire de la base. Ne rends donc AUCUN bouton qui laisserait
          croire qu'un message se modifie ou s'efface.
        */}
        <ol className="mt-3 flex flex-col gap-3" aria-label={t('platform:supportDesk.thread')}>
          {messages.length === 0 ? (
            <li>
              <EmptyState title={t('platform:supportDesk.threadEmpty')} />
            </li>
          ) : (
            messages.map((message) => (
              <li key={message.id}>
                <Card>
                  <CardContent className="p-4 pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="neutral">{vocabulary.messageKind(message.kind)}</Badge>
                      <span className="text-xs text-ink-500">
                        {message.author_email ?? '—'} · {new Date(message.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-ink-950">{message.body}</p>
                  </CardContent>
                </Card>
              </li>
            ))
          )}
        </ol>

        <AddMessageForm ticketId={ticket.id} />
      </section>

      <TicketDossiers
        organizationId={ticket.organization_id}
        professionalId={ticket.professional_id}
        subjectUserId={ticket.subject_user_id}
      />
    </Container>
  )
}

function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-ink-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink-950">{value}</dd>
    </div>
  )
}

// ============================================================================
// Assigner, mettre en attente, résoudre
// ============================================================================

function TicketActions({
  ticketId,
  status,
  assignedTo,
}: {
  ticketId: string
  status: SupportTicketStatus
  assignedTo: string | null
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const vocabulary = useSupportVocabulary()
  const teamQuery = usePlatformTeam()
  const assign = useAssignSupportTicket()
  const setStatus = useSetSupportTicketStatus()
  const [resolving, setResolving] = useState(false)

  /*
   * `list_platform_team()` rend ZÉRO ligne à qui n'a pas `internal_team.read`
   * — un support ordinaire, précisément. Un menu vide sans un mot était le
   * défaut relevé sur /platform/team : ici on le DIT.
   */
  const handlers = (teamQuery.data ?? []).filter((member) => TICKET_HANDLING_ROLES.includes(member.role))

  function changeStatus(next: SupportTicketStatus) {
    setStatus.mutate(
      { ticketId, status: next },
      {
        onSuccess: () => toast({ title: t('platform:supportDesk.statusChanged') }),
        onError: (error) =>
          toast({
            title: t('platform:supportDesk.statusFailed'),
            description: failureDescription(error),
            variant: 'error',
          }),
      },
    )
  }

  return (
    <section className="mt-8">
      <SectionHeader title={t('platform:supportDesk.handling')} />
      <Card className="mt-3">
        <CardContent className="flex flex-col gap-4 p-4 pt-4">
          <div className="sm:max-w-sm">
            {teamQuery.isError ? (
              <p className="text-sm text-ink-500">{t('platform:supportDesk.teamNotVisible')}</p>
            ) : teamQuery.isPending ? (
              <Skeleton className="h-11 w-full" />
            ) : handlers.length === 0 ? (
              <p className="text-sm text-ink-500">{t('platform:supportDesk.teamNotVisible')}</p>
            ) : (
              <SelectField
                label={t('platform:supportDesk.assignTo')}
                value={assignedTo ?? ''}
                onChange={(event) =>
                  assign.mutate(
                    { ticketId, assignee: event.target.value || null },
                    {
                      onSuccess: () => toast({ title: t('platform:supportDesk.assigned') }),
                      onError: (error) =>
                        toast({
                          title: t('platform:supportDesk.assignFailed'),
                          description: failureDescription(error),
                          variant: 'error',
                        }),
                    },
                  )
                }
                options={[
                  { value: '', label: t('platform:supportDesk.unassigned') },
                  ...handlers.map((member) => ({
                    value: member.userId,
                    label: member.email ?? member.userId,
                  })),
                ]}
              />
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {status !== 'open' ? (
              <Button variant="secondary" size="sm" onClick={() => changeStatus('open')}>
                {t('platform:supportDesk.reopen')}
              </Button>
            ) : null}
            {status === 'open' ? (
              <Button variant="secondary" size="sm" onClick={() => changeStatus('waiting')}>
                {t('platform:supportDesk.markWaiting')}
              </Button>
            ) : null}
            {status !== 'resolved' ? (
              <Button size="sm" onClick={() => setResolving(true)}>
                {t('platform:supportDesk.resolve')}
              </Button>
            ) : (
              <span className="self-center text-sm text-ink-500">
                {vocabulary.status('resolved')}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/*
        LA RÉSOLUTION EXIGE SON MOT côté serveur
        (`fadeup_support_refusal=resolution_required`). Le formulaire l'exige
        aussi : un refus n'est pas un message d'aide.
      */}
      <ReasonDialog
        open={resolving}
        onOpenChange={setResolving}
        title={t('platform:supportDesk.resolveTitle')}
        description={t('platform:supportDesk.resolveDescription')}
        confirmLabel={t('platform:supportDesk.resolve')}
        required
        isPending={setStatus.isPending}
        onConfirm={async (reason) => {
          try {
            await setStatus.mutateAsync({ ticketId, status: 'resolved', resolution: reason })
            toast({ title: t('platform:supportDesk.statusChanged'), variant: 'success' })
            setResolving(false)
          } catch (error) {
            toast({
              title: t('platform:supportDesk.statusFailed'),
              description: failureDescription(error),
              variant: 'error',
            })
          }
        }}
      />
    </section>
  )
}

const messageSchema = z.object({
  body: z.string().trim().min(1),
  kind: z.enum(['note', 'inbound', 'outbound']),
})
type MessageValues = z.infer<typeof messageSchema>

function AddMessageForm({ ticketId }: { ticketId: string }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const vocabulary = useSupportVocabulary()
  const addMessage = useAddSupportTicketMessage()
  const { register, handleSubmit, reset, formState } = useForm<MessageValues>({
    resolver: zodResolver(messageSchema),
    defaultValues: { body: '', kind: 'note' },
  })

  return (
    <Card className="mt-4">
      <CardContent className="p-4 pt-4">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={handleSubmit(async (values) => {
            try {
              await addMessage.mutateAsync({ ticketId, body: values.body.trim(), kind: values.kind })
              toast({ title: t('platform:supportDesk.noteAdded'), variant: 'success' })
              reset({ body: '', kind: values.kind })
            } catch (error) {
              toast({
                title: t('platform:supportDesk.noteFailed'),
                description: failureDescription(error),
                variant: 'error',
              })
            }
          })}
        >
          <Textarea
            label={t('platform:supportDesk.noteLabel')}
            error={formState.errors.body ? t('platform:supportDesk.noteRequired') : undefined}
            {...register('body')}
          />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="sm:w-56">
              {/*
                Les trois genres système (changement de statut, assignation,
                action) sont refusés par le serveur : ils sont la trace d'un
                geste, pas un texte qu'on peut écrire sans l'avoir fait.
              */}
              <SelectField
                label={t('platform:supportDesk.noteKind')}
                options={(['note', 'inbound', 'outbound'] as const).map((kind) => ({
                  value: kind,
                  label: vocabulary.messageKind(kind),
                }))}
                {...register('kind')}
              />
            </div>
            <Button type="submit" isLoading={formState.isSubmitting || addMessage.isPending}>
              {t('platform:supportDesk.addNote')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// Les dossiers — LECTURE. Trois actions, chacune sous son droit et son motif.
// ============================================================================

function TicketDossiers({
  organizationId,
  professionalId,
  subjectUserId,
}: {
  organizationId: string | null
  professionalId: string | null
  subjectUserId: string | null
}) {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()

  if (!organizationId && !professionalId && !subjectUserId) return null

  if (!can(SUPPORT_PERMISSION.dossier)) {
    return (
      <section className="mt-8">
        <SectionHeader title={t('platform:supportDesk.dossierHeading')} />
        <Card className="mt-3">
          <CardContent className="p-4 pt-4">
            <EmptyState title={t('platform:supportDesk.dossierNotForYourRole')} className="border-none" />
          </CardContent>
        </Card>
      </section>
    )
  }

  return (
    <section className="mt-8">
      <SectionHeader title={t('platform:supportDesk.dossierHeading')} meta={t('platform:supportDesk.dossierTraced')} />
      <div className="mt-3 flex flex-col gap-6">
        {subjectUserId ? <CustomerDossier userId={subjectUserId} /> : null}
        {professionalId ? <ProfessionalDossier professionalId={professionalId} /> : null}
        {organizationId ? <OrganizationDossier organizationId={organizationId} /> : null}
      </div>
    </section>
  )
}

/** Le cadre commun : titre, squelette, erreur, et le contenu quand il existe. */
function DossierCard({
  title,
  isPending,
  isError,
  error,
  children,
}: {
  title: string
  isPending: boolean
  isError: boolean
  error: unknown
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardContent className="p-4 pt-4">
        <h3 className="text-sm font-semibold text-ink-950">{title}</h3>
        <div className="mt-3">
          {isPending ? (
            <div className="flex flex-col gap-2" aria-hidden="true">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-3/4" />
            </div>
          ) : isError ? (
            <ErrorState title={t('platform:supportDesk.dossierError')} description={failureDescription(error)} />
          ) : (
            children
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function DossierBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</h4>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function DossierNothing() {
  const { t } = useTranslation()
  return <p className="text-sm text-ink-500">{t('platform:supportDesk.nothingHere')}</p>
}

/**
 * La forme exacte des trois dossiers est celle de la migration §4. Elle est
 * décrite ici en types plutôt que relue par tâtonnement : `jsonb_build_object`
 * rend `null` pour un sous-objet absent et `[]` pour toute liste (coalesce),
 * jamais `undefined`.
 */
interface DossierAppointment {
  id: string
  organization_name?: string | null
  starts_at: string
  status: string
  service_name?: string | null
  customer_name?: string | null
  was_request?: boolean
  expires_at?: string | null
}

interface DossierQueueEntry {
  id: string
  organization_name?: string | null
  customer_name: string | null
  status: string
  created_at: string
}

interface DossierInterestRequest {
  id: string
  professional_display_name?: string | null
  service_label: string | null
  preferred_starts_at: string | null
  status: string
  expires_at: string | null
}

interface DossierEmail {
  id: string
  template: string
  status: string
  created_at: string
  sent_at: string | null
  bounced_at: string | null
  last_error: string | null
}

interface CustomerDossierData {
  identity: { user_id: string; email: string | null; created_at: string; full_name: string | null; locale: string | null } | null
  appointments: DossierAppointment[]
  queue_entries: DossierQueueEntry[]
  interest_requests: DossierInterestRequest[]
  recent_emails: DossierEmail[]
}

function CustomerDossier({ userId }: { userId: string }) {
  const { t } = useTranslation()
  const query = usePlatformDossier('customer', userId)
  const data = query.data as CustomerDossierData | undefined

  return (
    <DossierCard
      title={t('platform:supportDesk.dossierCustomer')}
      isPending={query.isPending}
      isError={query.isError}
      error={query.error}
    >
      {!data ? null : (
        <>
          <DossierBlock title={t('platform:supportDesk.identity')}>
            {data.identity ? (
              <dl className="grid gap-3 sm:grid-cols-2">
                <KeyValue label={t('common:field.email')} value={data.identity.email ?? '—'} />
                <KeyValue label={t('common:field.name')} value={data.identity.full_name ?? '—'} />
                <KeyValue label={t('common:field.locale')} value={data.identity.locale ?? '—'} />
                <KeyValue
                  label={t('common:field.created')}
                  value={new Date(data.identity.created_at).toLocaleDateString()}
                />
              </dl>
            ) : (
              <DossierNothing />
            )}
          </DossierBlock>

          <DossierBlock title={t('platform:supportDesk.appointments')}>
            <AppointmentsTable appointments={data.appointments} showOrganization />
          </DossierBlock>

          <DossierBlock title={t('platform:supportDesk.queueEntries')}>
            <QueueEntriesTable entries={data.queue_entries} showOrganization />
          </DossierBlock>

          <DossierBlock title={t('platform:supportDesk.interestRequests')}>
            <InterestRequestsTable requests={data.interest_requests} />
          </DossierBlock>

          <DossierBlock title={t('platform:supportDesk.recentEmails')}>
            <EmailsTable emails={data.recent_emails} />
          </DossierBlock>
        </>
      )}
    </DossierCard>
  )
}

interface ProfessionalDossierData {
  identity: {
    id: string
    display_name: string
    handle: string | null
    claim_state: string
    is_public: boolean
    source: string | null
    claimed_at: string | null
    created_at: string
    account_email: string | null
  } | null
  claims: { id: string; state: string; submitted_at: string; decided_at: string | null; decision_note: string | null; claimant_email: string | null }[]
  withdrawal_requests: {
    id: string
    status: string
    requested_via: string
    requested_at: string
    deadline_at: string
    hours_remaining: number
    is_overdue: boolean
    decided_at: string | null
  }[]
  interest_requests: DossierInterestRequest[]
  reviews: { published: number; moderated: number }
  workplace: { organization_id: string; organization_name: string; organization_slug: string } | null
  prospect: { prospect_id: string; canonical_name: string; origin: string; status: string; do_not_contact: boolean } | null
}

function ProfessionalDossier({ professionalId }: { professionalId: string }) {
  const { t } = useTranslation()
  const query = usePlatformDossier('professional', professionalId)
  const data = query.data as ProfessionalDossierData | undefined

  return (
    <DossierCard
      title={t('platform:supportDesk.dossierProfessional')}
      isPending={query.isPending}
      isError={query.isError}
      error={query.error}
    >
      {!data ? null : (
        <>
          <DossierBlock title={t('platform:supportDesk.identity')}>
            {data.identity ? (
              <dl className="grid gap-3 sm:grid-cols-2">
                <KeyValue
                  label={t('common:field.name')}
                  value={
                    data.identity.handle
                      ? `${data.identity.display_name} · @${data.identity.handle}`
                      : data.identity.display_name
                  }
                />
                <KeyValue label={t('platform:supportDesk.claimState')} value={data.identity.claim_state} />
                <KeyValue
                  label={t('platform:supportDesk.marketplace')}
                  value={
                    <Badge variant={data.identity.is_public ? 'success' : 'neutral'}>
                      {data.identity.is_public
                        ? t('platform:supportDesk.marketplaceVisible')
                        : t('platform:supportDesk.marketplaceHidden')}
                    </Badge>
                  }
                />
                <KeyValue label={t('common:field.email')} value={data.identity.account_email ?? '—'} />
                <KeyValue label={t('common:field.source')} value={data.identity.source ?? '—'} />
              </dl>
            ) : (
              <DossierNothing />
            )}
          </DossierBlock>

          <DossierBlock title={t('platform:supportDesk.withdrawalRequests')}>
            {data.withdrawal_requests.length === 0 ? (
              <DossierNothing />
            ) : (
              <Table label={t('platform:supportDesk.withdrawalRequests')}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common:field.status')}</TableHead>
                    <TableHead>{t('platform:supportDesk.requestedVia')}</TableHead>
                    <TableHead>{t('platform:supportDesk.colDeadline')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.withdrawal_requests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell>{request.status}</TableCell>
                      <TableCell className="text-ink-500">{request.requested_via}</TableCell>
                      <TableCell>
                        <DeadlineBadge hoursRemaining={request.hours_remaining} isOverdue={request.is_overdue} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </DossierBlock>

          <DossierBlock title={t('platform:supportDesk.claims')}>
            {data.claims.length === 0 ? (
              <DossierNothing />
            ) : (
              <Table label={t('platform:supportDesk.claims')}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common:field.state')}</TableHead>
                    <TableHead>{t('common:field.email')}</TableHead>
                    <TableHead>{t('common:field.when')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.claims.map((claim) => (
                    <TableRow key={claim.id}>
                      <TableCell>{claim.state}</TableCell>
                      <TableCell className="text-ink-500">{claim.claimant_email ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-ink-500">
                        {new Date(claim.submitted_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </DossierBlock>

          <DossierBlock title={t('platform:supportDesk.interestRequests')}>
            <InterestRequestsTable requests={data.interest_requests} />
          </DossierBlock>

          <DossierBlock title={t('platform:supportDesk.reviews')}>
            <p className="text-sm text-ink-950">
              {t('platform:supportDesk.reviewCounts', {
                published: data.reviews.published,
                moderated: data.reviews.moderated,
              })}
            </p>
          </DossierBlock>

          <DossierBlock title={t('platform:supportDesk.workplace')}>
            {data.workplace ? (
              <p className="text-sm text-ink-950">{data.workplace.organization_name}</p>
            ) : (
              <DossierNothing />
            )}
          </DossierBlock>

          <DossierBlock title={t('platform:supportDesk.prospect')}>
            {data.prospect ? (
              <p className="text-sm text-ink-950">
                {data.prospect.canonical_name} · {data.prospect.origin} · {data.prospect.status}
              </p>
            ) : (
              <DossierNothing />
            )}
          </DossierBlock>
        </>
      )}
    </DossierCard>
  )
}

interface OrganizationDossierData {
  identity: {
    id: string
    name: string
    slug: string
    business_type: string
    country_code: string
    marketplace_visible: boolean
    onboarding_completed_at: string | null
    created_at: string
  } | null
  locations: { id: string; name: string; city: string | null; country: string | null; is_active: boolean; kind: string }[]
  subscription: { plan_key: string | null; status: string | null; entitlement_source: string | null; provider: string | null; assigned_at: string | null } | null
  trial: { status: string; started_at: string | null; ends_at: string | null; converted_at: string | null } | null
  team: { role: string; email: string | null }[]
  upcoming_appointments: DossierAppointment[]
  queue: DossierQueueEntry[]
  support_sessions: { started_at: string; ended_at: string | null; expires_at: string; reason: string | null }[]
}

/**
 * Le dossier d'un salon. Exporté parce que /platform/support l'ouvre aussi
 * depuis son sélecteur d'établissement : c'est le même dossier, la même RPC
 * et la même trace au journal, pas une seconde implémentation.
 */
export function OrganizationDossier({ organizationId }: { organizationId: string }) {
  const { t } = useTranslation()
  const query = usePlatformDossier('organization', organizationId)
  const data = query.data as OrganizationDossierData | undefined

  return (
    <DossierCard
      title={t('platform:supportDesk.dossierOrganization')}
      isPending={query.isPending}
      isError={query.isError}
      error={query.error}
    >
      {!data ? null : (
        <>
          <DossierBlock title={t('platform:supportDesk.identity')}>
            {data.identity ? (
              <dl className="grid gap-3 sm:grid-cols-2">
                <KeyValue label={t('common:field.name')} value={data.identity.name} />
                <KeyValue label={t('common:field.type')} value={data.identity.business_type} />
                <KeyValue label={t('common:field.country')} value={data.identity.country_code} />
                <KeyValue
                  label={t('platform:supportDesk.marketplace')}
                  value={
                    <Badge variant={data.identity.marketplace_visible ? 'success' : 'neutral'}>
                      {data.identity.marketplace_visible
                        ? t('platform:supportDesk.marketplaceVisible')
                        : t('platform:supportDesk.marketplaceHidden')}
                    </Badge>
                  }
                />
              </dl>
            ) : (
              <DossierNothing />
            )}
          </DossierBlock>

          <DossierBlock title={t('common:entity.locations')}>
            {data.locations.length === 0 ? (
              <DossierNothing />
            ) : (
              <ul className="flex flex-col gap-1 text-sm text-ink-950">
                {data.locations.map((location) => (
                  <li key={location.id}>
                    {location.name}
                    {location.city ? ` · ${location.city}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </DossierBlock>

          {/*
            L'ABONNEMENT EST EN LECTURE, ET C'EST DIT À L'ÉCRAN. `billing.manage`
            n'appartient pas au support ; l'absence de bouton de paiement est une
            décision, pas un oubli, et une phrase vaut mieux qu'un blanc.
          */}
          <DossierBlock title={t('platform:supportDesk.subscription')}>
            {data.subscription ? (
              <dl className="grid gap-3 sm:grid-cols-2">
                <KeyValue label={t('common:field.plan')} value={data.subscription.plan_key ?? '—'} />
                <KeyValue label={t('common:field.status')} value={data.subscription.status ?? '—'} />
                <KeyValue label={t('common:field.source')} value={data.subscription.entitlement_source ?? '—'} />
              </dl>
            ) : (
              <DossierNothing />
            )}
            <p className="mt-2 text-xs text-ink-500">{t('platform:supportDesk.subscriptionReadOnly')}</p>
          </DossierBlock>

          <DossierBlock title={t('platform:supportDesk.trial')}>
            {data.trial ? (
              <p className="text-sm text-ink-950">
                {data.trial.status}
                {data.trial.ends_at ? ` · ${new Date(data.trial.ends_at).toLocaleDateString()}` : ''}
              </p>
            ) : (
              <DossierNothing />
            )}
          </DossierBlock>

          <DossierBlock title={t('common:entity.team')}>
            {data.team.length === 0 ? (
              <DossierNothing />
            ) : (
              <ul className="flex flex-col gap-1 text-sm text-ink-950">
                {data.team.map((member) => (
                  <li key={`${member.role}-${member.email ?? ''}`}>
                    {member.email ?? '—'} · {member.role}
                  </li>
                ))}
              </ul>
            )}
          </DossierBlock>

          <DossierBlock title={t('platform:supportDesk.upcomingAppointments')}>
            <AppointmentsTable appointments={data.upcoming_appointments} showOrganization={false} />
          </DossierBlock>

          <DossierBlock title={t('platform:supportDesk.liveQueue')}>
            <QueueEntriesTable entries={data.queue} showOrganization={false} />
          </DossierBlock>

          <DossierBlock title={t('platform:supportDesk.supportSessions')}>
            {data.support_sessions.length === 0 ? (
              <DossierNothing />
            ) : (
              <ul className="flex flex-col gap-1 text-sm text-ink-950">
                {data.support_sessions.map((session) => (
                  <li key={session.started_at}>
                    {new Date(session.started_at).toLocaleString()}
                    {session.reason ? ` · ${session.reason}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </DossierBlock>
        </>
      )}
    </DossierCard>
  )
}

// ============================================================================
// Les trois tableaux partagés par les dossiers, avec leurs actions
// ============================================================================

function AppointmentsTable({
  appointments,
  showOrganization,
}: {
  appointments: DossierAppointment[]
  showOrganization: boolean
}) {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()
  const { toast } = useToast()
  const cancelAppointment = useCancelAppointmentAsPlatform()
  const [target, setTarget] = useState<string | null>(null)
  const canCancel = can('appointment.cancel')

  if (appointments.length === 0) return <DossierNothing />

  return (
    <>
      <Table label={t('platform:supportDesk.appointments')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('common:field.when')}</TableHead>
            {showOrganization ? <TableHead>{t('platform:supportDesk.dossierOrganization')}</TableHead> : null}
            <TableHead>{t('platform:supportDesk.service')}</TableHead>
            <TableHead>{t('common:field.status')}</TableHead>
            {canCancel ? (
              <TableHead>
                <span className="sr-only">{t('common:action.actions')}</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {appointments.map((appointment) => (
            <TableRow key={appointment.id}>
              <TableCell className="whitespace-nowrap">
                {new Date(appointment.starts_at).toLocaleString()}
              </TableCell>
              {showOrganization ? (
                <TableCell className="text-ink-500">{appointment.organization_name ?? '—'}</TableCell>
              ) : null}
              <TableCell className="text-ink-500">
                {appointment.service_name ?? appointment.customer_name ?? '—'}
              </TableCell>
              <TableCell>{appointment.status}</TableCell>
              {canCancel ? (
                <TableCell className="text-end">
                  {/*
                    Le serveur n'annule que ce qui n'a pas encore eu lieu : ne
                    propose le geste que là où il a un sens.
                  */}
                  {appointment.status === 'pending' || appointment.status === 'confirmed' ? (
                    <Button variant="secondary" size="sm" onClick={() => setTarget(appointment.id)}>
                      {t('platform:supportDesk.cancelAppointment')}
                    </Button>
                  ) : null}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ReasonDialog
        open={target !== null}
        onOpenChange={(open) => setTarget(open ? target : null)}
        title={t('platform:supportDesk.cancelAppointment')}
        description={t('platform:supportDesk.cancelAppointmentDescription')}
        confirmLabel={t('platform:supportDesk.confirm')}
        required
        isPending={cancelAppointment.isPending}
        onConfirm={async (reason) => {
          if (!target) return
          try {
            await cancelAppointment.mutateAsync({ appointmentId: target, reason })
            toast({ title: t('platform:supportDesk.appointmentCancelled'), variant: 'success' })
            setTarget(null)
          } catch (error) {
            toast({
              title: t('platform:supportDesk.cancelFailed'),
              description: failureDescription(error),
              variant: 'error',
            })
          }
        }}
      />
    </>
  )
}

function QueueEntriesTable({
  entries,
  showOrganization,
}: {
  entries: DossierQueueEntry[]
  showOrganization: boolean
}) {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()
  const { toast } = useToast()
  const removeEntry = useRemoveQueueEntryAsPlatform()
  const [target, setTarget] = useState<string | null>(null)
  const canRemove = can(SUPPORT_PERMISSION.queueRemove)

  if (entries.length === 0) return <DossierNothing />

  return (
    <>
      <Table label={t('platform:supportDesk.queueEntries')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('common:field.when')}</TableHead>
            {showOrganization ? <TableHead>{t('platform:supportDesk.dossierOrganization')}</TableHead> : null}
            <TableHead>{t('common:field.customerName')}</TableHead>
            <TableHead>{t('common:field.status')}</TableHead>
            {canRemove ? (
              <TableHead>
                <span className="sr-only">{t('common:action.actions')}</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell className="whitespace-nowrap">{new Date(entry.created_at).toLocaleString()}</TableCell>
              {showOrganization ? (
                <TableCell className="text-ink-500">{entry.organization_name ?? '—'}</TableCell>
              ) : null}
              <TableCell className="text-ink-500">{entry.customer_name ?? '—'}</TableCell>
              <TableCell>{entry.status}</TableCell>
              {canRemove ? (
                <TableCell className="text-end">
                  {/*
                    Le serveur refuse de sortir une prestation commencée ou
                    terminée (`queue_entry_not_waiting`) : ne propose le geste
                    que là où il a un sens.
                  */}
                  {entry.status === 'waiting' || entry.status === 'called' ? (
                    <Button variant="secondary" size="sm" onClick={() => setTarget(entry.id)}>
                      {t('platform:supportDesk.removeQueueEntry')}
                    </Button>
                  ) : null}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ReasonDialog
        open={target !== null}
        onOpenChange={(open) => setTarget(open ? target : null)}
        title={t('platform:supportDesk.removeQueueEntry')}
        description={t('platform:supportDesk.removeQueueEntryDescription')}
        confirmLabel={t('platform:supportDesk.confirm')}
        required
        isPending={removeEntry.isPending}
        onConfirm={async (reason) => {
          if (!target) return
          try {
            await removeEntry.mutateAsync({ entryId: target, reason })
            toast({ title: t('platform:supportDesk.queueEntryRemoved'), variant: 'success' })
            setTarget(null)
          } catch (error) {
            toast({
              title: t('platform:supportDesk.removeFailed'),
              description: failureDescription(error),
              variant: 'error',
            })
          }
        }}
      />
    </>
  )
}

function InterestRequestsTable({ requests }: { requests: DossierInterestRequest[] }) {
  const { t } = useTranslation()
  if (requests.length === 0) return <DossierNothing />

  return (
    <Table label={t('platform:supportDesk.interestRequests')}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('platform:supportDesk.service')}</TableHead>
          <TableHead>{t('common:field.when')}</TableHead>
          <TableHead>{t('common:field.status')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requests.map((request) => (
          <TableRow key={request.id}>
            <TableCell>{request.service_label ?? '—'}</TableCell>
            <TableCell className="whitespace-nowrap text-ink-500">
              {request.preferred_starts_at ? new Date(request.preferred_starts_at).toLocaleString() : '—'}
            </TableCell>
            <TableCell>{request.status}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function EmailsTable({ emails }: { emails: DossierEmail[] }) {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()
  const { toast } = useToast()
  const resend = useResendPlatformEmail()
  const [target, setTarget] = useState<string | null>(null)
  const canResend = can(SUPPORT_PERMISSION.emailResend)

  if (emails.length === 0) return <DossierNothing />

  return (
    <>
      <Table label={t('platform:supportDesk.recentEmails')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('common:field.template')}</TableHead>
            <TableHead>{t('common:field.when')}</TableHead>
            <TableHead>{t('common:field.status')}</TableHead>
            {canResend ? (
              <TableHead>
                <span className="sr-only">{t('common:action.actions')}</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {emails.map((email) => (
            <TableRow key={email.id}>
              <TableCell className="font-mono text-xs">{email.template}</TableCell>
              <TableCell className="whitespace-nowrap text-ink-500">
                {new Date(email.created_at).toLocaleString()}
              </TableCell>
              <TableCell>
                {email.status}
                {email.bounced_at ? (
                  <Badge variant="danger" className="ms-2">
                    {t('platform:supportDesk.bounced')}
                  </Badge>
                ) : null}
              </TableCell>
              {canResend ? (
                <TableCell className="text-end">
                  {/*
                    Un e-mail qui a rebondi ne se renvoie pas (X2 a posé la
                    liste d'opposition pour ça) : le bouton est absent, pas
                    grisé.
                  */}
                  {email.bounced_at ? null : (
                    <Button variant="secondary" size="sm" onClick={() => setTarget(email.id)}>
                      {t('platform:supportDesk.resendEmail')}
                    </Button>
                  )}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ReasonDialog
        open={target !== null}
        onOpenChange={(open) => setTarget(open ? target : null)}
        title={t('platform:supportDesk.resendEmail')}
        description={t('platform:supportDesk.resendEmailDescription')}
        confirmLabel={t('platform:supportDesk.confirm')}
        required
        isPending={resend.isPending}
        onConfirm={async (reason) => {
          if (!target) return
          try {
            await resend.mutateAsync({ emailId: target, reason })
            toast({ title: t('platform:supportDesk.emailResent'), variant: 'success' })
            setTarget(null)
          } catch (error) {
            toast({
              title: t('platform:supportDesk.resendFailed'),
              description: failureDescription(error),
              variant: 'error',
            })
          }
        }}
      />
    </>
  )
}
