import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Check, CircleAlert } from 'lucide-react'
import { TextField } from '@/components/ui/text-field'
import { Textarea } from '@/components/ui/textarea'
import { SelectField } from '@/components/ui/select-field'
import { Switch } from '@/components/ui/switch'
import { Button, buttonVariants } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageSpinner } from '@/components/ui/spinner'
import { ErrorState } from '@/components/ui/error-state'
import { useAuth } from '@/lib/auth-context'
import { useResolvedOrganization, type MembershipWithOrganization } from '@/lib/queries/memberships'
import { useMyAccess } from '@/lib/queries/access'
import { getSupabaseClient } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/get-error-message'
import { SLUG_PATTERN, slugify } from '@/lib/slug'
import { setStoredOrganizationId } from '@/lib/current-organization'
import { guessTimezone } from '@/lib/timezone'
import { cn } from '@/lib/cn'
import { useOrgLocations, useUpdateLocation, type Location } from '@/lib/queries/locations'
import { useOrgServices } from '@/lib/queries/services'
import { useAssignBarberServices } from '@/lib/queries/barber-services'
import {
  useApplyStarterServices,
  useApplyWeeklyHours,
  useCompleteOnboarding,
  useEnsureOwnerProfessional,
  useLocaleSuggestions,
  useOrganizationReadiness,
  useSaveBusinessProfile,
  readinessKey,
  type BusinessType,
  type OrganizationReadiness,
  type WeeklyDay,
} from '@/lib/queries/onboarding'
import {
  COMMON_COUNTRIES,
  COMMON_CURRENCIES,
  DEFAULT_WEEK,
  templateFor,
  type ServiceTemplate,
} from '@/lib/onboarding/templates'
import { countryLabel, weekdayLabels } from '@/lib/onboarding/intl-labels'

/**
 * /onboarding — the adaptive setup that turns an approved organization into a
 * business a customer can actually book.
 *
 * Why this replaced a four-field form: the audit found 4 organizations on the
 * live database with 0 services, 0 opening hours and 0 working hours between
 * them. The old form collected a name, a slug, a location name and a
 * timezone, and then dropped the owner on a placeholder home page. Everything
 * a booking needs had to be assembled by hand across four admin screens, with
 * nothing saying what was still missing. Nobody ever finished.
 *
 * TWO PRINCIPLES HOLD THIS TOGETHER
 *
 * 1. Progress is DERIVED, never stored in the browser. Every step reads
 *    get_organization_readiness(), which inspects persisted rows. A step
 *    whose save silently failed shows as incomplete rather than ticked, and a
 *    business someone configured entirely through the ordinary admin screens
 *    is correctly recognised as already done. `?step=` in the URL is a
 *    cursor, not a record of completion.
 *
 * 2. Every step is idempotent server-side. Closing the tab at step 6 and
 *    replaying steps 1-6 tomorrow produces one set of services and one
 *    professional, not two.
 *
 * It works identically whether the session came from a password, from Google
 * or from Apple: authorization is the owner/manager membership, which no
 * provider can affect.
 */

export const STEPS = [
  'type',
  'identity',
  'location',
  'locale',
  'services',
  'professional',
  'hours',
  'pro-hours',
  'profile',
  'review',
] as const

export type Step = (typeof STEPS)[number]

/** Step id -> `onboarding` translation key for its short navigation label. */
const STEP_LABEL_KEYS: Record<Step, string> = {
  type: 'steps.type',
  identity: 'steps.identity',
  location: 'steps.location',
  locale: 'steps.locale',
  services: 'steps.services',
  professional: 'steps.professional',
  hours: 'steps.hours',
  'pro-hours': 'steps.proHours',
  profile: 'steps.profile',
  review: 'steps.review',
}

/**
 * The five business shapes, in display order. Only the ENUM VALUE lives here;
 * the label and hint are looked up per locale. That keeps the enum — which is
 * a database contract — separate from the copy, which is not.
 */
const BUSINESS_TYPE_ORDER: BusinessType[] = [
  'solo_professional',
  'barbershop',
  'hair_salon',
  'mixed_salon',
  'multi_location',
]

/**
 * The first unfinished step, derived purely from persisted readiness.
 *
 * Exported for tests: this and isStepComplete ARE the resume behaviour, and
 * they are cheap to test directly and expensive to test through the page.
 */
export function firstIncompleteStep(readiness: OrganizationReadiness): Step {
  if (!readiness.hasBusinessType) return 'type'
  if (!readiness.hasLocation) return 'location'
  if (!readiness.hasLocationAddress) return 'location'
  if (!readiness.hasCurrency) return 'locale'
  if (!readiness.hasService) return 'services'
  if (!readiness.hasProfessional) return 'professional'
  if (!readiness.hasLocationHours) return 'hours'
  if (!readiness.hasProfessionalHours) return 'pro-hours'
  if (!readiness.hasPublicProfile) return 'profile'
  return 'review'
}

export function isStepComplete(step: Step, readiness: OrganizationReadiness): boolean {
  switch (step) {
    case 'type': return readiness.hasBusinessType
    case 'identity': return true // the organization always has a name
    case 'location': return readiness.hasLocation && readiness.hasLocationAddress
    case 'locale': return readiness.hasCurrency && readiness.hasTimezone
    case 'services': return readiness.hasService && readiness.hasServiceAtLocation
    // A professional existing is what this step is FOR. Service assignment is
    // a separate fact, required for READY_TO_BOOK and reported by readiness on
    // the review step — requiring it here left the step permanently unticked
    // even after the professional had persisted correctly.
    case 'professional': return readiness.hasProfessional
    case 'hours': return readiness.hasLocationHours
    case 'pro-hours': return readiness.hasProfessionalHours
    case 'profile': return readiness.hasPublicProfile
    case 'review': return readiness.readyToBook
  }
}

/**
 * Resolves WHICH organization is being set up, and whether this account has
 * any business to set up at all.
 *
 * Deliberately does NOT use useCurrentOrg. CurrentOrgProvider is mounted by
 * AppLayout — that is, inside the finished professional workspace — and
 * /onboarding is a sibling route, not a child of it. Depending on it here
 * crashed the route outright, and it was the wrong dependency anyway:
 * onboarding must be able to work out which shop it is configuring BEFORE a
 * workspace exists to select one from.
 *
 * The order is: authoritative access (get_my_access) -> membership resolution
 * -> readiness -> wizard.
 */
export function OnboardingPage() {
  const { t } = useTranslation('onboarding')
  const { user, loading: authLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const accessQuery = useMyAccess(user?.id)

  // `?org=` is honoured ONLY when it names an organization this user actually
  // belongs to — useResolvedOrganization checks it against the RLS-scoped
  // membership list and silently falls back otherwise. It exists so a
  // multi-organization owner can link straight to the one they want to
  // finish, not as a way to address an organization by id.
  const { membershipsQuery, memberships, organizationId, membership } = useResolvedOrganization(
    user?.id,
    searchParams.get('org'),
  )

  if (authLoading || membershipsQuery.isPending || accessQuery.isPending) {
    return <PageSpinner label={t('shell.loading')} />
  }

  if (membershipsQuery.isError) {
    return (
      <Container size="sm" className="py-16">
        <ErrorState title={t('shell.orgsErrorTitle')} description={membershipsQuery.error.message} />
      </Container>
    )
  }

  if (!organizationId || !membership) {
    // No business to configure. Where this account belongs instead is a
    // question the authoritative resolver already answers, so route rather
    // than guess — and never crash.
    const access = accessQuery.data

    // An outstanding or refused application outranks everything: the database
    // would refuse create_organization anyway (LOT A), so offering the create
    // form here would be an empty promise.
    if (access?.applicationStatus && access.applicationStatus !== 'approved') {
      return <Navigate to="/pro/application" replace />
    }

    // An account that signed up as a customer did not come here to open a
    // shop. /workspace re-resolves properly — platform role, memberships,
    // signup intent — instead of this page inventing an answer.
    if (access?.signupIntent === 'customer') {
      return <Navigate to="/workspace" replace />
    }

    // Everyone else: the legitimate self-serve path. create_organization
    // still enforces the application gate server-side regardless of what
    // this form shows.
    return <CreateOrganizationStep />
  }

  // Only an owner or manager can configure a business. A barber or
  // receptionist who lands here belongs in the workspace, not the wizard —
  // and every onboarding RPC re-checks the same thing server-side.
  if (membership.role !== 'owner' && membership.role !== 'manager') {
    return <Navigate to="/app" replace />
  }

  return <OnboardingWizard organizationId={organizationId} membership={membership} memberships={memberships} />
}

// ---------------------------------------------------------------------------
// Step 0 — create the organization (self-serve only)
// ---------------------------------------------------------------------------

/** Built inside the component so validation messages follow the active locale. */
function buildCreateSchema(t: (key: string) => string) {
  return z.object({
    shopName: z.string().trim().min(1, t('create.errors.nameRequired')),
    slug: z
      .string()
      .trim()
      .min(1, t('create.errors.slugRequired'))
      .regex(SLUG_PATTERN, t('create.errors.slugFormat')),
    locationName: z.string().trim().min(1, t('create.errors.locationRequired')),
    timezone: z.string().trim().min(1, t('create.errors.timezoneRequired')),
  })
}

type CreateFormValues = z.infer<ReturnType<typeof buildCreateSchema>>

interface CreateResult {
  organization_id: string
}

function CreateOrganizationStep() {
  const { t } = useTranslation('onboarding')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [formError, setFormError] = useState<string | null>(null)
  const [slugTouched, setSlugTouched] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateFormValues>({
    resolver: zodResolver(buildCreateSchema(t)),
    defaultValues: { timezone: guessTimezone() },
  })

  const mutation = useMutation({
    mutationFn: async (values: CreateFormValues): Promise<CreateResult> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('complete_organization_onboarding', {
        p_org_name: values.shopName,
        p_org_slug: values.slug,
        p_location_name: values.locationName,
        p_timezone: values.timezone,
      })
      if (error) throw error
      return (Array.isArray(data) ? data[0] : data) as CreateResult
    },
    onSuccess: (result) => {
      setStoredOrganizationId(result.organization_id)
      void queryClient.invalidateQueries({ queryKey: ['memberships', 'mine', user?.id] })
      // Stay on /onboarding — creating the organization is the beginning of
      // setup, not the end of it. The old flow navigated to /app here, which
      // is precisely how shops ended up with no services and no hours.
      navigate('/onboarding?step=type', { replace: true })
    },
    onError: (error: Error) => {
      if (error.message.toLowerCase().includes('slug')) {
        setError('slug', { message: t('create.slugTaken') })
        return
      }
      setFormError(getErrorMessage(error) ?? t('errors.generic'))
    },
  })

  function handleShopNameBlur() {
    if (slugTouched) return
    if (getValues('slug')) return
    const name = getValues('shopName')
    if (name) setValue('slug', slugify(name), { shouldValidate: true })
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-paper-50 py-12">
      <Container size="sm">
        <Card elevated className="p-6 sm:p-8">
          <h1 className="text-xl font-semibold text-ink-950">{t('create.title')}</h1>
          <p className="mt-1 text-sm text-ink-500">{t('create.description')}</p>

          <form
            onSubmit={handleSubmit((values) => {
              setFormError(null)
              mutation.mutate(values)
            })}
            noValidate
            className="mt-6 flex flex-col gap-4"
          >
            {formError ? <Alert variant="error">{formError}</Alert> : null}

            <TextField
              label={t('create.nameLabel')}
              autoComplete="organization"
              error={errors.shopName?.message}
              {...register('shopName', { onBlur: handleShopNameBlur })}
            />
            <TextField
              label={t('create.slugLabel')}
              hint={t('create.slugHint')}
              autoComplete="off"
              spellCheck={false}
              error={errors.slug?.message}
              {...register('slug', { onChange: () => setSlugTouched(true) })}
            />
            <TextField
              label={t('create.locationLabel')}
              hint={t('create.locationHint')}
              error={errors.locationName?.message}
              {...register('locationName')}
            />
            <TextField label={t('create.timezoneLabel')} error={errors.timezone?.message} {...register('timezone')} />

            <Button type="submit" isLoading={isSubmitting || mutation.isPending} className="w-full">
              {t('actions.continue')}
            </Button>
          </form>
        </Card>
      </Container>
    </main>
  )
}

// ---------------------------------------------------------------------------
// The wizard
// ---------------------------------------------------------------------------

function OnboardingWizard({
  organizationId,
  membership,
  memberships,
}: {
  organizationId: string
  membership: MembershipWithOrganization
  memberships: MembershipWithOrganization[]
}) {
  const { t } = useTranslation('onboarding')
  const [searchParams, setSearchParams] = useSearchParams()
  const readinessQuery = useOrganizationReadiness(organizationId)
  const locationsQuery = useOrgLocations(organizationId)

  const readiness = readinessQuery.data ?? null
  const requestedStep = searchParams.get('step') as Step | null
  const step: Step | null =
    requestedStep && STEPS.includes(requestedStep) ? requestedStep : readiness ? firstIncompleteStep(readiness) : null

  function goTo(next: Step) {
    const params = new URLSearchParams(searchParams)
    params.set('step', next)
    setSearchParams(params, { replace: false })
    // jsdom has no scrollTo, and a step change must not fail because of it.
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      try {
        window.scrollTo({ top: 0 })
      } catch {
        // Purely cosmetic — never worth breaking navigation over.
      }
    }
  }

  function goToNext() {
    if (!step) return
    const index = STEPS.indexOf(step)
    goTo(STEPS[Math.min(index + 1, STEPS.length - 1)])
  }

  /**
   * Switching which organization is being set up. The id goes in the URL so
   * the choice is shareable and survives a refresh, and into localStorage so
   * the rest of the app agrees — but it is validated against the membership
   * list on every read, so neither store is authority. `step` is dropped
   * because the new organization's own readiness decides where to resume.
   */
  function switchOrganization(nextOrganizationId: string) {
    setStoredOrganizationId(nextOrganizationId)
    const params = new URLSearchParams(searchParams)
    params.set('org', nextOrganizationId)
    params.delete('step')
    setSearchParams(params, { replace: true })
  }

  if (readinessQuery.isPending || locationsQuery.isPending) {
    return <PageSpinner label={t('shell.loading')} />
  }

  if (readinessQuery.isError) {
    return (
      <Container size="sm" className="py-16">
        <ErrorState title={t('shell.loadErrorTitle')} description={readinessQuery.error.message} />
      </Container>
    )
  }

  if (!readiness || !step) {
    return (
      <Container size="sm" className="py-16">
        <ErrorState title={t('shell.loadErrorTitle')} description={t('shell.loadErrorEmpty')} />
      </Container>
    )
  }

  const location = locationsQuery.data?.[0] ?? null

  return (
    <main className="min-h-svh bg-paper-50 py-8 sm:py-12">
      <Container size="md">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-ink-950">
            {t('shell.titleNamed', { name: membership.organizationName })}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {readiness.readyToBook ? t('shell.subtitleReady') : t('shell.subtitleIncomplete')}
          </p>

          {/*
            Belonging to more than one organization is normal — a barber who
            staffs one shop and owns another, a group with several entities.
            Naming the one being configured, and letting them switch, is what
            stops setup silently editing the wrong business. Selection is a
            preference in the URL and localStorage; the membership list from
            the database is what validates it.
          */}
          {memberships.length > 1 ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink-500">{t('shell.switching')}</span>
              {memberships.map((candidate) => {
                const isCurrent = candidate.organizationId === organizationId
                return (
                  <button
                    key={candidate.organizationId}
                    type="button"
                    aria-pressed={isCurrent}
                    onClick={() => switchOrganization(candidate.organizationId)}
                    className={cn(
                      'inline-flex min-h-11 items-center rounded-full border px-3 text-sm transition-colors',
                      isCurrent
                        ? 'border-ink-950 bg-ink-950 text-on-accent'
                        : 'border-border text-ink-700 hover:bg-paper-100',
                    )}
                  >
                    {candidate.organizationName}
                  </button>
                )
              })}
            </div>
          ) : null}
        </header>

        <StepNav step={step} readiness={readiness} onSelect={goTo} />

        <Card elevated className="mt-6 p-6 sm:p-8">
          {step === 'type' ? <TypeStep organizationId={organizationId} readiness={readiness} onDone={goToNext} /> : null}
          {step === 'identity' ? <IdentityStep organizationId={organizationId} membership={membership} onDone={goToNext} /> : null}
          {step === 'location' ? <LocationStep organizationId={organizationId} location={location} onDone={goToNext} /> : null}
          {step === 'locale' ? <LocaleStep organizationId={organizationId} location={location} onDone={goToNext} /> : null}
          {step === 'services' ? <ServicesStep organizationId={organizationId} location={location} readiness={readiness} onDone={goToNext} /> : null}
          {step === 'professional' ? (
            <ProfessionalStep
              organizationId={organizationId}
              location={location}
              membership={membership}
              onDone={goToNext}
            />
          ) : null}
          {step === 'hours' ? <HoursStep organizationId={organizationId} location={location} onDone={goToNext} /> : null}
          {step === 'pro-hours' ? <ProHoursStep organizationId={organizationId} location={location} onDone={goToNext} /> : null}
          {step === 'profile' ? <ProfileStep organizationId={organizationId} location={location} onDone={goToNext} /> : null}
          {step === 'review' ? <ReviewStep organizationId={organizationId} readiness={readiness} onSelect={goTo} /> : null}
        </Card>
      </Container>
    </main>
  )
}

function StepNav({
  step,
  readiness,
  onSelect,
}: {
  step: Step
  readiness: OrganizationReadiness
  onSelect: (step: Step) => void
}) {
  const { t } = useTranslation('onboarding')
  const completed = STEPS.filter((candidate) => isStepComplete(candidate, readiness)).length

  return (
    <nav aria-label={t('shell.stepsLabel')}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">
        {t('shell.progress', { done: completed, total: STEPS.length })}
      </p>
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((candidate) => {
          const done = isStepComplete(candidate, readiness)
          const current = candidate === step
          return (
            <li key={candidate}>
              <button
                type="button"
                onClick={() => onSelect(candidate)}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
                  current
                    ? 'border-ink-950 bg-ink-950 text-on-accent'
                    : done
                      ? 'border-success-100 bg-success-100/50 text-success-700 hover:border-success-700'
                      : 'border-border text-ink-700 hover:bg-paper-100',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                {t(STEP_LABEL_KEYS[candidate])}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** Shared step chrome: heading, explanation, and the error surface. */
function StepShell({
  title,
  description,
  error,
  children,
}: {
  title: string
  description: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-ink-950">{title}</h2>
      <p className="mt-1 text-sm text-ink-500">{description}</p>
      {error ? (
        <div className="mt-4">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}
      <div className="mt-6">{children}</div>
    </div>
  )
}

// --- step: business type ---------------------------------------------------

function TypeStep({
  organizationId,
  readiness,
  onDone,
}: {
  organizationId: string
  readiness: OrganizationReadiness
  onDone: () => void
}) {
  const { t } = useTranslation('onboarding')
  const save = useSaveBusinessProfile(organizationId)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<BusinessType | null>(null)

  async function choose(businessType: BusinessType) {
    setError(null)
    setSelected(businessType)
    try {
      await save.mutateAsync({ organizationId, businessType })
      onDone()
    } catch (cause) {
      setSelected(null)
      setError(getErrorMessage(cause) ?? t('errors.generic'))
    }
  }

  return (
    <StepShell title={t('type.title')} description={t('type.description')} error={error}>
      <div className="flex flex-col gap-3">
        {BUSINESS_TYPE_ORDER.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => choose(value)}
            disabled={save.isPending}
            aria-pressed={selected === value}
            className={cn(
              'rounded-lg border p-4 text-start transition-colors disabled:cursor-wait',
              selected === value ? 'border-ink-950 bg-paper-100' : 'border-border hover:border-border-strong',
            )}
          >
            <span className="block font-medium text-ink-950">{t(`type.options.${value}.label`)}</span>
            <span className="mt-0.5 block text-sm text-ink-500">{t(`type.options.${value}.hint`)}</span>
          </button>
        ))}
      </div>
      {readiness.hasBusinessType ? (
        <div className="mt-6">
          <Button variant="secondary" onClick={onDone}>
            {t('actions.keepExisting')}
          </Button>
        </div>
      ) : null}
    </StepShell>
  )
}

// --- step: business identity -----------------------------------------------

function IdentityStep({
  organizationId,
  membership,
  onDone,
}: {
  organizationId: string
  membership: MembershipWithOrganization
  onDone: () => void
}) {
  const { t } = useTranslation('onboarding')
  const save = useSaveBusinessProfile(organizationId)
  const [name, setName] = useState(membership.organizationName)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError(t('identity.nameRequired'))
      return
    }
    try {
      await save.mutateAsync({ organizationId, name: name.trim() })
      onDone()
    } catch (cause) {
      setError(getErrorMessage(cause) ?? t('errors.generic'))
    }
  }

  return (
    <StepShell title={t('identity.title')} description={t('identity.description')} error={error}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('identity.nameLabel')}
          autoComplete="organization"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="flex gap-3">
          <Button type="submit" isLoading={save.isPending}>
            {t('actions.saveContinue')}
          </Button>
        </div>
      </form>
    </StepShell>
  )
}

// --- step: location / address ----------------------------------------------

function LocationStep({
  organizationId,
  location,
  onDone,
}: {
  organizationId: string
  location: Location | null
  onDone: () => void
}) {
  const { t } = useTranslation('onboarding')
  const updateLocation = useUpdateLocation()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: location?.name ?? '',
    addressLine1: location?.addressLine1 ?? '',
    addressLine2: location?.addressLine2 ?? '',
    city: location?.city ?? '',
    postalCode: location?.postalCode ?? '',
  })

  if (!location) {
    return (
      <StepShell title={t('location.missingTitle')} description={t('location.missingDescription')}>
        <Alert variant="error">{t('location.missingBody')}</Alert>
        <Link to="/app/locations" className={buttonVariants({ variant: 'secondary' }, 'mt-4')}>
          {t('location.missingCta')}
        </Link>
      </StepShell>
    )
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!form.addressLine1.trim() || !form.city.trim()) {
      setError(t('location.required'))
      return
    }
    try {
      await updateLocation.mutateAsync({
        id: location!.id,
        organizationId,
        name: form.name.trim() || location!.name,
        addressLine1: form.addressLine1.trim() || null,
        addressLine2: form.addressLine2.trim() || null,
        city: form.city.trim() || null,
        region: location!.region,
        postalCode: form.postalCode.trim() || null,
        country: location!.country,
        timezone: location!.timezone,
        isActive: true,
      })
      onDone()
    } catch (cause) {
      setError(getErrorMessage(cause) ?? t('errors.generic'))
    }
  }

  return (
    <StepShell title={t('location.title')} description={t('location.description')} error={error}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('location.nameLabel')}
          hint={t('location.nameHint')}
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <TextField
          label={t('location.line1Label')}
          autoComplete="address-line1"
          value={form.addressLine1}
          onChange={(event) => setForm({ ...form, addressLine1: event.target.value })}
        />
        <TextField
          label={t('location.line2Label')}
          hint={t('location.line2Hint')}
          autoComplete="address-line2"
          value={form.addressLine2}
          onChange={(event) => setForm({ ...form, addressLine2: event.target.value })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('location.cityLabel')}
            autoComplete="address-level2"
            value={form.city}
            onChange={(event) => setForm({ ...form, city: event.target.value })}
          />
          <TextField
            label={t('location.postalLabel')}
            autoComplete="postal-code"
            value={form.postalCode}
            onChange={(event) => setForm({ ...form, postalCode: event.target.value })}
          />
        </div>
        <Button type="submit" isLoading={updateLocation.isPending} className="self-start">
          {t('actions.saveContinue')}
        </Button>
      </form>
    </StepShell>
  )
}

// --- step: country / currency / timezone -----------------------------------

function LocaleStep({
  organizationId,
  location,
  onDone,
}: {
  organizationId: string
  location: Location | null
  onDone: () => void
}) {
  const { t, i18n } = useTranslation('onboarding')
  const save = useSaveBusinessProfile(organizationId)
  const updateLocation = useUpdateLocation()
  const [error, setError] = useState<string | null>(null)
  const [countryCode, setCountryCode] = useState(location?.country ?? 'FR')
  const [currency, setCurrency] = useState<string>('')
  const [timezone, setTimezone] = useState(location?.timezone ?? guessTimezone())
  const [currencyTouched, setCurrencyTouched] = useState(false)
  const [timezoneTouched, setTimezoneTouched] = useState(false)

  const suggestions = useLocaleSuggestions(countryCode)

  // Suggestions fill the fields, and stop the moment the user edits them —
  // an explicit choice must always beat an automatic one.
  useEffect(() => {
    if (!suggestions.data) return
    if (!currencyTouched && suggestions.data.currency) setCurrency(suggestions.data.currency)
    if (!timezoneTouched && suggestions.data.timezone) setTimezone(suggestions.data.timezone)
  }, [suggestions.data, currencyTouched, timezoneTouched])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!/^[A-Z]{3}$/.test(currency.toUpperCase())) {
      setError(t('locale.currencyRequired'))
      return
    }
    try {
      await save.mutateAsync({ organizationId, currency: currency.toUpperCase(), countryCode })
      if (location) {
        await updateLocation.mutateAsync({
          id: location.id,
          organizationId,
          name: location.name,
          addressLine1: location.addressLine1,
          addressLine2: location.addressLine2,
          city: location.city,
          region: location.region,
          postalCode: location.postalCode,
          country: countryCode,
          timezone: timezone.trim() || location.timezone,
          isActive: true,
        })
      }
      onDone()
    } catch (cause) {
      setError(getErrorMessage(cause) ?? t('errors.generic'))
    }
  }

  return (
    <StepShell title={t('locale.title')} description={t('locale.description')} error={error}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('locale.countryLabel')}
          value={countryCode}
          onChange={(event) => setCountryCode(event.target.value)}
          // Country names come from Intl in the reader's own language rather
          // than from a hand-maintained list in ten locales.
          options={COMMON_COUNTRIES.map((country) => ({
            value: country.code,
            label: countryLabel(i18n.language, country.code),
          }))}
        />
        <SelectField
          label={t('locale.currencyLabel')}
          value={currency}
          onChange={(event) => {
            setCurrencyTouched(true)
            setCurrency(event.target.value)
          }}
          options={[
            { value: '', label: t('locale.currencyPlaceholder') },
            ...COMMON_CURRENCIES.map((code) => ({ value: code, label: code })),
          ]}
        />
        <p className="-mt-2 text-sm text-ink-500">{t('locale.currencyHint')}</p>
        <TextField
          label={t('locale.timezoneLabel')}
          hint={t('locale.timezoneHint')}
          value={timezone}
          onChange={(event) => {
            setTimezoneTouched(true)
            setTimezone(event.target.value)
          }}
        />
        <Button
          type="submit"
          isLoading={save.isPending || updateLocation.isPending}
          className="self-start"
        >
          {t('actions.saveContinue')}
        </Button>
      </form>
    </StepShell>
  )
}

// --- step: starter services -------------------------------------------------

function ServicesStep({
  organizationId,
  location,
  readiness,
  onDone,
}: {
  organizationId: string
  location: Location | null
  readiness: OrganizationReadiness
  onDone: () => void
}) {
  const { t } = useTranslation('onboarding')
  const apply = useApplyStarterServices(organizationId)
  const [error, setError] = useState<string | null>(null)
  const template = useMemo(() => templateFor(readiness.businessType), [readiness.businessType])
  // The template supplies an id and the numbers; the NAME is resolved per
  // locale here and then persisted, so a German salon starts with German
  // service names in its live price list rather than French ones.
  const [rows, setRows] = useState<(ServiceTemplate & { name: string; selected: boolean })[]>(() =>
    template.map((service) => ({
      ...service,
      name: t(`services.templates.${service.id}`),
      selected: service.recommended,
    })),
  )

  function update(index: number, patch: Partial<ServiceTemplate & { name: string; selected: boolean }>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!location) {
      setError(t('errors.noLocation'))
      return
    }
    const chosen = rows.filter((row) => row.selected)
    if (chosen.length === 0) {
      setError(t('services.pickOne'))
      return
    }
    try {
      await apply.mutateAsync({
        organizationId,
        locationId: location.id,
        services: chosen.map((row) => ({
          name: row.name.trim(),
          durationMinutes: row.durationMinutes,
          priceCents: row.priceCents,
        })),
      })
      onDone()
    } catch (cause) {
      setError(getErrorMessage(cause) ?? t('services.saveError'))
    }
  }

  return (
    <StepShell title={t('services.title')} description={t('services.description')} error={error}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <ul className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <li key={`${row.id}-${index}`} className="rounded-lg border border-border p-3">
              <Switch
                label={row.name}
                checked={row.selected}
                onChange={(event) => update(index, { selected: event.target.checked })}
              />
              {row.selected ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <TextField
                    label={t('services.nameLabel')}
                    value={row.name}
                    onChange={(event) => update(index, { name: event.target.value })}
                  />
                  <TextField
                    label={t('services.minutesLabel')}
                    type="number"
                    inputMode="numeric"
                    value={String(row.durationMinutes)}
                    onChange={(event) => update(index, { durationMinutes: Number(event.target.value) || 0 })}
                  />
                  <TextField
                    label={t('services.priceLabel')}
                    type="number"
                    inputMode="decimal"
                    hint={t('services.priceHint')}
                    value={String(row.priceCents / 100)}
                    onChange={(event) =>
                      update(index, { priceCents: Math.round((Number(event.target.value) || 0) * 100) })
                    }
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <Button type="submit" isLoading={apply.isPending} className="self-start">
          {t('actions.saveContinue')}
        </Button>
      </form>
    </StepShell>
  )
}

// --- step: professional -----------------------------------------------------

function ProfessionalStep({
  organizationId,
  location,
  membership,
  onDone,
}: {
  organizationId: string
  location: Location | null
  membership: MembershipWithOrganization
  onDone: () => void
}) {
  const { t } = useTranslation('onboarding')
  const ensure = useEnsureOwnerProfessional(organizationId)
  const assignServices = useAssignBarberServices()
  const servicesQuery = useOrgServices(organizationId)
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [title, setTitle] = useState('')

  async function takeClients(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!location) {
      setError(t('errors.noLocation'))
      return
    }
    if (!displayName.trim()) {
      setError(t('professional.nameRequired'))
      return
    }
    try {
      const barberId = await ensure.mutateAsync({
        organizationId,
        locationId: location.id,
        displayName: displayName.trim(),
        title: title.trim() || null,
      })
      // Link the catalog from the services step to this professional. Without
      // it a bookable professional performs nothing and no slot can ever be
      // computed. This previously passed an EMPTY array, so it linked nothing
      // at all — which is why the step never completed.
      //
      // Idempotent (see useAssignBarberServices), so a resumed or retried run
      // adds no duplicates. An empty catalog is fine: the professional still
      // persists, this step still completes, and readiness keeps reporting the
      // missing service on the review step.
      const serviceIds = (servicesQuery.data ?? []).filter((service) => service.isActive).map((service) => service.id)
      await assignServices.mutateAsync({ organizationId, barberId, serviceIds })

      // ensure_owner_professional already invalidates readiness, but it does
      // so BEFORE the service links exist — so that refetch can land with
      // has_service_for_professional still false. Re-invalidate once both
      // writes are done and await it, so the step this navigates to is
      // rendering the truth rather than a snapshot taken mid-write.
      await queryClient.invalidateQueries({ queryKey: readinessKey(organizationId) })
      onDone()
    } catch (cause) {
      setError(getErrorMessage(cause) ?? t('errors.generic'))
    }
  }

  const canInvite = membership.role === 'owner' || membership.role === 'manager'

  return (
    <StepShell title={t('professional.title')} description={t('professional.description')} error={error}>
      <form onSubmit={takeClients} className="flex flex-col gap-4">
        <TextField
          label={t('professional.nameLabel')}
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <TextField
          label={t('professional.titleLabel')}
          hint={t('professional.titleHint')}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button type="submit" isLoading={ensure.isPending || assignServices.isPending} className="self-start">
          {t('professional.submit')}
        </Button>
      </form>

      {canInvite ? (
        <div className="mt-6 rounded-lg border border-border bg-paper-50 p-4">
          <p className="text-sm font-medium text-ink-950">{t('professional.teamTitle')}</p>
          <p className="mt-1 text-sm text-ink-500">{t('professional.teamBody')}</p>
          <Link to="/app/team" className={buttonVariants({ variant: 'secondary', size: 'sm' }, 'mt-3')}>
            {t('professional.teamCta')}
          </Link>
        </div>
      ) : null}
    </StepShell>
  )
}

// --- steps: hours -----------------------------------------------------------

function WeekEditor({ days, onChange }: { days: WeeklyDay[]; onChange: (days: WeeklyDay[]) => void }) {
  const { t, i18n } = useTranslation('onboarding')
  // Weekday names come from Intl in the reader's language, correctly cased
  // per locale, rather than from a hand-maintained list in ten files.
  const dayNames = useMemo(() => weekdayLabels(i18n.language), [i18n.language])

  function update(dayOfWeek: number, patch: Partial<WeeklyDay>) {
    onChange(days.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day)))
  }

  return (
    <ul className="flex flex-col gap-2">
      {days.map((day) => (
        <li key={day.dayOfWeek} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-24 font-medium text-ink-950">{dayNames[day.dayOfWeek]}</span>
            <Switch
              label={day.isClosed ? t('hours.closed') : t('hours.open')}
              checked={!day.isClosed}
              onChange={(event) => update(day.dayOfWeek, { isClosed: !event.target.checked })}
            />
          </div>
          {!day.isClosed ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <TextField
                label={t('hours.opensLabel')}
                type="time"
                value={day.openTime ?? '09:00'}
                onChange={(event) => update(day.dayOfWeek, { openTime: event.target.value })}
              />
              <TextField
                label={t('hours.closesLabel')}
                type="time"
                value={day.closeTime ?? '19:00'}
                onChange={(event) => update(day.dayOfWeek, { closeTime: event.target.value })}
              />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function HoursStep({
  organizationId,
  location,
  onDone,
}: {
  organizationId: string
  location: Location | null
  onDone: () => void
}) {
  const { t } = useTranslation('onboarding')
  const apply = useApplyWeeklyHours(organizationId)
  const [days, setDays] = useState<WeeklyDay[]>(DEFAULT_WEEK)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!location) {
      setError(t('errors.noLocation'))
      return
    }
    if (days.every((day) => day.isClosed)) {
      setError(t('hours.allClosed'))
      return
    }
    try {
      await apply.mutateAsync({ organizationId, locationId: location.id, days })
      onDone()
    } catch (cause) {
      setError(getErrorMessage(cause) ?? t('hours.saveError'))
    }
  }

  return (
    <StepShell title={t('hours.title')} description={t('hours.description')} error={error}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <WeekEditor days={days} onChange={setDays} />
        <Alert variant="info">{t('hours.oneWindowNote')}</Alert>
        <Button type="submit" isLoading={apply.isPending} className="self-start">
          {t('actions.saveContinue')}
        </Button>
      </form>
    </StepShell>
  )
}

function ProHoursStep({
  organizationId,
  location,
  onDone,
}: {
  organizationId: string
  location: Location | null
  onDone: () => void
}) {
  const { t } = useTranslation('onboarding')
  const ensure = useEnsureOwnerProfessional(organizationId)
  const apply = useApplyWeeklyHours(organizationId)
  const [days, setDays] = useState<WeeklyDay[]>(DEFAULT_WEEK)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!location) {
      setError(t('errors.noLocation'))
      return
    }
    try {
      // Resolve the caller's own professional record rather than asking them
      // to pick one: idempotent, and it is the record the previous step made.
      const barberId = await ensure.mutateAsync({ organizationId, locationId: location.id })
      await apply.mutateAsync({ organizationId, barberId, days })
      onDone()
    } catch (cause) {
      setError(getErrorMessage(cause) ?? t('hours.saveError'))
    }
  }

  return (
    <StepShell title={t('proHours.title')} description={t('proHours.description')} error={error}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <WeekEditor days={days} onChange={setDays} />
        <Button type="submit" isLoading={ensure.isPending || apply.isPending} className="self-start">
          {t('actions.saveContinue')}
        </Button>
      </form>
    </StepShell>
  )
}

// --- step: public profile ---------------------------------------------------

function ProfileStep({
  organizationId,
  location,
  onDone,
}: {
  organizationId: string
  location: Location | null
  onDone: () => void
}) {
  const { t } = useTranslation('onboarding')
  const ensure = useEnsureOwnerProfessional(organizationId)
  const [displayName, setDisplayName] = useState('')
  const [title, setTitle] = useState('')
  const [bio, setBio] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!location) {
      setError(t('errors.noLocation'))
      return
    }
    try {
      await ensure.mutateAsync({
        organizationId,
        locationId: location.id,
        displayName: displayName.trim() || null,
        title: title.trim() || null,
        bio: bio.trim() || null,
      })
      onDone()
    } catch (cause) {
      setError(getErrorMessage(cause) ?? t('errors.generic'))
    }
  }

  return (
    <StepShell title={t('profile.title')} description={t('profile.description')} error={error}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('profile.displayNameLabel')}
          hint={t('profile.displayNameHint')}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <TextField
          label={t('profile.titleLabel')}
          hint={t('profile.titleHint')}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Textarea
          label={t('profile.aboutLabel')}
          hint={t('profile.aboutHint')}
          rows={4}
          value={bio}
          onChange={(event) => setBio(event.target.value)}
        />
        <Alert variant="info">{t('profile.photosNote')}</Alert>
        <Button type="submit" isLoading={ensure.isPending} className="self-start">
          {t('actions.saveContinue')}
        </Button>
      </form>
    </StepShell>
  )
}

// --- step: review + publish -------------------------------------------------

/**
 * Which step fixes each missing requirement. The LABEL is looked up per
 * locale from `review.requirements.*`; only the routing lives here, because
 * the requirement ids are a database contract (get_organization_readiness)
 * and the copy is not.
 */
const REQUIREMENT_STEPS: Record<string, Step> = {
  business_type: 'type',
  currency: 'locale',
  location: 'location',
  location_address: 'location',
  timezone: 'locale',
  professional: 'professional',
  service: 'services',
  service_at_location: 'services',
  service_for_professional: 'professional',
  location_hours: 'hours',
  professional_hours: 'pro-hours',
  public_profile: 'profile',
}

function ReviewStep({
  organizationId,
  readiness,
  onSelect,
}: {
  organizationId: string
  readiness: OrganizationReadiness
  onSelect: (step: Step) => void
}) {
  const { t } = useTranslation('onboarding')
  const complete = useCompleteOnboarding(organizationId)
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  async function finish(publish: boolean) {
    setError(null)
    try {
      const result = await complete.mutateAsync({ organizationId, publish })
      if (result.readyToBook) {
        navigate('/app', { replace: true })
        return
      }
      setError(t('review.stillMissing'))
    } catch (cause) {
      setError(getErrorMessage(cause) ?? t('review.finishError'))
    }
  }

  return (
    <StepShell
      title={readiness.readyToBook ? t('review.titleReady') : t('review.titleAlmost')}
      description={readiness.readyToBook ? t('review.descriptionReady') : t('review.descriptionAlmost')}
      error={error}
    >
      {readiness.missingRequirements.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {readiness.missingRequirements.map((requirement) => (
            <li key={requirement}>
              <button
                type="button"
                onClick={() => onSelect(REQUIREMENT_STEPS[requirement] ?? 'type')}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-warning-100 bg-warning-100/40 px-3 text-start text-sm text-ink-950 hover:border-warning-700"
              >
                <CircleAlert className="h-4 w-4 shrink-0 text-warning-700" aria-hidden="true" />
                {t(`review.requirements.${requirement}`, { defaultValue: requirement })}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Alert variant="success">{t('review.complete')}</Alert>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          onClick={() => finish(true)}
          isLoading={complete.isPending}
          disabled={!readiness.readyToPublish}
        >
          {readiness.isPublished ? t('review.finish') : t('review.publish')}
        </Button>
        <Button variant="secondary" onClick={() => finish(false)} disabled={!readiness.readyToBook}>
          {t('review.finishWithoutPublishing')}
        </Button>
      </div>

      {!readiness.readyToPublish && readiness.readyToBook ? (
        <p className="mt-3 text-sm text-ink-500">{t('review.bookableNotPublished')}</p>
      ) : null}
    </StepShell>
  )
}
