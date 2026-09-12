import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { usePlatformIntl } from '@/lib/platform-intl'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import {
  refusalToken,
  useAcquisitionFunnel,
  type AcquisitionFunnelRow,
  type FunnelGroupBy,
} from '@/lib/queries/platform-plat3'
import { Alert } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader, SectionHeader } from '@/components/ui/page-header'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { TextField } from '@/components/ui/text-field'
import { getErrorMessage } from '@/lib/get-error-message'

/**
 * /platform/funnel — LE TUNNEL D'ACQUISITION, ET CE QU'IL NE SAIT PAS.
 *
 * Tout l'intérêt de cet écran est l'honnêteté ; c'est même sa seule raison
 * d'exister à côté du tunnel commercial de PLAT-2. Trois refus, tenus ligne
 * par ligne :
 *
 * 1. `total = null` + `attributable = false` s'écrit « non attribuable », pas
 *    « 0 », et SANS barre. Rien ne relie une organisation à un prospect dans
 *    le schéma d'aujourd'hui : un zéro ferait lire « aucune conversion » là où
 *    la vérité est « la question n'est pas posable ».
 * 2. `conversion_rate = null` + `rate_suppressed = true` s'écrit « pas assez
 *    de données », avec le SEUIL RENDU PAR LE SERVEUR. Aucune constante n'est
 *    recopiée ici : si le serveur change son seuil, l'écran le suit.
 * 3. `conversion_rate = null` SANS suppression, au passage d'une étape
 *    attribuable à une étape qui ne l'est pas : la population change de nature
 *    et un pourcentage y serait un nombre juste répondant à une question
 *    fausse. L'écran le dit plutôt que de laisser une case vide.
 *
 * Et rien d'inventé : ni objectif, ni cible, ni projection, ni bibliothèque de
 * graphiques. Les barres sont des largeurs CSS calculées sur les nombres
 * réels, ce qui est la seule forme de graphique qui ne peut rien fabriquer.
 */
export function PlatformFunnelPage() {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()

  if (!can('crm.read')) {
    return (
      <Container size="lg" className="py-8">
        <PageHeader title={t('platform:funnel.title')} />
        <Card className="mt-6">
          <CardContent className="p-4 pt-4">
            <EmptyState
              className="border-none"
              title={t('platform:funnel.noAccess')}
              description={t('platform:funnel.noAccessBody')}
            />
          </CardContent>
        </Card>
      </Container>
    )
  }

  return <FunnelDesk />
}

const STAGE_KEYS: Record<string, string> = {
  published: 'stagePublished',
  requests: 'stageRequests',
  emails: 'stageEmails',
  claims: 'stageClaims',
  trials: 'stageTrials',
  subscriptions: 'stageSubscriptions',
}

const ORIGIN_KEYS: Record<string, string> = {
  worker: 'originWorker',
  field: 'originField',
}

const REFUSAL_KEYS: Record<string, string> = {
  not_authorized: 'refusalNotAuthorized',
  bad_window: 'refusalBadWindow',
  bad_group: 'refusalBadGroup',
}

type Preset = '7' | '30' | '90' | 'custom'

function stageLabel(t: TFunction, stage: string): string {
  const key = STAGE_KEYS[stage]
  return key ? t(`platform:funnel.${key}`) : stage
}

function stageHint(t: TFunction, stage: string): string | null {
  const key = STAGE_KEYS[stage]
  return key ? t(`platform:funnel.${key}Hint`) : null
}

/** Le début du jour local — un ancrage stable, pour que la clé de cache ne bouge pas à chaque rendu. */
function startOfToday(): Date {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return now
}

function shiftDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** `YYYY-MM-DD` — la valeur qu'un `<input type="date">` lit et rend. */
function toDateInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function FunnelDesk() {
  const { t } = useTranslation()
  const intl = usePlatformIntl()

  const [preset, setPreset] = useState<Preset>('30')
  const [groupBy, setGroupBy] = useState<FunnelGroupBy>('none')
  const [customFrom, setCustomFrom] = useState(() => toDateInput(shiftDays(startOfToday(), -29)))
  const [customTo, setCustomTo] = useState(() => toDateInput(startOfToday()))

  /*
   * La fenêtre est ancrée au DÉBUT DU JOUR, jamais à `now()`. Un `now()`
   * recalculé à chaque rendu changerait la clé de cache en permanence et
   * relancerait la requête sans fin. La borne haute est le début de demain :
   * la RPC compare en `< v_to`, donc aujourd'hui est inclus en entier.
   */
  const range = useMemo(() => {
    if (preset === 'custom') {
      const from = new Date(`${customFrom}T00:00:00`)
      const to = shiftDays(new Date(`${customTo}T00:00:00`), 1)
      return { from: from.toISOString(), to: to.toISOString() }
    }
    const today = startOfToday()
    const days = Number(preset)
    return {
      from: shiftDays(today, -(days - 1)).toISOString(),
      to: shiftDays(today, 1).toISOString(),
    }
  }, [preset, customFrom, customTo])

  const isWindowValid = !Number.isNaN(Date.parse(range.from)) && Date.parse(range.to) > Date.parse(range.from)

  const funnelQuery = useAcquisitionFunnel({ from: range.from, to: range.to, groupBy })
  const rows = useMemo(() => funnelQuery.data ?? [], [funnelQuery.data])

  const buckets = useMemo(() => groupBuckets(rows), [rows])
  // « Rien dans cette fenêtre » se dit avec ses dates, il ne se dessine pas en
  // six barres à zéro.
  const isEmpty = rows.length > 0 && rows.every((row) => row.total === null || row.total === 0)

  const periodLabel =
    rows[0] !== undefined
      ? t('platform:funnel.periodRange', {
          from: intl.date(rows[0].window_from),
          to: intl.date(rows[0].window_to),
        })
      : t('platform:funnel.periodRange', {
          from: intl.date(range.from),
          to: intl.date(range.to),
        })

  return (
    <Container size="lg" className="py-8">
      <PageHeader title={t('platform:funnel.title')} subtitle={t('platform:funnel.subtitle')} />

      <div className="mt-6 flex flex-col gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
            {t('platform:funnel.periodPicker')}
          </p>
          <SegmentedControl
            ariaLabel={t('platform:funnel.periodPicker')}
            size="sm"
            value={preset}
            onChange={setPreset}
            options={[
              { value: '7', label: t('platform:funnel.period7') },
              { value: '30', label: t('platform:funnel.period30') },
              { value: '90', label: t('platform:funnel.period90') },
              { value: 'custom', label: t('platform:funnel.periodCustom') },
            ]}
          />
        </div>

        {preset === 'custom' ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="sm:w-48">
              <TextField
                label={t('platform:funnel.customFrom')}
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
              />
            </div>
            <div className="sm:w-48">
              <TextField
                label={t('platform:funnel.customTo')}
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
                error={isWindowValid ? undefined : t('platform:funnel.refusalBadWindow')}
              />
            </div>
          </div>
        ) : null}

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
            {t('platform:funnel.breakdownPicker')}
          </p>
          <SegmentedControl
            ariaLabel={t('platform:funnel.breakdownPicker')}
            size="sm"
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: 'none', label: t('platform:funnel.breakdownNone') },
              { value: 'zone', label: t('platform:funnel.breakdownZone') },
              { value: 'origin', label: t('platform:funnel.breakdownOrigin') },
            ]}
          />
        </div>
      </div>

      {/* Les deux dernières étapes ne se rattachent à rien quand on ventile :
          le dire AVANT le tableau évite de conclure à un effondrement. */}
      {groupBy !== 'none' ? (
        <Alert variant="info" className="mt-4">
          {t('platform:funnel.breakdownWarning')}
        </Alert>
      ) : null}

      <section className="mt-10">
        <SectionHeader title={t('platform:funnel.stages')} meta={periodLabel} />

        <div className="mt-3">
          {funnelQuery.isPending ? (
            <ListSkeleton />
          ) : funnelQuery.isError ? (
            <ErrorState
              title={t('platform:funnel.loadError')}
              description={funnelErrorDescription(t, funnelQuery.error)}
            />
          ) : isEmpty ? (
            <EmptyState
              title={t('platform:funnel.emptyWindow', {
                from: intl.date(rows[0]?.window_from ?? range.from),
                to: intl.date(rows[0]?.window_to ?? range.to),
              })}
              description={t('platform:funnel.emptyWindowBody')}
            />
          ) : buckets.length === 0 ? (
            <EmptyState title={t('platform:funnel.noBuckets')} description={t('platform:funnel.noBucketsBody')} />
          ) : (
            <div className="flex flex-col gap-6">
              {buckets.map((bucket) => (
                <BucketTable key={bucket.key} bucket={bucket} groupBy={groupBy} />
              ))}
            </div>
          )}
        </div>
      </section>
    </Container>
  )
}

function funnelErrorDescription(t: TFunction, error: unknown): string | undefined {
  const token = refusalToken(error)
  const known = token ? REFUSAL_KEYS[token] : undefined
  return known ? t(`platform:funnel.${known}`) : getErrorMessage(error)
}

interface Bucket {
  key: string
  label: string
  rows: AcquisitionFunnelRow[]
}

function groupBuckets(rows: AcquisitionFunnelRow[]): Bucket[] {
  const buckets: Bucket[] = []
  for (const row of rows) {
    let bucket = buckets.find((candidate) => candidate.key === row.bucket_key)
    if (!bucket) {
      bucket = { key: row.bucket_key, label: row.bucket_label, rows: [] }
      buckets.push(bucket)
    }
    bucket.rows.push(row)
  }
  for (const bucket of buckets) {
    bucket.rows.sort((a, b) => a.stage_order - b.stage_order)
  }
  return buckets
}

function bucketTitle(t: TFunction, bucket: Bucket, groupBy: FunnelGroupBy): string {
  if (groupBy === 'none') return t('platform:funnel.bucketAll')
  if (groupBy === 'zone' && bucket.key === 'unzoned') return t('platform:funnel.bucketUnzoned')
  if (groupBy === 'origin') {
    if (bucket.key === 'unknown') return t('platform:funnel.bucketUnknownOrigin')
    const key = ORIGIN_KEYS[bucket.key]
    if (key) return t(`platform:funnel.${key}`)
  }
  return bucket.label || bucket.key
}

function BucketTable({ bucket, groupBy }: { bucket: Bucket; groupBy: FunnelGroupBy }) {
  const { t } = useTranslation()
  const title = bucketTitle(t, bucket, groupBy)

  // L'échelle des barres est le plus grand nombre RÉEL du seau. Aucune échelle
  // choisie à la main, donc aucune barre qui ment sur une proportion.
  const scale = bucket.rows.reduce((max, row) => Math.max(max, row.total ?? 0), 0)

  return (
    <div>
      <SectionHeader title={title} as="h3" />
      {groupBy === 'zone' && bucket.key === 'unzoned' ? (
        <p className="mt-1 text-sm text-ink-500">{t('platform:funnel.bucketUnzonedBody')}</p>
      ) : null}

      <div className="mt-2">
        <Table label={title}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('platform:funnel.stage')}</TableHead>
              <TableHead>{t('platform:funnel.count')}</TableHead>
              <TableHead>{t('platform:funnel.rate')}</TableHead>
              <TableHead>{t('platform:funnel.drop')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bucket.rows.length === 0 ? (
              <TableStateRow colSpan={4}>
                <EmptyState className="border-none" title={t('platform:funnel.noStages')} />
              </TableStateRow>
            ) : (
              bucket.rows.map((row, index) => (
                <StageRow key={row.stage} row={row} previous={bucket.rows[index - 1]} scale={scale} />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function StageRow({
  row,
  previous,
  scale,
}: {
  row: AcquisitionFunnelRow
  previous: AcquisitionFunnelRow | undefined
  scale: number
}) {
  const { t } = useTranslation()
  const intl = usePlatformIntl()

  const notAttributable = row.total === null && !row.attributable
  // La coupure d'attribution : l'étape précédente se rattachait à un prospect,
  // celle-ci non. Le serveur refuse le taux pour cette raison exacte ; on la
  // DÉDUIT des mêmes champs qu'il renvoie, on ne l'invente pas.
  const attributionCut =
    row.conversion_rate === null &&
    !row.rate_suppressed &&
    previous !== undefined &&
    previous.attributable &&
    !row.attributable

  const drop =
    previous?.total !== null && previous?.total !== undefined && row.total !== null
      ? previous.total - row.total
      : null

  const width = scale > 0 && row.total !== null ? Math.max(2, Math.round((row.total / scale) * 100)) : 0

  return (
    <TableRow>
      <TableCell>
        <span className="block whitespace-nowrap font-medium text-ink-950">{stageLabel(t, row.stage)}</span>
        {stageHint(t, row.stage) ? (
          <span className="block max-w-[22rem] text-pretty text-xs text-ink-500">{stageHint(t, row.stage)}</span>
        ) : null}
      </TableCell>

      <TableCell className="min-w-[10rem]">
        {notAttributable ? (
          <>
            <span className="block whitespace-nowrap text-sm font-medium text-ink-500">
              {t('platform:funnel.notAttributable')}
            </span>
            <span className="block max-w-[20rem] text-pretty text-xs text-ink-500">
              {t('platform:funnel.notAttributableBody')}
            </span>
          </>
        ) : row.total === null ? (
          <span className="text-ink-300">—</span>
        ) : (
          <>
            <span className="block text-base font-semibold tabular-nums text-ink-950">
              {intl.number(row.total)}
            </span>
            {/* Une largeur CSS calculée sur le nombre réel — pas de
                bibliothèque de graphiques, rien à interpoler. */}
            <span aria-hidden="true" className="mt-1 block h-1.5 w-full rounded-full bg-paper-100">
              <span className="block h-1.5 rounded-full bg-accent-600" style={{ width: `${width}%` }} />
            </span>
          </>
        )}
      </TableCell>

      <TableCell className="min-w-[12rem]">
        {row.conversion_rate !== null ? (
          <span className="whitespace-nowrap font-medium tabular-nums text-ink-950">
            {t('platform:funnel.ratePercent', { value: intl.number(row.conversion_rate) })}
          </span>
        ) : row.rate_suppressed ? (
          <>
            <span className="block whitespace-nowrap text-sm text-ink-500">
              {t('platform:funnel.notEnoughData')}
            </span>
            {/* Le seuil vient du SERVEUR, jamais d'une constante recopiée. */}
            <span className="block text-xs text-ink-500">
              {t('platform:funnel.minSample', { min: row.min_sample })}
            </span>
          </>
        ) : attributionCut ? (
          <>
            <span className="block whitespace-nowrap text-sm text-ink-500">
              {t('platform:funnel.rateNotComparable')}
            </span>
            <span className="block max-w-[20rem] text-pretty text-xs text-ink-500">
              {t('platform:funnel.rateNotComparableBody')}
            </span>
          </>
        ) : (
          <span className="text-ink-300">—</span>
        )}
      </TableCell>

      <TableCell className="tabular-nums">
        {drop === null ? <span className="text-ink-300">—</span> : intl.number(drop)}
      </TableCell>
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
