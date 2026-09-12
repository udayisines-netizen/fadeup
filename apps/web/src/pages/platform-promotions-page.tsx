import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { usePlatformIntl } from '@/lib/platform-intl'
import { useAuth } from '@/lib/auth-context'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import { useAllOrganizations, useOwnPlatformRole } from '@/lib/queries/platform'
import {
  refusalToken,
  useApplyPromotion,
  useBillingCatalog,
  useCreatePromotion,
  useEndPromotion,
  usePromotionRedemptions,
  usePromotionRoleLimits,
  usePromotions,
  useRevokePromotionRedemption,
  useVerifyPromotionSync,
  type PromotionDuration,
  type PromotionKind,
  type PromotionRedemptionRow,
  type PromotionRoleLimitRow,
  type PromotionRow,
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
import { PageHeader, SectionHeader } from '@/components/ui/page-header'
import { SelectField } from '@/components/ui/select-field'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { TextField } from '@/components/ui/text-field'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'

/**
 * /platform/promotions — LES REMISES, ET CE QUE STRIPE EN SAIT.
 *
 * LA RÈGLE QUI GOUVERNE TOUT L'ÉCRAN : une promotion dont
 * `stripe_confirmed_at` est nul N'EST PAS ACTIVE. La remise est portée par
 * l'objet qui facture ; tant que Stripe n'a pas répondu, FadeUp n'a qu'une
 * intention. L'écran écrit donc « en attente de Stripe » (ou l'erreur Stripe
 * telle quelle), et RETIRE les actions qui la poseraient sur un salon : un
 * coupon inexistant appliqué à une facture, c'est un salon à qui on a promis
 * -20 % et qui paiera plein tarif.
 *
 * DEUX CHEMINS D'APPLICATION, ET ILS SE LISENT. Une remise arrive soit parce
 * que le salon a tapé un code (`code`), soit parce qu'un commercial l'a posée
 * (`staff`). Ce n'est pas un détail technique : le second engage une personne
 * nommée, avec un motif, et la colonne le dit sur chaque ligne.
 *
 * LE PLAFOND DU RÔLE affiché ici est une COMMODITÉ. `create_promotion` et
 * `apply_promotion` le revérifient tous les deux côté serveur — le second
 * parce qu'un fondateur peut créer 90 % et qu'un commercial ne doit pas
 * pouvoir la poser.
 *
 * CE QUE CET ÉCRAN NE PEUT PAS FAIRE, ET LE DIT. Poser une remise demande de
 * désigner un salon, donc de lire l'annuaire des organisations — un droit
 * (`tenant.read`) que le rôle commercial ne porte pas aujourd'hui. Plutôt
 * qu'un sélecteur vide qui passerait pour une panne, l'action est absente et
 * la raison est écrite.
 */
export function PlatformPromotionsPage() {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()

  if (!can('promotions.apply')) {
    return (
      <Container size="lg" className="py-8">
        <PageHeader title={t('platform:promotions.title')} />
        <Card className="mt-6">
          <CardContent className="p-4 pt-4">
            <EmptyState
              className="border-none"
              title={t('platform:promotions.noAccess')}
              description={t('platform:promotions.noAccessBody')}
            />
          </CardContent>
        </Card>
      </Container>
    )
  }

  return <PromotionsDesk />
}

/** Les dix-neuf refus de la famille `fadeup_promotion_refusal`, tous nommés. */
const REFUSAL_KEYS: Record<string, string> = {
  not_authorized: 'refusalNotAuthorized',
  bad_code: 'refusalBadCode',
  bad_percent: 'refusalBadPercent',
  bad_amount: 'refusalBadAmount',
  bad_duration: 'refusalBadDuration',
  bad_plan: 'refusalBadPlan',
  above_role_ceiling: 'refusalAboveRoleCeiling',
  no_ceiling: 'refusalNoCeiling',
  reason_required: 'refusalReasonRequired',
  unknown_code: 'refusalUnknownCode',
  ended: 'refusalEnded',
  not_started: 'refusalNotStarted',
  expired: 'refusalExpired',
  exhausted: 'refusalExhausted',
  not_synced: 'refusalNotSynced',
  plan_not_eligible: 'refusalPlanNotEligible',
  already_discounted: 'refusalAlreadyDiscounted',
  not_active: 'refusalNotActive',
  missing_organization: 'refusalMissingOrganization',
}

const DURATION_KEYS: Record<string, string> = {
  once: 'durationOnce',
  repeating: 'durationRepeating',
  forever: 'durationForever',
}

function useRefusalToast() {
  const { t } = useTranslation()
  const { toast } = useToast()
  return {
    ok: (title: string) => toast({ title, variant: 'success' as const }),
    fail: (title: string, error: unknown) => {
      const token = refusalToken(error)
      const known = token ? REFUSAL_KEYS[token] : undefined
      toast({
        title,
        description: known ? t(`platform:promotions.${known}`) : getErrorMessage(error),
        variant: 'error',
      })
    },
  }
}

/** L'état Stripe d'une promotion, en trois valeurs seulement — jamais « actif » par défaut. */
type StripeState = 'confirmed' | 'failed' | 'waiting'

function stripeState(promotion: PromotionRow): StripeState {
  if (promotion.stripe_error) return 'failed'
  if (promotion.stripe_confirmed_at) return 'confirmed'
  return 'waiting'
}

const STRIPE_VARIANTS: Record<StripeState, BadgeVariant> = {
  confirmed: 'success',
  failed: 'danger',
  waiting: 'warning',
}

const STRIPE_LABEL_KEYS: Record<StripeState, string> = {
  confirmed: 'stripeConfirmed',
  failed: 'stripeFailed',
  waiting: 'stripeWaiting',
}

function discountLabel(
  t: TFunction,
  intl: ReturnType<typeof usePlatformIntl>,
  kind: PromotionKind,
  percentOff: number | null,
  amountOffMinor: number | null,
): string {
  if (kind === 'percent' && percentOff !== null) {
    return t('platform:promotions.percentOff', { value: intl.number(percentOff) })
  }
  if (amountOffMinor !== null) {
    return t('platform:promotions.amountOff', { value: intl.money(amountOffMinor) })
  }
  return '—'
}

function durationLabel(t: TFunction, promotion: PromotionRow): string {
  if (promotion.duration === 'repeating') {
    return t('platform:promotions.durationRepeatingMonths', { count: promotion.duration_in_months ?? 0 })
  }
  const key = DURATION_KEYS[promotion.duration]
  return key ? t(`platform:promotions.${key}`) : promotion.duration
}

function PromotionsDesk() {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()
  const { user } = useAuth()

  const [includeEnded, setIncludeEnded] = useState(false)
  const [redemptionFilter, setRedemptionFilter] = useState<string>('')

  const promotionsQuery = usePromotions(includeEnded)
  const roleQuery = useOwnPlatformRole(user?.id)
  const limitsQuery = usePromotionRoleLimits()

  const promotions = promotionsQuery.data ?? []
  const myLimit = useMemo<PromotionRoleLimitRow | null>(() => {
    const role = roleQuery.data
    if (!role) return null
    return (limitsQuery.data ?? []).find((row) => row.role === role) ?? null
  }, [roleQuery.data, limitsQuery.data])

  const canManage = can('promotions.manage')
  // Poser une remise suppose de désigner un salon, donc de lire l'annuaire.
  const canPickOrganization = can('tenant.read')

  return (
    <Container size="lg" className="py-8">
      <PageHeader
        title={t('platform:promotions.title')}
        subtitle={t('platform:promotions.subtitle')}
        actions={canManage ? <CreatePromotionAction limit={myLimit} /> : undefined}
      />

      {myLimit ? (
        <Alert variant="info" className="mt-4">
          {t('platform:promotions.yourCeiling', {
            percent: myLimit.max_percent_off,
            months: myLimit.max_duration_months,
          })}
          {myLimit.may_grant_forever ? ` ${t('platform:promotions.ceilingForever')}` : ''}
        </Alert>
      ) : null}

      {!canPickOrganization ? (
        <Alert variant="info" className="mt-4">
          {t('platform:promotions.noDirectory')}
        </Alert>
      ) : null}

      <section className="mt-10">
        <SectionHeader
          title={t('platform:promotions.list')}
          action={
            <Switch
              label={t('platform:promotions.includeEnded')}
              checked={includeEnded}
              onChange={(event) => setIncludeEnded(event.target.checked)}
            />
          }
        />
        <p className="mt-1 text-sm text-ink-500">{t('platform:promotions.listHint')}</p>

        <div className="mt-3">
          {promotionsQuery.isPending ? (
            <ListSkeleton />
          ) : promotionsQuery.isError ? (
            <ErrorState
              title={t('platform:promotions.listError')}
              description={getErrorMessage(promotionsQuery.error)}
            />
          ) : (
            <Table label={t('platform:promotions.list')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('platform:promotions.code')}</TableHead>
                  <TableHead>{t('platform:promotions.discount')}</TableHead>
                  <TableHead>{t('platform:promotions.duration')}</TableHead>
                  <TableHead>{t('platform:promotions.stripe')}</TableHead>
                  <TableHead>{t('platform:promotions.usage')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('common:action.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {promotions.length === 0 ? (
                  <TableStateRow colSpan={6}>
                    <EmptyState
                      className="border-none"
                      title={t('platform:promotions.listEmpty')}
                      description={t('platform:promotions.listEmptyBody')}
                    />
                  </TableStateRow>
                ) : (
                  promotions.map((promotion) => (
                    <PromotionRowView
                      key={promotion.id}
                      promotion={promotion}
                      canManage={canManage}
                      canPickOrganization={canPickOrganization}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      <RedemptionsSection
        promotions={promotions}
        promotionId={redemptionFilter}
        onPromotionIdChange={setRedemptionFilter}
        canManage={canManage}
      />
    </Container>
  )
}

function PromotionRowView({
  promotion,
  canManage,
  canPickOrganization,
}: {
  promotion: PromotionRow
  canManage: boolean
  canPickOrganization: boolean
}) {
  const { t } = useTranslation()
  const intl = usePlatformIntl()
  const state = stripeState(promotion)
  const isEnded = promotion.status === 'ended'
  // Une promotion non confirmée par Stripe ne peut pas être posée : le
  // serveur refuse (`not_synced`), et l'écran ne propose même pas.
  const isApplicable = state === 'confirmed' && !isEnded

  return (
    <TableRow>
      <TableCell>
        <span className="block whitespace-nowrap font-semibold text-ink-950">{promotion.code}</span>
        {promotion.note ? (
          <span className="block max-w-[16rem] truncate text-xs text-ink-500">{promotion.note}</span>
        ) : null}
        {isEnded ? (
          <Badge variant="neutral" className="mt-1">
            {t('platform:promotions.statusEnded')}
          </Badge>
        ) : null}
      </TableCell>

      <TableCell className="whitespace-nowrap text-ink-800">
        {discountLabel(t, intl, promotion.kind, promotion.percent_off, promotion.amount_off_minor)}
      </TableCell>

      <TableCell className="whitespace-nowrap text-ink-500">{durationLabel(t, promotion)}</TableCell>

      <TableCell>
        <Badge variant={STRIPE_VARIANTS[state]}>{t(`platform:promotions.${STRIPE_LABEL_KEYS[state]}`)}</Badge>
        {promotion.stripe_error ? (
          <span className="mt-1 block max-w-[16rem] text-xs text-danger-600">{promotion.stripe_error}</span>
        ) : null}
        {state === 'waiting' ? (
          <span className="mt-1 block max-w-[16rem] text-pretty text-xs text-warning-700">
            {t('platform:promotions.stripeWaitingBody')}
          </span>
        ) : null}
      </TableCell>

      <TableCell className="whitespace-nowrap text-ink-500">
        <span className="block tabular-nums text-ink-950">
          {t('platform:promotions.usageValue', {
            active: promotion.active_redemptions,
            redeemed: promotion.redeemed_count,
          })}
        </span>
        <span className="block text-xs">
          {promotion.max_redemptions === null
            ? t('platform:promotions.usageUnlimited')
            : t('platform:promotions.usageCap', { max: intl.number(promotion.max_redemptions) })}
        </span>
        <span className="block text-xs">
          {promotion.ends_at
            ? t('platform:promotions.endsOn', { date: intl.date(promotion.ends_at) })
            : t('platform:promotions.noEndDate')}
        </span>
      </TableCell>

      <TableCell className="whitespace-nowrap text-end">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canManage ? <VerifyStripeAction promotion={promotion} /> : null}
          {isApplicable && canPickOrganization ? <ApplyPromotionAction promotion={promotion} /> : null}
          {canManage && !isEnded ? <EndPromotionAction promotion={promotion} /> : null}
        </div>
      </TableCell>
    </TableRow>
  )
}

/** Relire Stripe, plutôt que supposer. Le bouton ne prétend rien : il demande. */
function VerifyStripeAction({ promotion }: { promotion: PromotionRow }) {
  const { t } = useTranslation()
  const { ok, fail } = useRefusalToast()
  const verify = useVerifyPromotionSync()

  return (
    <Button
      variant="secondary"
      size="sm"
      isLoading={verify.isPending}
      onClick={() =>
        verify.mutate(promotion.id, {
          onSuccess: () => ok(t('platform:promotions.verifyDone')),
          onError: (error) => fail(t('platform:promotions.verifyFailed'), error),
        })
      }
    >
      {t('platform:promotions.verify')}
    </Button>
  )
}

function ApplyPromotionAction({ promotion }: { promotion: PromotionRow }) {
  const { t } = useTranslation()
  const { ok, fail } = useRefusalToast()
  const apply = useApplyPromotion()
  const organizationsQuery = useAllOrganizations()

  const [open, setOpen] = useState(false)
  const [organizationId, setOrganizationId] = useState('')
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [organizationError, setOrganizationError] = useState<string | null>(null)

  const organizations = organizationsQuery.data ?? []

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t('platform:promotions.apply')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('platform:promotions.applyTitle')}</DialogTitle>
            <DialogDescription>{promotion.code}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Alert variant="info">{t('platform:promotions.applyBody')}</Alert>
            <div className="mt-3 flex flex-col gap-3">
              {organizationsQuery.isError ? (
                <ErrorState
                  title={t('platform:promotions.organizationsError')}
                  description={getErrorMessage(organizationsQuery.error)}
                />
              ) : (
                <SelectField
                  label={t('platform:promotions.organization')}
                  value={organizationId}
                  error={organizationError ?? undefined}
                  onChange={(event) => {
                    setOrganizationId(event.target.value)
                    setOrganizationError(null)
                  }}
                  options={[
                    { value: '', label: t('platform:promotions.pickOrganization') },
                    ...organizations.map((organization) => ({
                      value: organization.id,
                      label: organization.name,
                    })),
                  ]}
                />
              )}
              <Textarea
                label={t('platform:promotions.reason')}
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
              isLoading={apply.isPending}
              onClick={() => {
                if (!organizationId) {
                  setOrganizationError(t('platform:promotions.refusalMissingOrganization'))
                  return
                }
                if (!reason.trim()) {
                  setReasonError(t('platform:promotions.refusalReasonRequired'))
                  return
                }
                apply.mutate(
                  { organizationId, promotionId: promotion.id, reason: reason.trim() },
                  {
                    onSuccess: () => {
                      ok(t('platform:promotions.applied'))
                      setOpen(false)
                      setReason('')
                      setOrganizationId('')
                    },
                    onError: (error) => fail(t('platform:promotions.applyFailed'), error),
                  },
                )
              }}
            >
              {t('platform:promotions.applyConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** ARRÊTER — irréversible : la promotion ne se rouvre pas. Motif obligatoire. */
function EndPromotionAction({ promotion }: { promotion: PromotionRow }) {
  const { t } = useTranslation()
  const { ok, fail } = useRefusalToast()
  const end = useEndPromotion()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t('platform:promotions.end')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('platform:promotions.endTitle')}</DialogTitle>
            <DialogDescription>{promotion.code}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Alert variant="warning">{t('platform:promotions.endWarning')}</Alert>
            <div className="mt-3">
              <Textarea
                label={t('platform:promotions.reason')}
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
              variant="danger"
              isLoading={end.isPending}
              onClick={() => {
                if (!reason.trim()) {
                  setReasonError(t('platform:promotions.refusalReasonRequired'))
                  return
                }
                end.mutate(
                  { promotionId: promotion.id, reason: reason.trim() },
                  {
                    onSuccess: () => {
                      ok(t('platform:promotions.ended'))
                      setOpen(false)
                      setReason('')
                    },
                    onError: (error) => fail(t('platform:promotions.endFailed'), error),
                  },
                )
              }}
            >
              {t('platform:promotions.endConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * CRÉER — et le coupon Stripe qui va avec.
 *
 * Le formulaire borne ce qu'il peut (le plafond du rôle, les plans payants du
 * catalogue) ; le serveur borne tout, y compris ce que le formulaire ignore.
 * Les PRIX du catalogue ne sont pas affichés : on choisit ici des plans
 * éligibles, pas une grille tarifaire.
 */
function CreatePromotionAction({ limit }: { limit: PromotionRoleLimitRow | null }) {
  const { t } = useTranslation()
  const { ok, fail } = useRefusalToast()
  const create = useCreatePromotion()
  const catalogQuery = useBillingCatalog()

  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [kind, setKind] = useState<PromotionKind>('percent')
  const [percentOff, setPercentOff] = useState('10')
  const [amountOff, setAmountOff] = useState('10')
  const [duration, setDuration] = useState<PromotionDuration>('once')
  const [months, setMonths] = useState('3')
  const [endsAt, setEndsAt] = useState('')
  const [maxRedemptions, setMaxRedemptions] = useState('')
  const [planKeys, setPlanKeys] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)

  // Seuls les plans PAYANTS : une remise sur zéro euro n'existe pas, et le
  // serveur refuse (`bad_plan`).
  const payablePlans = (catalogQuery.data ?? []).filter((plan) => plan.price_minor > 0 && plan.is_available)

  function togglePlan(planKey: string) {
    setPlanKeys((current) =>
      current.includes(planKey) ? current.filter((key) => key !== planKey) : [...current, planKey],
    )
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>{t('platform:promotions.create')}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('platform:promotions.createTitle')}</DialogTitle>
            <DialogDescription>{t('platform:promotions.createDescription')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-3">
              {limit ? (
                <Alert variant="info">
                  {t('platform:promotions.yourCeiling', {
                    percent: limit.max_percent_off,
                    months: limit.max_duration_months,
                  })}
                </Alert>
              ) : null}

              <TextField
                label={t('platform:promotions.code')}
                value={code}
                error={codeError ?? undefined}
                autoComplete="off"
                spellCheck={false}
                hint={t('platform:promotions.codeHint')}
                onChange={(event) => {
                  setCode(event.target.value.toUpperCase())
                  setCodeError(null)
                }}
              />

              <SelectField
                label={t('platform:promotions.kind')}
                value={kind}
                onChange={(event) => setKind(event.target.value as PromotionKind)}
                options={[
                  { value: 'percent', label: t('platform:promotions.kindPercent') },
                  { value: 'amount', label: t('platform:promotions.kindAmount') },
                ]}
              />

              {kind === 'percent' ? (
                <TextField
                  label={t('platform:promotions.percent')}
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={limit?.max_percent_off ?? 100}
                  step={1}
                  value={percentOff}
                  onChange={(event) => setPercentOff(event.target.value)}
                />
              ) : (
                <TextField
                  label={t('platform:promotions.amount')}
                  type="number"
                  inputMode="decimal"
                  min={1}
                  step={1}
                  value={amountOff}
                  hint={t('platform:promotions.amountHint')}
                  onChange={(event) => setAmountOff(event.target.value)}
                />
              )}

              <SelectField
                label={t('platform:promotions.duration')}
                value={duration}
                onChange={(event) => setDuration(event.target.value as PromotionDuration)}
                options={[
                  { value: 'once', label: t('platform:promotions.durationOnce') },
                  { value: 'repeating', label: t('platform:promotions.durationRepeating') },
                  { value: 'forever', label: t('platform:promotions.durationForever') },
                ]}
              />

              {duration === 'repeating' ? (
                <TextField
                  label={t('platform:promotions.months')}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={limit?.max_duration_months ?? 36}
                  step={1}
                  value={months}
                  onChange={(event) => setMonths(event.target.value)}
                />
              ) : null}

              <TextField
                label={t('platform:promotions.endsAtLabel')}
                type="date"
                value={endsAt}
                hint={t('platform:promotions.endsAtHint')}
                onChange={(event) => setEndsAt(event.target.value)}
              />

              <TextField
                label={t('platform:promotions.maxRedemptions')}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={maxRedemptions}
                hint={t('platform:promotions.maxRedemptionsHint')}
                onChange={(event) => setMaxRedemptions(event.target.value)}
              />

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-ink-950">
                  {t('platform:promotions.eligiblePlans')}
                </legend>
                <p className="text-xs text-ink-500">{t('platform:promotions.eligiblePlansHint')}</p>
                {catalogQuery.isPending ? (
                  <Skeleton className="h-9 w-full" />
                ) : catalogQuery.isError ? (
                  <ErrorState
                    title={t('platform:promotions.catalogError')}
                    description={getErrorMessage(catalogQuery.error)}
                  />
                ) : payablePlans.length === 0 ? (
                  <EmptyState className="border-none" title={t('platform:promotions.catalogEmpty')} />
                ) : (
                  payablePlans.map((plan) => (
                    <label key={plan.plan_key} className="flex min-h-11 items-center gap-2 text-sm text-ink-800">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border-strong"
                        checked={planKeys.includes(plan.plan_key)}
                        onChange={() => togglePlan(plan.plan_key)}
                      />
                      <span className="min-w-0 truncate">{plan.display_name}</span>
                    </label>
                  ))
                )}
              </fieldset>

              <Textarea
                label={t('platform:promotions.note')}
                value={note}
                rows={2}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common:action.cancel')}
            </Button>
            <Button
              isLoading={create.isPending}
              onClick={() => {
                const trimmed = code.trim().toUpperCase()
                if (!/^[A-Z0-9]{4,24}$/.test(trimmed)) {
                  setCodeError(t('platform:promotions.refusalBadCode'))
                  return
                }
                create.mutate(
                  {
                    code: trimmed,
                    kind,
                    percentOff: kind === 'percent' ? Number(percentOff) : null,
                    amountOffMinor: kind === 'amount' ? Math.round(Number(amountOff) * 100) : null,
                    duration,
                    durationInMonths: duration === 'repeating' ? Number(months) : null,
                    startsAt: null,
                    endsAt: endsAt ? new Date(`${endsAt}T23:59:59`).toISOString() : null,
                    maxRedemptions: maxRedemptions ? Number(maxRedemptions) : null,
                    eligiblePlanKeys: planKeys,
                    note,
                  },
                  {
                    onSuccess: () => {
                      ok(t('platform:promotions.created'))
                      setOpen(false)
                      setCode('')
                      setNote('')
                      setPlanKeys([])
                    },
                    onError: (error) => fail(t('platform:promotions.createFailed'), error),
                  },
                )
              }}
            >
              {t('platform:promotions.createConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function RedemptionsSection({
  promotions,
  promotionId,
  onPromotionIdChange,
  canManage,
}: {
  promotions: PromotionRow[]
  promotionId: string
  onPromotionIdChange: (value: string) => void
  canManage: boolean
}) {
  const { t } = useTranslation()
  const redemptionsQuery = usePromotionRedemptions(promotionId === '' ? null : promotionId)
  const redemptions = redemptionsQuery.data ?? []

  return (
    <section className="mt-10">
      <SectionHeader title={t('platform:promotions.redemptions')} />
      <p className="mt-1 text-sm text-ink-500">{t('platform:promotions.redemptionsHint')}</p>

      <div className="mt-3 sm:w-72">
        <SelectField
          label={t('platform:promotions.filterByPromotion')}
          value={promotionId}
          onChange={(event) => onPromotionIdChange(event.target.value)}
          options={[
            { value: '', label: t('platform:promotions.allPromotions') },
            ...promotions.map((promotion) => ({ value: promotion.id, label: promotion.code })),
          ]}
        />
      </div>

      <div className="mt-4">
        {redemptionsQuery.isPending ? (
          <ListSkeleton />
        ) : redemptionsQuery.isError ? (
          <ErrorState
            title={t('platform:promotions.redemptionsError')}
            description={getErrorMessage(redemptionsQuery.error)}
          />
        ) : (
          <Table label={t('platform:promotions.redemptions')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('platform:promotions.organization')}</TableHead>
                <TableHead>{t('platform:promotions.code')}</TableHead>
                <TableHead>{t('platform:promotions.appliedVia')}</TableHead>
                <TableHead>{t('platform:promotions.appliedBy')}</TableHead>
                <TableHead>{t('platform:promotions.reason')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common:action.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {redemptions.length === 0 ? (
                <TableStateRow colSpan={6}>
                  <EmptyState
                    className="border-none"
                    title={
                      promotionId
                        ? t('platform:promotions.redemptionsEmptyFiltered')
                        : t('platform:promotions.redemptionsEmpty')
                    }
                  />
                </TableStateRow>
              ) : (
                redemptions.map((redemption) => (
                  <RedemptionRow key={redemption.id} redemption={redemption} canManage={canManage} />
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  )
}

function RedemptionRow({
  redemption,
  canManage,
}: {
  redemption: PromotionRedemptionRow
  canManage: boolean
}) {
  const { t } = useTranslation()
  const intl = usePlatformIntl()
  const isActive = redemption.status === 'active'

  return (
    <TableRow>
      <TableCell>
        <span className="block max-w-[14rem] truncate font-medium text-ink-950">
          {redemption.organization_name}
        </span>
        <span className="block text-xs text-ink-500">{intl.dateTime(redemption.applied_at)}</span>
        {!isActive ? (
          <Badge variant="neutral" className="mt-1">
            {t('platform:promotions.redemptionRevoked')}
          </Badge>
        ) : null}
      </TableCell>

      <TableCell className="whitespace-nowrap">
        <span className="block font-semibold text-ink-950">{redemption.code}</span>
        <span className="block text-xs text-ink-500">
          {discountLabel(t, intl, redemption.percent_off !== null ? 'percent' : 'amount', redemption.percent_off, redemption.amount_off_minor)}
        </span>
      </TableCell>

      {/* LES DEUX CHEMINS, sur chaque ligne : code tapé par le salon, ou geste
          d'un commercial. Le second engage quelqu'un. */}
      <TableCell>
        <Badge variant={redemption.applied_via === 'staff' ? 'accent' : 'neutral'}>
          {redemption.applied_via === 'staff'
            ? t('platform:promotions.viaStaff')
            : t('platform:promotions.viaCode')}
        </Badge>
      </TableCell>

      <TableCell className="max-w-[14rem] truncate text-ink-500">
        {redemption.applied_by_email ?? '—'}
      </TableCell>

      <TableCell className="max-w-[18rem]">
        {redemption.reason ? (
          <span className="block truncate text-ink-800">{redemption.reason}</span>
        ) : (
          <span className="text-ink-300">—</span>
        )}
        {redemption.revoke_reason ? (
          <span className="block truncate text-xs text-ink-500">{redemption.revoke_reason}</span>
        ) : null}
      </TableCell>

      <TableCell className="whitespace-nowrap text-end">
        {canManage && isActive ? <RevokeRedemptionAction redemption={redemption} /> : null}
      </TableCell>
    </TableRow>
  )
}

/** RÉVOQUER — la remise tombe chez Stripe aussi. Motif obligatoire. */
function RevokeRedemptionAction({ redemption }: { redemption: PromotionRedemptionRow }) {
  const { t } = useTranslation()
  const { ok, fail } = useRefusalToast()
  const revoke = useRevokePromotionRedemption()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t('platform:promotions.revoke')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('platform:promotions.revokeTitle')}</DialogTitle>
            <DialogDescription>{redemption.organization_name}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Alert variant="warning">{t('platform:promotions.revokeWarning')}</Alert>
            <div className="mt-3">
              <Textarea
                label={t('platform:promotions.reason')}
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
              variant="danger"
              isLoading={revoke.isPending}
              onClick={() => {
                if (!reason.trim()) {
                  setReasonError(t('platform:promotions.refusalReasonRequired'))
                  return
                }
                revoke.mutate(
                  { redemptionId: redemption.id, reason: reason.trim() },
                  {
                    onSuccess: () => {
                      ok(t('platform:promotions.revoked'))
                      setOpen(false)
                      setReason('')
                    },
                    onError: (error) => fail(t('platform:promotions.revokeFailed'), error),
                  },
                )
              }}
            >
              {t('platform:promotions.revokeConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
