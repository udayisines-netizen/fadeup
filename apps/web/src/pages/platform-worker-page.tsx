import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { usePlatformIntl } from '@/lib/platform-intl'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import {
  refusalToken,
  useCreateProspectDiscoveryJob,
  useProspectWorkerPasses,
  useProspectWorkerState,
  useSetProspectWorkerPaused,
  type ProspectJobType,
  type ProspectWorkerPassRow,
  type ProspectWorkerState,
} from '@/lib/queries/platform-plat3'
import { Alert } from '@/components/ui/alert'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { MetricTile } from '@/components/ui/metric'
import { PageHeader, SectionHeader } from '@/components/ui/page-header'
import { SelectField } from '@/components/ui/select-field'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'

/**
 * /platform/worker — LE PILOTAGE DU WORKER D'ACQUISITION.
 *
 * TROIS ÉTATS, ET ILS NE SE CONFONDENT JAMAIS.
 *
 *   EN MARCHE  `is_live` et pas en pause : le worker sonde la base et travaille.
 *   EN PAUSE   `is_paused` : il sonde toujours, on refuse de le servir. Qui,
 *              quand et pourquoi sont affichés — une pause sans motif est une
 *              panne qu'on découvrira dans six jours.
 *   À L'ARRÊT  `is_live` faux : PLUS AUCUN SONDAGE. Ce n'est pas une pause,
 *              c'est un processus qui n'est pas là, et l'écran le dit avec ces
 *              mots. Le conteneur est resté `Exited` six jours sans que
 *              personne le voie : c'est précisément ce que cet écran corrige.
 *
 * Les deux peuvent être vrais en même temps (mis en pause, PUIS arrêté), et
 * alors les DEUX sont écrits. Choisir un seul des deux messages laisserait
 * croire qu'il suffit de reprendre pour que ça reparte.
 *
 * `is_live` est MESURÉ côté serveur sur le battement (un sondage dans les
 * 60 s), jamais déclaré ici. L'écran ne fait que le relire toutes les dix
 * secondes, et seulement quand l'onglet est visible.
 */
export function PlatformWorkerPage() {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()

  if (!can('worker.operate')) {
    return (
      <Container size="lg" className="py-8">
        <PageHeader title={t('platform:worker.title')} />
        <Card className="mt-6">
          <CardContent className="p-4 pt-4">
            <EmptyState
              className="border-none"
              title={t('platform:worker.noAccess')}
              description={t('platform:worker.noAccessBody')}
            />
          </CardContent>
        </Card>
      </Container>
    )
  }

  return <WorkerDesk />
}

/** Les six types acceptés par `create_prospect_discovery_job`, dans son ordre. */
const JOB_TYPES: ProspectJobType[] = [
  'discovery',
  'enrichment',
  'dedup_scan',
  'scoring',
  'website_crawl',
  'instagram_enrich',
]

const JOB_TYPE_KEYS: Record<string, string> = {
  discovery: 'jobDiscovery',
  enrichment: 'jobEnrichment',
  dedup_scan: 'jobDedupScan',
  scoring: 'jobScoring',
  website_crawl: 'jobWebsiteCrawl',
  instagram_enrich: 'jobInstagramEnrich',
}

const PASS_STATUS_KEYS: Record<string, string> = {
  queued: 'passQueued',
  retry: 'passRetry',
  running: 'passRunning',
  completed: 'passCompleted',
  failed: 'passFailed',
  cancelled: 'passCancelled',
}

const REFUSAL_KEYS: Record<string, string> = {
  not_authorized: 'refusalNotAuthorized',
  reason_required: 'refusalReasonRequired',
  missing_argument: 'refusalMissingArgument',
}

function jobTypeLabel(t: TFunction, jobType: string): string {
  const key = JOB_TYPE_KEYS[jobType]
  return key ? t(`platform:worker.${key}`) : jobType
}

function passStatusLabel(t: TFunction, status: string): string {
  const key = PASS_STATUS_KEYS[status]
  return key ? t(`platform:worker.${key}`) : status
}

function passStatusVariant(status: string): BadgeVariant {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'running') return 'accent'
  if (status === 'retry') return 'warning'
  return 'neutral'
}

function useRefusalToast() {
  const { t } = useTranslation()
  const { toast } = useToast()
  return (title: string, error: unknown) => {
    const token = refusalToken(error)
    const known = token ? REFUSAL_KEYS[token] : undefined
    toast({
      title,
      description: known ? t(`platform:worker.${known}`) : getErrorMessage(error),
      variant: 'error',
    })
  }
}

function WorkerDesk() {
  const { t } = useTranslation()
  const stateQuery = useProspectWorkerState()

  return (
    <Container size="lg" className="py-8">
      <PageHeader title={t('platform:worker.title')} subtitle={t('platform:worker.subtitle')} />

      <section className="mt-10">
        <SectionHeader title={t('platform:worker.state')} />

        <div className="mt-3">
          {stateQuery.isPending ? (
            <ListSkeleton />
          ) : stateQuery.isError ? (
            <ErrorState
              title={t('platform:worker.stateError')}
              description={getErrorMessage(stateQuery.error)}
            />
          ) : !stateQuery.data ? (
            <EmptyState title={t('platform:worker.stateMissing')} description={t('platform:worker.stateMissingBody')} />
          ) : (
            <WorkerState state={stateQuery.data} />
          )}
        </div>
      </section>

      <PassLogSection />
    </Container>
  )
}

function WorkerState({ state }: { state: ProspectWorkerState }) {
  const { t } = useTranslation()
  const intl = usePlatformIntl()

  const isDown = !state.is_live
  const isPaused = state.is_paused
  const isRunning = state.is_live && !state.is_paused

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="p-4 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* L'état DOMINANT en premier, et l'arrêt domine toujours : un
                  worker arrêté ne repartira pas parce qu'on le dépause. */}
              {isDown ? (
                <Badge variant="danger">{t('platform:worker.badgeDown')}</Badge>
              ) : isPaused ? (
                <Badge variant="warning">{t('platform:worker.badgePaused')}</Badge>
              ) : (
                <Badge variant="success">{t('platform:worker.badgeRunning')}</Badge>
              )}
              {/* Les deux à la fois se DISENT tous les deux. */}
              {isDown && isPaused ? (
                <Badge variant="warning">{t('platform:worker.badgeAlsoPaused')}</Badge>
              ) : null}
            </div>
            <PauseControl state={state} />
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {isRunning ? <Alert variant="success">{t('platform:worker.runningBody')}</Alert> : null}
            {isPaused ? (
              <Alert variant="warning">
                {t('platform:worker.pausedBody', {
                  who: state.paused_by_email ?? '—',
                  date: intl.dateTime(state.paused_at),
                })}
                {state.pause_reason ? ` — ${state.pause_reason}` : null}
              </Alert>
            ) : null}
            {isDown ? <Alert variant="error">{t('platform:worker.downBody')}</Alert> : null}
          </div>

          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <HeartbeatLine label={t('platform:worker.lastPoll')} value={intl.dateTime(state.last_poll_at)} />
            <HeartbeatLine
              label={t('platform:worker.secondsSincePoll')}
              value={
                state.seconds_since_last_poll === null ? '—' : intl.number(state.seconds_since_last_poll)
              }
            />
            <HeartbeatLine label={t('platform:worker.lastClaim')} value={intl.dateTime(state.last_claim_at)} />
            <HeartbeatLine
              label={t('platform:worker.lastSuccessfulPass')}
              value={intl.dateTime(state.last_successful_pass_at)}
            />
            <HeartbeatLine label={t('platform:worker.workerId')} value={state.last_poll_worker_id ?? '—'} />
          </dl>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MetricTile value={intl.number(state.jobs_queued)} label={t('platform:worker.jobsQueued')} />
        <MetricTile
          value={intl.number(state.jobs_running)}
          label={t('platform:worker.jobsRunning')}
          tone="accent"
        />
        <MetricTile
          value={intl.number(state.jobs_failed)}
          label={t('platform:worker.jobsFailed')}
          tone={state.jobs_failed > 0 ? 'danger' : 'quiet'}
        />
        <MetricTile value={intl.number(state.prospects_total)} label={t('platform:worker.prospectsTotal')} />
        <MetricTile
          value={intl.number(state.prospects_last_7_days)}
          label={t('platform:worker.prospectsLast7Days')}
        />
      </div>

      <LaunchControl />
    </div>
  )
}

function HeartbeatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-1 last:border-none">
      <dt className="text-ink-500">{label}</dt>
      <dd className="min-w-0 truncate font-medium tabular-nums text-ink-950">{value}</dd>
    </div>
  )
}

/** Mettre en pause EXIGE un motif — côté serveur comme ici. Reprendre, non. */
function PauseControl({ state }: { state: ProspectWorkerState }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const fail = useRefusalToast()
  const setPaused = useSetProspectWorkerPaused()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  if (state.is_paused) {
    return (
      <Button
        variant="secondary"
        size="sm"
        isLoading={setPaused.isPending}
        onClick={() =>
          setPaused.mutate(
            { paused: false },
            {
              onSuccess: () => toast({ title: t('platform:worker.resumed'), variant: 'success' }),
              onError: (error) => fail(t('platform:worker.resumeFailed'), error),
            },
          )
        }
      >
        {t('platform:worker.resume')}
      </Button>
    )
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t('platform:worker.pause')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('platform:worker.pauseTitle')}</DialogTitle>
            <DialogDescription>{t('platform:worker.pauseDescription')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Alert variant="warning">{t('platform:worker.pauseWarning')}</Alert>
            <div className="mt-3">
              <Textarea
                label={t('platform:worker.pauseReason')}
                value={reason}
                rows={3}
                error={reasonError ?? undefined}
                onChange={(event) => {
                  setReason(event.target.value)
                  setReasonError(null)
                }}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common:action.cancel')}
            </Button>
            <Button
              isLoading={setPaused.isPending}
              onClick={() => {
                if (!reason.trim()) {
                  setReasonError(t('platform:worker.refusalReasonRequired'))
                  return
                }
                setPaused.mutate(
                  { paused: true, reason: reason.trim() },
                  {
                    onSuccess: () => {
                      toast({ title: t('platform:worker.paused'), variant: 'success' })
                      setOpen(false)
                      setReason('')
                    },
                    onError: (error) => fail(t('platform:worker.pauseFailed'), error),
                  },
                )
              }}
            >
              {t('platform:worker.pauseConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * LANCER UNE PASSE — jamais un clic nu.
 *
 * Une passe ÉCRIT en base et peut créer des centaines de prospects, chacun
 * une personne réelle à qui X2 devra une information. Le bouton qui lance est
 * DANS la boîte de dialogue, derrière la phrase qui dit ce qui va se passer :
 * le bouton de la page ne fait qu'ouvrir la question.
 */
function LaunchControl() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const fail = useRefusalToast()
  const launch = useCreateProspectDiscoveryJob()
  const [open, setOpen] = useState(false)
  const [jobType, setJobType] = useState<ProspectJobType>('discovery')

  return (
    <>
      <div>
        <Button onClick={() => setOpen(true)}>{t('platform:worker.launch')}</Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('platform:worker.launchTitle')}</DialogTitle>
            <DialogDescription>{t('platform:worker.launchDescription')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Alert variant="warning">{t('platform:worker.launchWarning')}</Alert>
            <div className="mt-3">
              <SelectField
                label={t('platform:worker.jobType')}
                value={jobType}
                onChange={(event) => setJobType(event.target.value as ProspectJobType)}
                options={JOB_TYPES.map((type) => ({ value: type, label: jobTypeLabel(t, type) }))}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common:action.cancel')}
            </Button>
            <Button
              isLoading={launch.isPending}
              onClick={() =>
                launch.mutate(
                  { jobType },
                  {
                    onSuccess: () => {
                      toast({ title: t('platform:worker.launched'), variant: 'success' })
                      setOpen(false)
                    },
                    onError: (error) => fail(t('platform:worker.launchFailed'), error),
                  },
                )
              }
            >
              {t('platform:worker.launchConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function PassLogSection() {
  const { t } = useTranslation()
  const passesQuery = useProspectWorkerPasses(50)
  const passes = passesQuery.data ?? []

  return (
    <section className="mt-10">
      <SectionHeader title={t('platform:worker.passLog')} />
      <p className="mt-1 text-sm text-ink-500">{t('platform:worker.passLogHint')}</p>

      <div className="mt-3">
        {passesQuery.isPending ? (
          <ListSkeleton />
        ) : passesQuery.isError ? (
          <ErrorState
            title={t('platform:worker.passLogError')}
            description={getErrorMessage(passesQuery.error)}
          />
        ) : (
          <Table label={t('platform:worker.passLog')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('platform:worker.passWhen')}</TableHead>
                <TableHead>{t('platform:worker.jobType')}</TableHead>
                <TableHead>{t('platform:worker.passStatus')}</TableHead>
                <TableHead>{t('platform:worker.passCandidates')}</TableHead>
                <TableHead>{t('platform:worker.passCreated')}</TableHead>
                <TableHead>{t('platform:worker.passSources')}</TableHead>
                <TableHead>{t('platform:worker.passLaunchedBy')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {passes.length === 0 ? (
                <TableStateRow colSpan={7}>
                  <EmptyState
                    className="border-none"
                    title={t('platform:worker.passLogEmpty')}
                    description={t('platform:worker.passLogEmptyBody')}
                  />
                </TableStateRow>
              ) : (
                passes.map((pass) => <PassRow key={pass.id} pass={pass} />)
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  )
}

function PassRow({ pass }: { pass: ProspectWorkerPassRow }) {
  const { t } = useTranslation()
  const intl = usePlatformIntl()

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-ink-500">{intl.dateTime(pass.created_at)}</TableCell>
      <TableCell className="whitespace-nowrap font-medium text-ink-950">
        {jobTypeLabel(t, pass.job_type)}
      </TableCell>
      <TableCell>
        <Badge variant={passStatusVariant(pass.status)}>{passStatusLabel(t, pass.status)}</Badge>
        {pass.last_error ? (
          <span className="mt-1 block max-w-[18rem] truncate text-xs text-danger-600">{pass.last_error}</span>
        ) : null}
      </TableCell>
      {/* NULL veut dire « le résultat ne portait pas ce compteur », pas zéro :
          un zéro inventé ferait conclure à une passe stérile. */}
      <TableCell className="tabular-nums">
        {pass.candidates_found === null ? (
          <span className="text-ink-300">—</span>
        ) : (
          intl.number(pass.candidates_found)
        )}
      </TableCell>
      <TableCell className="tabular-nums">
        {pass.prospects_created === null ? (
          <span className="text-ink-300">—</span>
        ) : (
          intl.number(pass.prospects_created)
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-ink-500">
        {t('platform:worker.passSourcesValue', {
          failed: pass.sources_failed,
          total: pass.sources_total,
        })}
      </TableCell>
      <TableCell className="max-w-[14rem] truncate text-ink-500">{pass.launched_by_email ?? '—'}</TableCell>
    </TableRow>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
