import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import {
  useApplicationQueue,
  useProspectOutreachState,
  useProspectStats,
  useProspects,
  usePublishExternalProfessional,
  useReviewApplication,
  useSalesPipeline,
  type ApplicationQueueRow,
  type PipelineRow,
  type ProspectListRow,
} from '@/lib/queries/platform-plat2'
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
import { TextField } from '@/components/ui/text-field'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'

/**
 * /platform/sales — L'ATELIER DU COMMERCIAL.
 *
 * Ce n'est pas un remplacement des écrans `/platform/acquisition/*`, qui
 * restent la fiche complète, la carte et la publication de masse. C'est ce
 * que le commercial regarde AVANT de décrocher son téléphone : le tunnel avec
 * ses deux origines, les chiffres réels du prospect, et l'état des relances
 * que B2 envoie tout seul. Le détail complet est atteint par un lien.
 *
 * TROIS RÈGLES QUI NE SE NÉGOCIENT PAS ICI.
 *
 * 1. Un zéro n'est pas une mesure. `is_published = false` veut dire « la
 *    fiche n'est pas en ligne » : l'écran le DIT et ne rend pas la grille de
 *    compteurs. Un tableau de zéros se lit comme un échec commercial alors
 *    qu'il ne s'est encore rien passé.
 * 2. Aucun bouton « relancer maintenant ». La cadence appartient à B2 (trois
 *    touches, heures calmes, désabonnement définitif) ; l'écran montre où elle
 *    en est, et surtout POURQUOI la prochaine ne part pas — sans quoi le
 *    commercial conclut que le système est cassé et double l'envoi.
 * 3. Aucune note client privée. Le modèle posé par OS-2 en parallèle — les
 *    notes internes sur un client, et le droit de lecture qui va avec — n'est
 *    jamais lu ici, et le commercial n'a pas ce droit : la base refuse déjà,
 *    l'écran ne demande même pas.
 *
 * Le conditionnement par rôle ci-dessous N'AUTORISE RIEN : chaque RPC repose
 * la question côté serveur (`private.platform_can`, `platform_prospect_visible`).
 */
export function PlatformSalesPage() {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()

  // Le support et le modérateur n'ont pas `crm.read` : ils reçoivent une
  // phrase honnête, pas un tableau vide qui laisserait croire à une panne.
  if (!can('crm.read')) {
    return (
      <Container size="lg" className="py-8">
        <PageHeader title={t('platform:salesDesk.title')} />
        <Card className="mt-6">
          <CardContent className="p-4 pt-4">
            <EmptyState
              className="border-none"
              title={t('platform:salesDesk.noAccess')}
              description={t('platform:salesDesk.noAccessBody')}
            />
          </CardContent>
        </Card>
      </Container>
    )
  }

  return <SalesDesk />
}

/** L'ordre du tunnel (MASTER_SPEC §5), jamais l'ordre alphabétique. */
const PIPELINE_STAGES = [
  'discovered',
  'enriched',
  'qualified',
  'selected',
  'contacted',
  'replied',
  'demo',
  'trial',
  'customer',
  'lost',
] as const

const STAGE_KEYS: Record<string, string> = {
  discovered: 'stageDiscovered',
  enriched: 'stageEnriched',
  qualified: 'stageQualified',
  selected: 'stageSelected',
  contacted: 'stageContacted',
  replied: 'stageReplied',
  demo: 'stageDemo',
  trial: 'stageTrial',
  customer: 'stageCustomer',
  lost: 'stageLost',
}

/** Un motif inconnu s'affiche tel quel : cacher ce qu'on ne sait pas nommer ne vaut rien. */
const BLOCK_REASON_KEYS: Record<string, string> = {
  prospect_not_found: 'blockProspectNotFound',
  do_not_contact: 'blockDoNotContact',
  suppressed_prospect: 'blockSuppressedProspect',
  suppressed_phone: 'blockSuppressedPhone',
  suppressed_email: 'blockSuppressedEmail',
  already_converted: 'blockAlreadyConverted',
  already_customer: 'blockAlreadyCustomer',
  no_eligibility_record: 'blockNoEligibility',
  channel_do_not_contact: 'blockChannelDoNotContact',
  opted_out: 'blockOptedOut',
  destination_invalid: 'blockDestinationInvalid',
  not_eligible: 'blockNotEligible',
  no_destination: 'blockNoDestination',
  opt_in_required: 'blockOptInRequired',
  locale_unresolved: 'blockLocaleUnresolved',
  locale_review_required: 'blockLocaleReviewRequired',
}

const REQUEST_STATUS_KEYS: Record<string, string> = {
  pending: 'requestPending',
  expired: 'requestExpired',
  withdrawn: 'requestWithdrawn',
}

const MAIL_STATUS_KEYS: Record<string, string> = {
  queued: 'mailQueued',
  sending: 'mailSending',
  sent: 'mailSent',
  failed: 'mailFailed',
}

const CHANNEL_KEYS: Record<string, string> = {
  email: 'channelEmail',
  phone: 'channelPhone',
  sms: 'channelSms',
  instagram_dm: 'channelInstagramDm',
  in_person: 'channelInPerson',
  other: 'channelOther',
}

function stageLabel(t: TFunction, stage: string): string {
  const key = STAGE_KEYS[stage]
  return key ? t(`platform:salesDesk.${key}`) : stage
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString()
}

function formatDateTime(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString()
}

function SalesDesk() {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()

  const [search, setSearch] = useState('')
  const [origin, setOrigin] = useState<'' | 'worker' | 'field'>('')
  const [status, setStatus] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const prospectsQuery = useProspects({
    search,
    origin: origin === '' ? undefined : origin,
    status: status === '' ? undefined : status,
  })

  const prospects = prospectsQuery.data ?? []
  const selected = prospects.find((prospect) => prospect.id === selectedId) ?? null
  const isFiltered = Boolean(search.trim() || origin || status)

  return (
    <Container size="lg" className="py-8">
      <PageHeader title={t('platform:salesDesk.title')} subtitle={t('platform:salesDesk.subtitle')} />

      <PipelineSection />

      <section className="mt-10">
        <SectionHeader title={t('platform:salesDesk.prospects')} />

        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <TextField
              label={t('platform:salesDesk.searchLabel')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="sm:w-48">
            <SelectField
              label={t('platform:salesDesk.originFilter')}
              value={origin}
              onChange={(event) => setOrigin(event.target.value as '' | 'worker' | 'field')}
              options={[
                { value: '', label: t('platform:salesDesk.allOrigins') },
                { value: 'field', label: t('platform:salesDesk.originField') },
                { value: 'worker', label: t('platform:salesDesk.originWorker') },
              ]}
            />
          </div>
          <div className="sm:w-48">
            <SelectField
              label={t('platform:salesDesk.stageFilter')}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              options={[
                { value: '', label: t('platform:salesDesk.allStages') },
                ...PIPELINE_STAGES.map((stage) => ({ value: stage, label: stageLabel(t, stage) })),
              ]}
            />
          </div>
        </div>

        <div className="mt-4">
          {prospectsQuery.isPending ? (
            <ListSkeleton />
          ) : prospectsQuery.isError ? (
            <ErrorState
              title={t('platform:salesDesk.listError')}
              description={getErrorMessage(prospectsQuery.error)}
            />
          ) : (
            <Table label={t('platform:salesDesk.prospects')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('platform:salesDesk.prospect')}</TableHead>
                  <TableHead>{t('platform:salesDesk.origin')}</TableHead>
                  <TableHead>{t('platform:salesDesk.stage')}</TableHead>
                  <TableHead>{t('platform:salesDesk.observation')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('common:action.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prospects.length === 0 ? (
                  <TableStateRow colSpan={5}>
                    <EmptyState
                      className="border-none"
                      title={
                        isFiltered
                          ? t('platform:salesDesk.listEmptyFiltered')
                          : t('platform:salesDesk.listEmpty')
                      }
                    />
                  </TableStateRow>
                ) : (
                  prospects.map((prospect) => (
                    <ProspectRow
                      key={prospect.id}
                      prospect={prospect}
                      isSelected={prospect.id === selectedId}
                      onSelect={() => setSelectedId(prospect.id)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      <section className="mt-10">
        {selected ? (
          <ProspectInsight key={selected.id} prospect={selected} />
        ) : (
          <EmptyState title={t('platform:salesDesk.selectProspect')} />
        )}
      </section>

      {/* Le commercial partage la file des onboardings avec le modérateur —
          décision du fondateur. Sans le droit, la section n'est pas montée du
          tout : la requête elle-même ne part pas. */}
      {can('onboarding.review') ? <OnboardingSection /> : null}
    </Container>
  )
}

/**
 * LE TUNNEL, AVEC SES DEUX ORIGINES CÔTE À CÔTE.
 *
 * Un salon vu de ses yeux par un stagiaire ne vaut pas une fiche agrégée
 * depuis des sources publiques, et cette différence doit se lire sans un
 * clic : deux colonnes, jamais un total qui les confond.
 */
function PipelineSection() {
  const { t } = useTranslation()
  const pipelineQuery = useSalesPipeline()

  if (pipelineQuery.isPending) {
    return (
      <section className="mt-8">
        <SectionHeader title={t('platform:salesDesk.pipeline')} />
        <div className="mt-3">
          <ListSkeleton />
        </div>
      </section>
    )
  }

  if (pipelineQuery.isError) {
    return (
      <section className="mt-8">
        <SectionHeader title={t('platform:salesDesk.pipeline')} />
        <ErrorState
          className="mt-3"
          title={t('platform:salesDesk.pipelineError')}
          description={getErrorMessage(pipelineQuery.error)}
        />
      </section>
    )
  }

  const rows = pipelineQuery.data ?? []
  const cell = (stage: string, wanted: 'worker' | 'field'): PipelineRow | undefined =>
    rows.find((row) => row.status === stage && row.origin === wanted)

  const sum = (pick: (row: PipelineRow) => number, wanted?: 'worker' | 'field') =>
    rows.filter((row) => (wanted ? row.origin === wanted : true)).reduce((total, row) => total + pick(row), 0)

  const totalProspects = sum((row) => row.prospect_count)

  return (
    <section className="mt-8">
      <SectionHeader title={t('platform:salesDesk.pipeline')} />
      <p className="mt-1 text-sm text-ink-500">{t('platform:salesDesk.pipelineHint')}</p>

      {rows.length === 0 ? (
        <EmptyState className="mt-3" title={t('platform:salesDesk.pipelineEmpty')} />
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricTile value={totalProspects.toLocaleString()} label={t('platform:salesDesk.prospectsTotal')} />
            <MetricTile
              value={sum((row) => row.prospect_count, 'field').toLocaleString()}
              label={t('platform:salesDesk.originField')}
              context={t('platform:salesDesk.originFieldHint')}
              tone="accent"
            />
            <MetricTile
              value={sum((row) => row.prospect_count, 'worker').toLocaleString()}
              label={t('platform:salesDesk.originWorker')}
              context={t('platform:salesDesk.originWorkerHint')}
            />
            <MetricTile
              value={sum((row) => row.published_count).toLocaleString()}
              label={t('platform:salesDesk.publishedTotal')}
            />
          </div>

          <div className="mt-4">
            <Table label={t('platform:salesDesk.pipeline')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('platform:salesDesk.stage')}</TableHead>
                  <TableHead>{t('platform:salesDesk.originField')}</TableHead>
                  <TableHead>{t('platform:salesDesk.originWorker')}</TableHead>
                  <TableHead>{t('platform:salesDesk.prospectsTotal')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PIPELINE_STAGES.map((stage) => {
                  const field = cell(stage, 'field')
                  const worker = cell(stage, 'worker')
                  const total = (field?.prospect_count ?? 0) + (worker?.prospect_count ?? 0)
                  return (
                    <TableRow key={stage}>
                      <TableCell className="whitespace-nowrap font-medium text-ink-950">
                        {stageLabel(t, stage)}
                      </TableCell>
                      <TableCell>
                        <OriginCell row={field} tone="accent" />
                      </TableCell>
                      <TableCell>
                        <OriginCell row={worker} tone="neutral" />
                      </TableCell>
                      <TableCell className="tabular-nums text-ink-500">{total.toLocaleString()}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  )
}

function OriginCell({ row, tone }: { row: PipelineRow | undefined; tone: 'accent' | 'neutral' }) {
  const { t } = useTranslation()
  if (!row || row.prospect_count === 0) {
    return <span className="text-ink-300">—</span>
  }
  return (
    <div className="min-w-0">
      <span
        className={
          tone === 'accent'
            ? 'block text-base font-semibold tabular-nums text-accent-600'
            : 'block text-base font-semibold tabular-nums text-ink-950'
        }
      >
        {row.prospect_count.toLocaleString()}
      </span>
      <span className="block whitespace-nowrap text-xs text-ink-500">
        {t('platform:salesDesk.perOrigin', { published: row.published_count, contacted: row.contacted_count })}
      </span>
    </div>
  )
}

function OriginBadge({ origin }: { origin: 'worker' | 'field' }) {
  const { t } = useTranslation()
  return (
    <Badge variant={origin === 'field' ? 'accent' : 'neutral'}>
      {origin === 'field' ? t('platform:salesDesk.originField') : t('platform:salesDesk.originWorker')}
    </Badge>
  )
}

function ProspectRow({
  prospect,
  isSelected,
  onSelect,
}: {
  prospect: ProspectListRow
  isSelected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const observedOn = formatDate(prospect.field_captured_at)

  return (
    <TableRow className={isSelected ? 'bg-paper-50' : undefined}>
      <TableCell>
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={isSelected}
          className="block max-w-[16rem] truncate text-start font-medium text-ink-950 hover:text-accent-600"
        >
          {prospect.canonical_name}
        </button>
        <span className="block truncate text-xs text-ink-500">
          {[prospect.city, prospect.country].filter(Boolean).join(' · ')}
        </span>
        {/* Appeler quelqu'un qui a dit non est une faute : le drapeau est sur
            la ligne, pas caché dans la fiche. */}
        {prospect.do_not_contact ? (
          <Badge variant="danger" className="mt-1">
            {t('platform:salesDesk.doNotContact')}
          </Badge>
        ) : null}
      </TableCell>
      <TableCell>
        <OriginBadge origin={prospect.origin} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-ink-500">{stageLabel(t, prospect.status)}</TableCell>
      <TableCell className="max-w-[20rem]">
        {prospect.field_observation ? (
          <>
            <span className="block truncate text-ink-800">{prospect.field_observation}</span>
            {observedOn ? (
              <span className="block text-xs text-ink-500">
                {t('platform:salesDesk.observedOn', { date: observedOn })}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-ink-300">—</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-end">
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onSelect}>
            {t('platform:salesDesk.showInsight')}
          </Button>
          <Link
            to={`/platform/acquisition/prospects/${prospect.id}`}
            className="text-sm font-medium text-accent-600 underline underline-offset-2"
          >
            {t('platform:salesDesk.openRecord')}
          </Link>
        </div>
      </TableCell>
    </TableRow>
  )
}

/** Les chiffres réels, puis l'état des relances. C'est l'ordre de l'appel. */
function ProspectInsight({ prospect }: { prospect: ProspectListRow }) {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()
  const statsQuery = useProspectStats(prospect.id)
  const stats = statsQuery.data
  const observedOn = formatDate(prospect.field_captured_at)

  return (
    <Card>
      <CardContent className="p-4 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-ink-950">{prospect.canonical_name}</h2>
            <p className="mt-1 text-sm text-ink-500">
              {[prospect.address_line, prospect.postal_code, prospect.city, prospect.country]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <OriginBadge origin={prospect.origin} />
              <Badge variant="neutral">{stageLabel(t, prospect.status)}</Badge>
              {prospect.do_not_contact ? (
                <Badge variant="danger">{t('platform:salesDesk.doNotContact')}</Badge>
              ) : null}
              {stats?.claim_state ? (
                <Badge variant={stats.claim_state === 'claimed' ? 'success' : 'neutral'}>
                  {stats.claim_state === 'claimed'
                    ? t('platform:salesDesk.claimed')
                    : t('platform:salesDesk.unclaimed')}
                </Badge>
              ) : null}
              {stats?.is_published ? (
                <Badge variant="info">{t('platform:salesDesk.alreadyPublished')}</Badge>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Publier est une action de commercial ou d'admin, jamais de
                stagiaire — et seulement tant que la fiche n'est pas en ligne. */}
            {can('marketplace.publish') && stats && !stats.is_published ? (
              <PublishAction prospect={prospect} />
            ) : null}
            <Link
              to={`/platform/acquisition/prospects/${prospect.id}`}
              className="text-sm font-medium text-accent-600 underline underline-offset-2"
            >
              {t('platform:salesDesk.openRecord')}
            </Link>
          </div>
        </div>

        {/* L'observation du stagiaire est l'argument d'ouverture de l'appel :
            en entier ici, pas tronquée. */}
        {prospect.field_observation ? (
          <div className="mt-4 rounded-md border border-border bg-paper-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              {t('platform:salesDesk.observation')}
            </p>
            <p className="mt-1 text-sm text-ink-800">{prospect.field_observation}</p>
            {observedOn ? (
              <p className="mt-1 text-xs text-ink-500">
                {t('platform:salesDesk.observedOn', { date: observedOn })}
              </p>
            ) : null}
          </div>
        ) : null}

        {(prospect.phone_e164 || prospect.email) && !prospect.do_not_contact ? (
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            {prospect.phone_e164 ? (
              <a
                href={`tel:${prospect.phone_e164}`}
                className="font-medium text-accent-600 underline underline-offset-2"
              >
                {prospect.phone_e164}
              </a>
            ) : null}
            {prospect.email ? (
              <a
                href={`mailto:${prospect.email}`}
                className="break-all font-medium text-accent-600 underline underline-offset-2"
              >
                {prospect.email}
              </a>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6">
          <SectionHeader title={t('platform:salesDesk.stats')} />
          <div className="mt-3">
            {statsQuery.isPending ? (
              <ListSkeleton />
            ) : statsQuery.isError ? (
              <ErrorState
                title={t('platform:salesDesk.statsError')}
                description={getErrorMessage(statsQuery.error)}
              />
            ) : !stats ? null : !stats.is_published ? (
              /* LA RÈGLE : un zéro n'est pas une mesure. Aucune grille de
                 compteurs ici — elle se lirait comme un échec commercial. */
              <EmptyState
                title={t('platform:salesDesk.notPublished')}
                description={t('platform:salesDesk.notPublishedBody')}
              />
            ) : (
              <>
                {stats.interest_requests_pending > 0 ? (
                  <Alert variant="warning" className="mb-3">
                    {t('platform:salesDesk.pendingCallout', { count: stats.interest_requests_pending })}
                  </Alert>
                ) : null}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MetricTile
                    value={stats.interest_requests_pending.toLocaleString()}
                    label={t('platform:salesDesk.pendingRequests')}
                    tone={stats.interest_requests_pending > 0 ? 'warning' : 'quiet'}
                  />
                  <MetricTile
                    value={stats.interest_requests.toLocaleString()}
                    label={t('platform:salesDesk.interestRequests')}
                  />
                  <MetricTile
                    value={stats.booking_started.toLocaleString()}
                    label={t('platform:salesDesk.bookingStarted')}
                  />
                  <MetricTile
                    value={stats.profile_views_all_time.toLocaleString()}
                    label={t('platform:salesDesk.viewsAllTime')}
                    context={
                      stats.last_profile_view_at
                        ? t('platform:salesDesk.lastView', {
                            date: formatDate(stats.last_profile_view_at) ?? '',
                          })
                        : t('platform:salesDesk.neverViewed')
                    }
                  />
                  <MetricTile
                    value={stats.profile_views.toLocaleString()}
                    label={t('platform:salesDesk.views90')}
                  />
                  <MetricTile
                    value={stats.search_result_views.toLocaleString()}
                    label={t('platform:salesDesk.searchViews')}
                  />
                  <MetricTile value={stats.followers.toLocaleString()} label={t('platform:salesDesk.followers')} />
                </div>
              </>
            )}
          </div>
        </div>

        <OutreachSection prospectId={prospect.id} />
      </CardContent>
    </Card>
  )
}

/**
 * OÙ EN SONT LES RELANCES — ET POURQUOI LA PROCHAINE NE PART PAS.
 *
 * Aucun bouton d'envoi : la cadence est celle de B2. Le `block_reason` rendu
 * ici est celui que B2 calcule lui-même (`outreach_block_reason`), pas une
 * seconde implémentation qui finirait par diverger de celle qui décide.
 */
function OutreachSection({ prospectId }: { prospectId: string }) {
  const { t } = useTranslation()
  const outreachQuery = useProspectOutreachState(prospectId)
  const state = outreachQuery.data

  const blockReasonLabel = (code: string): string => {
    const key = BLOCK_REASON_KEYS[code]
    return key ? t(`platform:salesDesk.${key}`) : t('platform:salesDesk.blockUnknown', { code })
  }

  return (
    <div className="mt-6">
      <SectionHeader title={t('platform:salesDesk.outreach')} />
      <p className="mt-1 text-sm text-ink-500">{t('platform:salesDesk.outreachHint')}</p>

      <div className="mt-3">
        {outreachQuery.isPending ? (
          <ListSkeleton />
        ) : outreachQuery.isError ? (
          <ErrorState
            title={t('platform:salesDesk.outreachError')}
            description={getErrorMessage(outreachQuery.error)}
          />
        ) : !state ? null : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {state.do_not_contact ? (
                <Badge variant="danger">{t('platform:salesDesk.doNotContact')}</Badge>
              ) : null}
              {state.suppressed ? <Badge variant="danger">{t('platform:salesDesk.suppressed')}</Badge> : null}
              {!state.has_email ? <Badge variant="warning">{t('platform:salesDesk.noEmail')}</Badge> : null}
            </div>

            {state.block_reason ? (
              <Alert variant="warning" className="mt-3">
                {t('platform:salesDesk.blocked', { reason: blockReasonLabel(state.block_reason) })}
              </Alert>
            ) : (
              <p className="mt-3 text-sm text-ink-500">{t('platform:salesDesk.notBlocked')}</p>
            )}

            <div className="mt-4 flex flex-col gap-3">
              {state.requests.length === 0 ? (
                <EmptyState title={t('platform:salesDesk.noRequests')} />
              ) : (
                state.requests.map((request) => (
                  <div key={request.request_id} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="block truncate font-medium text-ink-950">{request.service_label}</span>
                        <span className="block text-xs text-ink-500">
                          {t('platform:salesDesk.requestedFor', {
                            date: formatDateTime(request.preferred_starts_at) ?? '',
                          })}
                          {' · '}
                          {t('platform:salesDesk.expiresOn', {
                            date: formatDateTime(request.expires_at) ?? '',
                          })}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={requestBadgeVariant(request.status)}>
                          {REQUEST_STATUS_KEYS[request.status]
                            ? t(`platform:salesDesk.${REQUEST_STATUS_KEYS[request.status]}`)
                            : request.status}
                        </Badge>
                        <span className="whitespace-nowrap text-xs text-ink-500">
                          {t('platform:salesDesk.touchesSent', { sent: request.touches_sent })}
                        </span>
                      </div>
                    </div>

                    {request.touches.length === 0 ? (
                      <p className="mt-2 text-xs text-ink-500">{t('platform:salesDesk.noTouches')}</p>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-1">
                        {request.touches.map((touch, index) => (
                          <li
                            key={`${request.request_id}-${touch.touch}-${touch.created_at}`}
                            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500"
                          >
                            <span className="font-medium text-ink-800">
                              {t('platform:salesDesk.touch', { n: touch.touch || String(index + 1) })}
                            </span>
                            <span className="font-mono">{touch.template}</span>
                            <Badge variant={mailBadgeVariant(touch)}>
                              {MAIL_STATUS_KEYS[touch.status]
                                ? t(`platform:salesDesk.${MAIL_STATUS_KEYS[touch.status]}`)
                                : touch.status}
                            </Badge>
                            {touch.sent_at ? (
                              <span>
                                {t('platform:salesDesk.sentOn', { date: formatDateTime(touch.sent_at) ?? '' })}
                              </span>
                            ) : null}
                            {touch.delivered_at ? (
                              <span>
                                {t('platform:salesDesk.deliveredOn', {
                                  date: formatDateTime(touch.delivered_at) ?? '',
                                })}
                              </span>
                            ) : null}
                            {touch.opened_at ? (
                              <span>
                                {t('platform:salesDesk.openedOn', {
                                  date: formatDateTime(touch.opened_at) ?? '',
                                })}
                              </span>
                            ) : null}
                            {touch.bounced_at ? (
                              <span className="text-danger-600">
                                {t('platform:salesDesk.bouncedOn', {
                                  date: formatDateTime(touch.bounced_at) ?? '',
                                })}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Les échanges saisis à la main ne sont pas des relances
                automatiques : surface distincte, jamais mélangée. */}
            <div className="mt-6 rounded-md border border-dashed border-border-strong p-3">
              <SectionHeader title={t('platform:salesDesk.loggedContacts')} />
              <p className="mt-1 text-xs text-ink-500">{t('platform:salesDesk.loggedContactsHint')}</p>
              {state.logged_contacts.length === 0 ? (
                <p className="mt-2 text-sm text-ink-500">{t('platform:salesDesk.noLoggedContacts')}</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {state.logged_contacts.map((contact) => (
                    <li key={contact.id} className="text-sm">
                      <span className="text-ink-800">
                        {CHANNEL_KEYS[contact.channel]
                          ? t(`platform:salesDesk.${CHANNEL_KEYS[contact.channel]}`)
                          : contact.channel}
                        {' · '}
                        {contact.direction === 'inbound'
                          ? t('platform:salesDesk.directionInbound')
                          : t('platform:salesDesk.directionOutbound')}
                      </span>
                      <span className="ms-2 text-xs text-ink-500">{formatDateTime(contact.occurred_at)}</span>
                      {contact.summary ? (
                        <span className="block text-ink-500">{contact.summary}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function requestBadgeVariant(status: string): BadgeVariant {
  if (status === 'pending') return 'warning'
  if (status === 'withdrawn') return 'danger'
  return 'neutral'
}

function mailBadgeVariant(touch: { status: string; bounced_at: string | null }): BadgeVariant {
  if (touch.bounced_at || touch.status === 'failed') return 'danger'
  if (touch.status === 'sent') return 'success'
  return 'neutral'
}

/**
 * PUBLIER — jamais un clic nu.
 *
 * La publication déclenche l'information de l'article 14 du RGPD vers le
 * professionnel (X2) et engage la responsabilité légale de FadeUp. Elle se
 * confirme, et la confirmation dit ce qu'elle déclenche.
 */
function PublishAction({ prospect }: { prospect: ProspectListRow }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const publish = usePublishExternalProfessional()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t('platform:salesDesk.publish')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('platform:salesDesk.publishTitle')}</DialogTitle>
            <DialogDescription>{prospect.canonical_name}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Alert variant="warning">{t('platform:salesDesk.publishBody')}</Alert>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common:action.cancel')}
            </Button>
            <Button
              isLoading={publish.isPending}
              onClick={() =>
                publish.mutate(prospect.id, {
                  onSuccess: () => {
                    toast({ title: t('platform:salesDesk.publishDone'), variant: 'success' })
                    setOpen(false)
                  },
                  onError: (error) =>
                    toast({
                      title: t('platform:salesDesk.publishFailed'),
                      description: getErrorMessage(error),
                      variant: 'error',
                    }),
                })
              }
            >
              {t('platform:salesDesk.publishConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * LA FILE DES ONBOARDINGS — un compteur et une file courte.
 *
 * Le traitement détaillé vit sur l'écran des candidatures, qui existe : ici,
 * le commercial voit combien attendent et tranche les cas évidents. Le refus
 * exige un motif, toujours.
 */
function OnboardingSection() {
  const { t } = useTranslation()
  const queueQuery = useApplicationQueue('pending_review')
  const pending = queueQuery.data ?? []
  const shown = pending.slice(0, 5)

  return (
    <section className="mt-10">
      <SectionHeader
        title={t('platform:salesDesk.onboarding')}
        meta={
          queueQuery.isSuccess
            ? t('platform:salesDesk.onboardingWaiting') + ' · ' + pending.length.toLocaleString()
            : undefined
        }
      />
      <p className="mt-1 text-sm text-ink-500">{t('platform:salesDesk.onboardingHint')}</p>

      <div className="mt-3">
        {queueQuery.isPending ? (
          <ListSkeleton />
        ) : queueQuery.isError ? (
          <ErrorState
            title={t('platform:salesDesk.onboardingError')}
            description={getErrorMessage(queueQuery.error)}
          />
        ) : shown.length === 0 ? (
          <EmptyState title={t('platform:salesDesk.onboardingEmpty')} />
        ) : (
          <div className="flex flex-col gap-2">
            {shown.map((application) => (
              <ApplicationCard key={application.id} application={application} />
            ))}
            {pending.length > shown.length ? (
              <p className="text-xs text-ink-500">
                {t('platform:salesDesk.andMore', { count: pending.length - shown.length })}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  )
}

function ApplicationCard({ application }: { application: ApplicationQueueRow }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const review = useReviewApplication()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  function fail(error: unknown) {
    toast({ title: t('platform:salesDesk.reviewFailed'), description: getErrorMessage(error), variant: 'error' })
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 pt-4">
        <div className="min-w-0">
          <span className="block truncate font-medium text-ink-950">{application.business_name}</span>
          <span className="block truncate text-xs text-ink-500">
            {[`${application.first_name} ${application.last_name}`.trim(), application.city, application.email]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span className="block text-xs text-ink-500">
            {t('platform:salesDesk.submittedOn', { date: formatDate(application.submitted_at) ?? '' })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/platform/applications/${application.id}`}
            className="text-sm font-medium text-accent-600 underline underline-offset-2"
          >
            {t('platform:salesDesk.reviewInDetail')}
          </Link>
          <Button variant="secondary" size="sm" onClick={() => setRejecting(true)}>
            {t('platform:salesDesk.reject')}
          </Button>
          <Button
            size="sm"
            isLoading={review.isPending && !rejecting}
            onClick={() =>
              review.mutate(
                { applicationId: application.id, decision: 'approve' },
                {
                  onSuccess: () => toast({ title: t('platform:salesDesk.approved'), variant: 'success' }),
                  onError: fail,
                },
              )
            }
          >
            {t('platform:salesDesk.approve')}
          </Button>
        </div>
      </CardContent>

      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('platform:salesDesk.rejectTitle')}</DialogTitle>
            <DialogDescription>{application.business_name}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Textarea
              label={t('platform:salesDesk.rejectReason')}
              value={reason}
              error={reasonError ?? undefined}
              onChange={(event) => {
                setReason(event.target.value)
                setReasonError(null)
              }}
              rows={4}
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRejecting(false)}>
              {t('common:action.cancel')}
            </Button>
            <Button
              variant="danger"
              isLoading={review.isPending && rejecting}
              onClick={() => {
                // Un refus sans motif est un refus qu'on ne peut pas expliquer
                // au professionnel : la garde est ici et côté serveur.
                if (!reason.trim()) {
                  setReasonError(t('platform:salesDesk.rejectReasonRequired'))
                  return
                }
                review.mutate(
                  { applicationId: application.id, decision: 'reject', rejectionReason: reason.trim() },
                  {
                    onSuccess: () => {
                      toast({ title: t('platform:salesDesk.rejected') })
                      setRejecting(false)
                      setReason('')
                    },
                    onError: fail,
                  },
                )
              }}
            >
              {t('platform:salesDesk.rejectConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
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

// Ce que cet écran NE LIT JAMAIS : le dossier client d'OS-2 et ses notes
// internes privées, dont le droit de lecture n'appartient pas au commercial.
// Ni modération, ni support, ni facturation : aucun hook de ces familles n'est
// importé, et le test unitaire le verrouille sur la source elle-même.
