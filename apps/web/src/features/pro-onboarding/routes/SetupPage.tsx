import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useApplySurfaceTheme } from '@/shared/theme/useTheme'
import { useProEntitlements, useProOrganization } from '@/shared/data/organization'
import { useSession } from '@/shared/hooks/useSession'
import { Button } from '@/shared/ui/Button'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Input } from '@/shared/ui/Input'
import { QueueQrPoster } from '@/shared/ui/QueueQrPoster'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { SkeletonRow } from '@/shared/ui/Skeleton'
import { useToast } from '@/shared/ui/Toast'
import { IconCheck } from '@/shared/ui/icons'
import { buildQueueLink } from '@/shared/lib/queueLink'
import { errorMessageKey, toAppError } from '@/shared/data/errors'
import {
  useActivateOrganization,
  useApplyHours,
  useApplyServices,
  useCreateSalon,
  useEnsureOwnerBarber,
  useOpenQueue,
  useSaveAddress,
  useSetupBarber,
  useSetupCheckIn,
  useSetupLocation,
  useSetupQueueState,
  useSetupReadiness,
  type StarterService,
  type WeeklyDay,
} from '@/features/pro-onboarding/api/setup'

/**
 * /setup — de la création du compte à une file OUVERTE et un QR imprimable,
 * en moins de vingt minutes, par quelqu'un qui ne sait pas coder (F1 §6).
 *
 * Check-list, pas tunnel : chaque étape est un écrit serveur immédiat, et
 * l'état AFFICHÉ vient de `get_organization_readiness` — un stagiaire
 * interrompu rouvre la page et reprend à la première étape non faite.
 *
 * Le minimum vital, rien d'autre : salon, un lieu positionné, un barber, un
 * service, des horaires, l'essai (qui livre la capacité `liveQueue` — une
 * organisation Free n'admet personne), la file ouverte, le QR au mur.
 */

const STEP_IDS = ['salon', 'you', 'address', 'services', 'hours', 'activate', 'open', 'qr'] as const
type StepId = (typeof STEP_IDS)[number]

function slugify(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 48)
}

/* Gabarits de catalogue barber (MASTER_SPEC §15 « catalogue prérempli ») —
   des INITIALISATEURS modifiables avant envoi, jamais des données
   opérationnelles. */
const STARTER_TEMPLATE: StarterService[] = [
  { name: 'Coupe', duration_minutes: 30, price_cents: 2000 },
  { name: 'Coupe + barbe', duration_minutes: 45, price_cents: 3000 },
  { name: 'Barbe', duration_minutes: 15, price_cents: 1200 },
]

const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0] as const

export function SetupPage() {
  useApplySurfaceTheme('pro')
  const { t } = useTranslation('v2')
  const { toast } = useToast()
  const { user } = useSession()
  const { organization, loading: organizationLoading } = useProOrganization()

  const organizationId = organization?.organizationId ?? null
  const location = (organization?.locations ?? []).find((row) => row.kind === 'physical_address') ?? null
  const locationId = location?.id ?? null

  const readiness = useSetupReadiness(organizationId)
  const locationDetail = useSetupLocation(locationId)
  const barber = useSetupBarber(organizationId)
  const queueState = useSetupQueueState(locationId)
  const { entitlements } = useProEntitlements(organizationId)

  const createSalon = useCreateSalon()
  const ensureBarber = useEnsureOwnerBarber(organizationId)
  const saveAddress = useSaveAddress(organizationId)
  const applyServices = useApplyServices(organizationId)
  const applyHours = useApplyHours(organizationId)
  const activate = useActivateOrganization(organizationId)
  const openQueue = useOpenQueue(organizationId)

  const hasQueueCapability = (entitlements?.liveCapabilities ?? []).includes('liveQueue')
  const queueIsOpen = Boolean(queueState.data?.queue_open && queueState.data?.mode_allows_queue)
  const checkIn = useSetupCheckIn(locationId, queueIsOpen || hasQueueCapability)

  const done: Record<StepId, boolean> = {
    salon: Boolean(organization),
    you: Boolean(readiness.data?.has_professional),
    address: Boolean(readiness.data?.has_location_address && locationDetail.data?.latitude != null),
    services: Boolean(readiness.data?.has_service_at_location),
    hours: Boolean(readiness.data?.has_location_hours),
    activate: hasQueueCapability,
    open: queueIsOpen,
    qr: false,
  }
  const activeStep: StepId = STEP_IDS.find((id) => !done[id]) ?? 'qr'

  /* ---------------- état des formulaires ---------------- */
  const [salonName, setSalonName] = useState('')
  const [salonSlug, setSalonSlug] = useState('')
  const [businessType, setBusinessType] = useState<'barbershop' | 'solo_professional'>('barbershop')
  const [displayName, setDisplayName] = useState('')
  const [address, setAddress] = useState({ addressLine1: '', postalCode: '', city: '' })
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null)
  const [geoIssue, setGeoIssue] = useState(false)
  const [services, setServices] = useState<StarterService[]>(STARTER_TEMPLATE)
  const [openDays, setOpenDays] = useState<Set<number>>(new Set([2, 3, 4, 5, 6]))
  const [openTime, setOpenTime] = useState('09:00')
  const [closeTime, setCloseTime] = useState('19:00')
  const [stepError, setStepError] = useState<string | null>(null)

  const slug = salonSlug || slugify(salonName)

  const fail = (raw: unknown) => {
    setStepError(t(errorMessageKey(toAppError(raw))))
  }
  const ok = () => {
    setStepError(null)
    toast({ title: t('queue.setup.savedToast'), tone: 'success' })
  }

  const qrLink = useMemo(() => {
    if (!organization || !locationId || !checkIn.data?.queue_check_in_token) return null
    return buildQueueLink(window.location.origin, organization.slug, locationId, checkIn.data.queue_check_in_token)
  }, [organization, locationId, checkIn.data?.queue_check_in_token])

  if (organizationLoading) {
    return (
      <main className="mx-auto w-full max-w-xl p-4">
        <SkeletonRow />
        <SkeletonRow />
      </main>
    )
  }

  /* ---------------- rendu d'une étape ---------------- */
  const stepHeader = (id: StepId, index: number) => (
    <div className="flex items-center gap-3">
      <span
        className={
          done[id]
            ? 'inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-avatar)] bg-[var(--fu-accent)] text-[var(--fu-accent-fg)]'
            : 'inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-avatar)] border border-[var(--fu-border-strong)] font-fu-mono text-fu-sm tabular-nums text-[var(--fu-text-secondary)]'
        }
      >
        {done[id] ? <IconCheck aria-hidden="true" className="size-4" /> : index + 1}
      </span>
      <h2 className={done[id] ? 'text-fu-base font-medium text-[var(--fu-text-secondary)]' : 'text-fu-base font-semibold'}>
        {t(`queue.setup.steps.${id}.title`)}
      </h2>
    </div>
  )

  return (
    <main className="mx-auto flex w-full min-h-dvh max-w-xl flex-col gap-4 p-4 pb-16">
      <header className="flex items-center gap-3 py-2">
        <img src="/brand/fadeup-mark-primary.png" alt={t('common.brand.logoAlt')} className="size-10" />
        <div>
          <h1 className="text-fu-xl font-semibold">{t('queue.setup.title')}</h1>
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('queue.setup.subtitle')}</p>
        </div>
      </header>

      {STEP_IDS.map((id, index) => (
        <section
          key={id}
          aria-current={activeStep === id ? 'step' : undefined}
          className={
            activeStep === id
              ? 'rounded-[var(--radius-card)] border border-[var(--fu-border-strong)] bg-[var(--fu-surface)] p-4'
              : 'rounded-[var(--radius-card)] bg-[var(--fu-surface)] p-4'
          }
        >
          {stepHeader(id, index)}

          {activeStep === id && (
            <div className="mt-4 flex flex-col gap-3">
              <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t(`queue.setup.steps.${id}.description`)}</p>

              {id === 'salon' && (
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (!salonName.trim() || !slug) return
                    createSalon.mutate(
                      {
                        name: salonName.trim(),
                        slug,
                        locationName: salonName.trim(),
                        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
                        businessType,
                      },
                      { onSuccess: ok, onError: fail },
                    )
                  }}
                >
                  <Input
                    label={t('queue.setup.salon.nameLabel')}
                    value={salonName}
                    onChange={(event) => setSalonName(event.target.value)}
                    required
                  />
                  <Input
                    label={t('queue.setup.salon.slugLabel')}
                    hint={t('queue.setup.salon.slugHint')}
                    value={slug}
                    onChange={(event) => setSalonSlug(slugify(event.target.value))}
                    required
                  />
                  <SegmentedControl
                    label={t('queue.setup.salon.typeLabel')}
                    options={[
                      { value: 'barbershop', label: t('queue.setup.salon.typeShop') },
                      { value: 'solo_professional', label: t('queue.setup.salon.typeSolo') },
                    ]}
                    value={businessType}
                    onValueChange={(value) => setBusinessType(value as 'barbershop' | 'solo_professional')}
                  />
                  <Button type="submit" variant="primary" loading={createSalon.isPending}>
                    {t('queue.setup.continue')}
                  </Button>
                </form>
              )}

              {id === 'you' && locationId && (
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const name = displayName.trim() || user?.email?.split('@')[0] || ''
                    if (!name) return
                    ensureBarber.mutate({ locationId, displayName: name }, { onSuccess: ok, onError: fail })
                  }}
                >
                  <Input
                    label={t('queue.setup.you.nameLabel')}
                    hint={t('queue.setup.you.nameHint')}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    required
                  />
                  <Button type="submit" variant="primary" loading={ensureBarber.isPending}>
                    {t('queue.setup.continue')}
                  </Button>
                </form>
              )}

              {id === 'address' && locationId && (
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    saveAddress.mutate(
                      {
                        locationId,
                        addressLine1: address.addressLine1.trim(),
                        postalCode: address.postalCode.trim(),
                        city: address.city.trim(),
                        latitude: coords?.latitude ?? null,
                        longitude: coords?.longitude ?? null,
                      },
                      { onSuccess: ok, onError: fail },
                    )
                  }}
                >
                  <Input
                    label={t('queue.setup.address.lineLabel')}
                    value={address.addressLine1}
                    onChange={(event) => setAddress((prev) => ({ ...prev, addressLine1: event.target.value }))}
                    autoComplete="street-address"
                    required
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label={t('queue.setup.address.postalLabel')}
                      value={address.postalCode}
                      onChange={(event) => setAddress((prev) => ({ ...prev, postalCode: event.target.value }))}
                      autoComplete="postal-code"
                      required
                    />
                    <Input
                      label={t('queue.setup.address.cityLabel')}
                      value={address.city}
                      onChange={(event) => setAddress((prev) => ({ ...prev, city: event.target.value }))}
                      required
                    />
                  </div>
                  {/* La géofence de la file exige la POSITION du salon. Le
                      stagiaire est SUR PLACE : sa position est celle du salon.
                      Aucun géocodeur n'existe dans la pile — décision F1. */}
                  <div className="flex items-center gap-3">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setGeoIssue(false)
                        navigator.geolocation.getCurrentPosition(
                          (position) => setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
                          () => setGeoIssue(true),
                          { enableHighAccuracy: true, timeout: 15_000 },
                        )
                      }}
                    >
                      {t('queue.setup.address.captureCta')}
                    </Button>
                    {coords && (
                      <span className="inline-flex items-center gap-1.5 text-fu-sm text-[var(--fu-text-secondary)]">
                        <IconCheck aria-hidden="true" className="size-4" />
                        {t('queue.setup.address.captured')}
                      </span>
                    )}
                  </div>
                  {geoIssue && (
                    <p role="alert" className="text-fu-sm text-[var(--fu-text-primary)]">
                      {t('queue.setup.address.geoIssue')}
                    </p>
                  )}
                  <p className="text-fu-xs text-[var(--fu-text-secondary)]">{t('queue.setup.address.whyPosition')}</p>
                  <Button type="submit" variant="primary" loading={saveAddress.isPending} disabled={!coords}>
                    {t('queue.setup.continue')}
                  </Button>
                </form>
              )}

              {id === 'services' && locationId && (
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const valid = services.filter((row) => row.name.trim() && row.duration_minutes > 0 && row.price_cents >= 0)
                    if (valid.length === 0) return
                    applyServices.mutate(
                      { locationId, barberId: barber.data?.id ?? null, services: valid },
                      { onSuccess: ok, onError: fail },
                    )
                  }}
                >
                  {services.map((service, serviceIndex) => (
                    <div key={serviceIndex} className="grid grid-cols-[1fr_5rem_5rem] items-end gap-2">
                      <Input
                        label={serviceIndex === 0 ? t('queue.setup.services.nameLabel') : `${t('queue.setup.services.nameLabel')} ${serviceIndex + 1}`}
                        value={service.name}
                        onChange={(event) =>
                          setServices((prev) => prev.map((row, i) => (i === serviceIndex ? { ...row, name: event.target.value } : row)))
                        }
                      />
                      <Input
                        label={t('queue.setup.services.durationLabel')}
                        type="number"
                        min={5}
                        step={5}
                        value={String(service.duration_minutes)}
                        onChange={(event) =>
                          setServices((prev) =>
                            prev.map((row, i) =>
                              i === serviceIndex ? { ...row, duration_minutes: Number(event.target.value) || 0 } : row,
                            ),
                          )
                        }
                      />
                      <Input
                        label={t('queue.setup.services.priceLabel')}
                        type="number"
                        min={0}
                        step={0.5}
                        value={String(service.price_cents / 100)}
                        onChange={(event) =>
                          setServices((prev) =>
                            prev.map((row, i) =>
                              i === serviceIndex ? { ...row, price_cents: Math.round(Number(event.target.value) * 100) || 0 } : row,
                            ),
                          )
                        }
                      />
                    </div>
                  ))}
                  <Button type="submit" variant="primary" loading={applyServices.isPending}>
                    {t('queue.setup.continue')}
                  </Button>
                </form>
              )}

              {id === 'hours' && locationId && (
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const days: WeeklyDay[] = WEEK_DAYS.map((day) =>
                      openDays.has(day)
                        ? { day_of_week: day, is_closed: false, open_time: openTime, close_time: closeTime }
                        : { day_of_week: day, is_closed: true },
                    )
                    applyHours.mutate(
                      { locationId, barberId: barber.data?.id ?? null, days },
                      { onSuccess: ok, onError: fail },
                    )
                  }}
                >
                  <fieldset className="flex flex-wrap gap-2">
                    <legend className="mb-2 text-fu-sm font-medium">{t('queue.setup.hours.daysLabel')}</legend>
                    {WEEK_DAYS.map((day) => (
                      <Checkbox
                        key={day}
                        label={t(`queue.setup.hours.day${day}`)}
                        checked={openDays.has(day)}
                        onCheckedChange={(checked) =>
                          setOpenDays((prev) => {
                            const next = new Set(prev)
                            if (checked) next.add(day)
                            else next.delete(day)
                            return next
                          })
                        }
                      />
                    ))}
                  </fieldset>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label={t('queue.setup.hours.openLabel')}
                      type="time"
                      value={openTime}
                      onChange={(event) => setOpenTime(event.target.value)}
                      required
                    />
                    <Input
                      label={t('queue.setup.hours.closeLabel')}
                      type="time"
                      value={closeTime}
                      onChange={(event) => setCloseTime(event.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" variant="primary" loading={applyHours.isPending}>
                    {t('queue.setup.continue')}
                  </Button>
                </form>
              )}

              {id === 'activate' && (
                <div className="flex flex-col gap-3">
                  <Button
                    variant="primary"
                    loading={activate.isPending}
                    onClick={() => activate.mutate(undefined, { onSuccess: ok, onError: fail })}
                  >
                    {t('queue.setup.activate.cta')}
                  </Button>
                  <p className="text-fu-xs text-[var(--fu-text-secondary)]">{t('queue.setup.activate.hint')}</p>
                </div>
              )}

              {id === 'open' && locationId && (
                <Button
                  variant="primary"
                  loading={openQueue.isPending}
                  onClick={() => openQueue.mutate({ locationId }, { onSuccess: ok, onError: fail })}
                >
                  {t('queue.setup.open.cta')}
                </Button>
              )}

              {id === 'qr' && (
                <div className="flex flex-col gap-4">
                  {qrLink && organization ? (
                    <>
                      <QueueQrPoster organizationName={organization.name} link={qrLink} />
                      <Button variant="primary" onClick={() => window.print()}>
                        {t('queue.qr.print')}
                      </Button>
                    </>
                  ) : (
                    <SkeletonRow className="px-0" />
                  )}
                  <Link
                    to="/dashboard/queue"
                    className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-[var(--fu-border-strong)] px-4 text-fu-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
                  >
                    {t('queue.setup.goToQueue')}
                  </Link>
                </div>
              )}

              {stepError && activeStep === id && id !== 'qr' && (
                <p role="alert" className="text-fu-sm text-[var(--fu-text-primary)]">
                  {stepError}
                </p>
              )}
            </div>
          )}
        </section>
      ))}

    </main>
  )
}
