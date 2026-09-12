import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { usePlatformIntl } from '@/lib/platform-intl'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import {
  refusalToken,
  useSetPlatformSetting,
  usePlatformSettings,
  type PlatformSettingFamily,
  type PlatformSettingRow,
} from '@/lib/queries/platform-plat3'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader, SectionHeader } from '@/components/ui/page-header'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Skeleton } from '@/components/ui/skeleton'
import { TextField } from '@/components/ui/text-field'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'

/**
 * /platform/settings — LES DÉFAUTS DE LA PLATEFORME.
 *
 * Un réglage sans conséquence écrite est un piège : quelqu'un baisse
 * `booking.window_days` de 90 à 7 en croyant régler une préférence, et tous
 * les clients de FadeUp perdent onze semaines de calendrier. CHAQUE clé porte
 * donc DEUX phrases — ce qu'elle fait, et ce qui change si on y touche — et
 * les deux viennent de la localisation, jamais de la base.
 *
 * TROIS VÉRITÉS QUE CET ÉCRAN NE MAQUILLE PAS.
 *
 * 1. LES BORNES AFFICHÉES SONT UNE COMMODITÉ. `min`/`max`/`step` sur l'input
 *    évitent une aller-retour inutile ; ils n'autorisent rien. L'autorité est
 *    `set_platform_setting`, qui revérifie bornes, entier et changement réel,
 *    et dont le refus est affiché tel quel quand il tombe. Un écran ne refuse
 *    pas : X3 a prouvé deux fois qu'on appelle la RPC directement.
 * 2. LA PROPAGATION NE SE PROMET PAS. Combien de salons suivent encore le
 *    défaut n'est pas connaissable avant l'écriture — un salon peut surcharger
 *    entre la lecture et le clic. Le chiffre est donc RAPPORTÉ APRÈS, depuis
 *    `locations_propagated`, jamais annoncé avant.
 * 3. AUCUN PRIX ICI. La grille tarifaire vit dans `commercial_plans` et la
 *    contrainte de famille de la table l'interdit. L'alerte le dit, pour que
 *    personne ne la cherche.
 */
export function PlatformSettingsPage() {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()

  // Le commercial, le support et le modérateur n'ont pas `platform.settings` :
  // ils reçoivent une phrase honnête, pas une liste vide qui ferait croire à
  // une panne. La requête ne part même pas.
  if (!can('platform.settings')) {
    return (
      <Container size="lg" className="py-8">
        <PageHeader title={t('platform:settings.title')} />
        <Card className="mt-6">
          <CardContent className="p-4 pt-4">
            <EmptyState
              className="border-none"
              title={t('platform:settings.noAccess')}
              description={t('platform:settings.noAccessBody')}
            />
          </CardContent>
        </Card>
      </Container>
    )
  }

  return <PlatformSettingsDesk />
}

/** L'ordre du cahier des charges, jamais l'ordre alphabétique. */
const FAMILIES: PlatformSettingFamily[] = ['queue', 'booking', 'search', 'notifications']

const FAMILY_KEYS: Record<PlatformSettingFamily, string> = {
  queue: 'familyQueue',
  booking: 'familyBooking',
  search: 'familySearch',
  notifications: 'familyNotifications',
}

/** Les unités de la base sont des jetons, pas des mots : elles se traduisent. */
const UNIT_KEYS: Record<string, string> = {
  people: 'unitPeople',
  minutes: 'unitMinutes',
  meters: 'unitMeters',
  days: 'unitDays',
  bookings: 'unitBookings',
  hours: 'unitHours',
  hour: 'unitHour',
  weight: 'unitWeight',
}

/**
 * Les refus de `set_platform_setting`. Ce qui n'est pas reconnu retombe sur le
 * message brut du serveur plutôt que sur rien.
 */
const REFUSAL_KEYS: Record<string, string> = {
  not_authorized: 'refusalNotAuthorized',
  unknown_key: 'refusalUnknownKey',
  out_of_range: 'refusalOutOfRange',
  not_an_integer: 'refusalNotAnInteger',
  no_change: 'refusalNoChange',
  missing_argument: 'refusalMissingArgument',
}

/** `queue.capacity_per_barber` → `queue_capacity_per_barber`, la forme des clés i18n. */
function copyKey(settingKey: string): string {
  return settingKey.replace(/\./g, '_')
}

function settingLabel(t: TFunction, row: PlatformSettingRow): string {
  return t(`platform:settings.keys.${copyKey(row.key)}.label`, { defaultValue: row.key })
}

function settingEffect(t: TFunction, row: PlatformSettingRow): string | null {
  const key = `platform:settings.keys.${copyKey(row.key)}.effect`
  const value = t(key, { defaultValue: '' })
  return value ? value : null
}

function PlatformSettingsDesk() {
  const { t } = useTranslation()
  const [family, setFamily] = useState<PlatformSettingFamily>('queue')
  const settingsQuery = usePlatformSettings()

  const rows = useMemo(
    () => (settingsQuery.data ?? []).filter((row) => row.family === family),
    [settingsQuery.data, family],
  )

  return (
    <Container size="lg" className="py-8">
      <PageHeader title={t('platform:settings.title')} subtitle={t('platform:settings.subtitle')} />

      {/* La grille tarifaire n'est pas ici et ne peut pas y être : la
          contrainte de famille de `platform_settings` refuse « pricing ».
          Le dire évite qu'on la cherche, puis qu'on l'ajoute. */}
      <Alert variant="info" className="mt-4">
        {t('platform:settings.noPricingHere')}
      </Alert>

      {/*
        SEGMENTED CONTROL PLUTÔT QUE TABS, et c'est un choix de 390 px.

        Les quatre familles FILTRENT une liste qui est déjà le sujet de la
        page — elles ne changent pas son identité : c'est exactement la
        distinction que le primitif documente entre un radiogroup et des
        onglets. Et surtout, `SegmentedControl` est une grille `w-full` : elle
        se comprime, elle ne déborde jamais. Une barre d'onglets `inline-flex`
        plus large que 390 px cacherait des familles derrière un défilement
        horizontal que l'utilisateur doit deviner — quatre choix visibles
        valent mieux qu'un mot entier et deux choix invisibles.
      */}
      <div className="mt-6">
        <SegmentedControl
          ariaLabel={t('platform:settings.familyPicker')}
          size="sm"
          value={family}
          onChange={setFamily}
          options={FAMILIES.map((item) => ({
            value: item,
            label: t(`platform:settings.${FAMILY_KEYS[item]}`),
          }))}
        />
      </div>

      <section className="mt-10">
        <SectionHeader title={t(`platform:settings.${FAMILY_KEYS[family]}`)} />
        <p className="mt-1 text-sm text-ink-500">{t(`platform:settings.${FAMILY_KEYS[family]}Hint`)}</p>

        <div className="mt-4">
          {settingsQuery.isPending ? (
            <ListSkeleton />
          ) : settingsQuery.isError ? (
            <ErrorState
              title={t('platform:settings.listError')}
              description={getErrorMessage(settingsQuery.error)}
            />
          ) : rows.length === 0 ? (
            <EmptyState title={t('platform:settings.familyEmpty')} />
          ) : (
            <div className="flex flex-col gap-3">
              {rows.map((row) => (
                <SettingCard key={row.key} row={row} />
              ))}
            </div>
          )}
        </div>
      </section>
    </Container>
  )
}

function SettingCard({ row }: { row: PlatformSettingRow }) {
  const { t } = useTranslation()
  const intl = usePlatformIntl()
  const { toast } = useToast()
  const save = useSetPlatformSetting()

  const [value, setValue] = useState(String(row.value))
  const [reason, setReason] = useState('')

  const effect = settingEffect(t, row)
  const unit = row.unit ? t(`platform:settings.${UNIT_KEYS[row.unit] ?? ''}`, { defaultValue: row.unit }) : null
  const parsed = Number(value)
  const isDirty = value.trim() !== '' && Number.isFinite(parsed) && parsed !== row.value

  function submit() {
    if (!isDirty) return
    save.mutate(
      { key: row.key, value: parsed, reason },
      {
        onSuccess: (result) => {
          setReason('')
          toast({
            title: t('platform:settings.saved'),
            // Le nombre de salons touchés vient de la RÉPONSE, pas d'une
            // estimation faite avant le clic.
            description:
              result && result.locations_propagated > 0
                ? t('platform:settings.savedPropagated', { count: result.locations_propagated })
                : undefined,
            variant: 'success',
          })
        },
        onError: (error) => {
          const token = refusalToken(error)
          const known = token ? REFUSAL_KEYS[token] : undefined
          toast({
            title: t('platform:settings.saveFailed'),
            description: known ? t(`platform:settings.${known}`) : getErrorMessage(error),
            variant: 'error',
          })
        },
      },
    )
  }

  return (
    <Card>
      <CardContent className="p-4 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="min-w-0 text-sm font-semibold text-ink-950">{settingLabel(t, row)}</h3>
          {/* La source dit quelle table porte la valeur. Il n'y en a jamais
              deux : les poids du fil restent chez eux. */}
          <Badge variant={row.source === 'feed_ranking_weights' ? 'info' : 'neutral'}>
            {row.source === 'feed_ranking_weights'
              ? t('platform:settings.sourceFeedWeights')
              : t('platform:settings.sourcePlatform')}
          </Badge>
        </div>

        {effect ? <p className="mt-1 text-pretty text-sm text-ink-500">{effect}</p> : null}

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="sm:w-56">
            <TextField
              label={t('platform:settings.valueLabel')}
              type="number"
              inputMode="decimal"
              // COMMODITÉ, PAS AUTORISATION : le serveur revérifie ces bornes
              // et refuse par lui-même (`out_of_range`, `not_an_integer`).
              min={row.min_value}
              max={row.max_value}
              step={row.is_integer ? 1 : 0.1}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              hint={
                unit
                  ? t('platform:settings.boundsWithUnit', {
                      min: intl.number(row.min_value),
                      max: intl.number(row.max_value),
                      unit,
                    })
                  : t('platform:settings.bounds', {
                      min: intl.number(row.min_value),
                      max: intl.number(row.max_value),
                    })
              }
            />
          </div>
          <div className="flex-1">
            <TextField
              label={t('platform:settings.reasonLabel')}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              autoComplete="off"
              hint={t('platform:settings.reasonHint')}
            />
          </div>
          <div className="sm:pt-7">
            <Button size="sm" isLoading={save.isPending} disabled={!isDirty} onClick={submit}>
              {t('platform:settings.save')}
            </Button>
          </div>
        </div>

        <p className="mt-3 text-xs text-ink-500">
          {t('platform:settings.lastChanged', {
            date: intl.dateTime(row.updated_at),
            who: row.updated_by_email ?? '—',
          })}
        </p>
      </CardContent>
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
