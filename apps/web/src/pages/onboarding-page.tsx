import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { useCurrentOrg } from '@/lib/current-org-context'
import { getSupabaseClient } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/get-error-message'
import { SLUG_PATTERN, slugify } from '@/lib/slug'
import { setStoredOrganizationId } from '@/lib/current-organization'
import { guessTimezone } from '@/lib/timezone'
import { cn } from '@/lib/cn'
import { useOrgLocations, useUpdateLocation, type Location } from '@/lib/queries/locations'
import {
  useApplyStarterServices,
  useApplyWeeklyHours,
  useCompleteOnboarding,
  useEnsureOwnerProfessional,
  useLocaleSuggestions,
  useOrganizationReadiness,
  useSaveBusinessProfile,
  type BusinessType,
  type OrganizationReadiness,
  type WeeklyDay,
} from '@/lib/queries/onboarding'
import {
  COMMON_COUNTRIES,
  COMMON_CURRENCIES,
  DAY_LABELS,
  DEFAULT_WEEK,
  templateFor,
  type ServiceTemplate,
} from '@/lib/onboarding/templates'

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

const STEP_LABELS: Record<Step, string> = {
  type: 'Business type',
  identity: 'Business name',
  location: 'Address',
  locale: 'Country & currency',
  services: 'Services',
  professional: 'Professionals',
  hours: 'Opening hours',
  'pro-hours': 'Working hours',
  profile: 'Public profile',
  review: 'Review & publish',
}

const BUSINESS_TYPE_OPTIONS: { value: BusinessType; label: string; hint: string }[] = [
  { value: 'solo_professional', label: 'Solo professional', hint: 'You work on your own — barber, stylist, colorist, braider.' },
  { value: 'barbershop', label: 'Barbershop', hint: 'A shop with a team of barbers.' },
  { value: 'hair_salon', label: 'Hair salon', hint: 'A salon focused on cutting, colour and styling.' },
  { value: 'mixed_salon', label: 'Mixed salon', hint: 'Barbering and salon services under one roof.' },
  { value: 'multi_location', label: 'Multi-location', hint: 'Several addresses under one organization.' },
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
    case 'professional': return readiness.hasProfessional && readiness.hasServiceForProfessional
    case 'hours': return readiness.hasLocationHours
    case 'pro-hours': return readiness.hasProfessionalHours
    case 'profile': return readiness.hasPublicProfile
    case 'review': return readiness.readyToBook
  }
}

export function OnboardingPage() {
  const { currentMembership, membershipsQuery } = useCurrentOrg()
  const organizationId = currentMembership?.organizationId

  if (membershipsQuery.isPending) return <PageSpinner label="Loading your workspace" />

  // No organization at all: this is the self-serve path, and the only thing
  // that can happen first is creating one.
  if (!organizationId) return <CreateOrganizationStep />

  return <OnboardingWizard organizationId={organizationId} />
}

// ---------------------------------------------------------------------------
// Step 0 — create the organization (self-serve only)
// ---------------------------------------------------------------------------

const createSchema = z.object({
  shopName: z.string().trim().min(1, 'Business name is required'),
  slug: z
    .string()
    .trim()
    .min(1, 'URL is required')
    .regex(SLUG_PATTERN, 'Use lowercase letters, numbers and single hyphens only, e.g. "le-fade-parisien"'),
  locationName: z.string().trim().min(1, 'Location name is required'),
  timezone: z.string().trim().min(1, 'Timezone is required'),
})

type CreateFormValues = z.infer<typeof createSchema>

interface CreateResult {
  organization_id: string
}

function CreateOrganizationStep() {
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
    resolver: zodResolver(createSchema),
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
        setError('slug', { message: 'That URL is already taken — try another.' })
        return
      }
      setFormError(getErrorMessage(error) ?? 'Something went wrong.')
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
          <h1 className="text-xl font-semibold text-ink-950">Set up your business</h1>
          <p className="mt-1 text-sm text-ink-500">
            Create your organization and its first location. We&apos;ll walk through the rest — services, hours and
            your public page — straight afterwards.
          </p>

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
              label="Business name"
              autoComplete="organization"
              error={errors.shopName?.message}
              {...register('shopName', { onBlur: handleShopNameBlur })}
            />
            <TextField
              label="Booking link"
              hint="Used in your public booking URL. Lowercase letters, numbers and hyphens only."
              autoComplete="off"
              spellCheck={false}
              error={errors.slug?.message}
              {...register('slug', { onChange: () => setSlugTouched(true) })}
            />
            <TextField
              label="First location name"
              hint='e.g. "Bastille" — or your business name if you only have one address.'
              error={errors.locationName?.message}
              {...register('locationName')}
            />
            <TextField label="Timezone" error={errors.timezone?.message} {...register('timezone')} />

            <Button type="submit" isLoading={isSubmitting || mutation.isPending} className="w-full">
              Continue
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

function OnboardingWizard({ organizationId }: { organizationId: string }) {
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
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
  }

  function goToNext() {
    if (!step) return
    const index = STEPS.indexOf(step)
    goTo(STEPS[Math.min(index + 1, STEPS.length - 1)])
  }

  if (readinessQuery.isPending || locationsQuery.isPending) {
    return <PageSpinner label="Loading your setup" />
  }

  if (readinessQuery.isError) {
    return (
      <Container size="sm" className="py-16">
        <ErrorState title="Couldn't load your setup" description={readinessQuery.error.message} />
      </Container>
    )
  }

  if (!readiness || !step) {
    return (
      <Container size="sm" className="py-16">
        <ErrorState title="Couldn't load your setup" description="No readiness information came back." />
      </Container>
    )
  }

  const location = locationsQuery.data?.[0] ?? null

  return (
    <main className="min-h-svh bg-paper-50 py-8 sm:py-12">
      <Container size="md">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-ink-950">Set up your business</h1>
          <p className="mt-1 text-sm text-ink-500">
            {readiness.readyToBook
              ? 'Everything a customer needs is in place. Review and publish when you like.'
              : 'A few steps and customers can book you. You can leave and come back — nothing is lost.'}
          </p>
        </header>

        <StepNav step={step} readiness={readiness} onSelect={goTo} />

        <Card elevated className="mt-6 p-6 sm:p-8">
          {step === 'type' ? <TypeStep organizationId={organizationId} readiness={readiness} onDone={goToNext} /> : null}
          {step === 'identity' ? <IdentityStep organizationId={organizationId} onDone={goToNext} /> : null}
          {step === 'location' ? <LocationStep organizationId={organizationId} location={location} onDone={goToNext} /> : null}
          {step === 'locale' ? <LocaleStep organizationId={organizationId} location={location} onDone={goToNext} /> : null}
          {step === 'services' ? <ServicesStep organizationId={organizationId} location={location} readiness={readiness} onDone={goToNext} /> : null}
          {step === 'professional' ? <ProfessionalStep organizationId={organizationId} location={location} onDone={goToNext} /> : null}
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
  const completed = STEPS.filter((candidate) => isStepComplete(candidate, readiness)).length

  return (
    <nav aria-label="Setup steps">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">
        {completed} of {STEPS.length} done
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
                {STEP_LABELS[candidate]}
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
      setError(getErrorMessage(cause) ?? 'Could not save that.')
    }
  }

  return (
    <StepShell
      title="What kind of business do you run?"
      description="This shapes the rest of setup — which services we suggest, and whether we ask about a team. You can change it later."
      error={error}
    >
      <div className="flex flex-col gap-3">
        {BUSINESS_TYPE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => choose(option.value)}
            disabled={save.isPending}
            aria-pressed={selected === option.value}
            className={cn(
              'rounded-lg border p-4 text-left transition-colors disabled:cursor-wait',
              selected === option.value ? 'border-ink-950 bg-paper-100' : 'border-border hover:border-border-strong',
            )}
          >
            <span className="block font-medium text-ink-950">{option.label}</span>
            <span className="mt-0.5 block text-sm text-ink-500">{option.hint}</span>
          </button>
        ))}
      </div>
      {readiness.hasBusinessType ? (
        <div className="mt-6">
          <Button variant="secondary" onClick={onDone}>
            Keep what I have
          </Button>
        </div>
      ) : null}
    </StepShell>
  )
}

// --- step: business identity -----------------------------------------------

function IdentityStep({ organizationId, onDone }: { organizationId: string; onDone: () => void }) {
  const { currentMembership } = useCurrentOrg()
  const save = useSaveBusinessProfile(organizationId)
  const [name, setName] = useState(currentMembership?.organizationName ?? '')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError('A business name is required.')
      return
    }
    try {
      await save.mutateAsync({ organizationId, name: name.trim() })
      onDone()
    } catch (cause) {
      setError(getErrorMessage(cause) ?? 'Could not save that.')
    }
  }

  return (
    <StepShell
      title="How should customers see your name?"
      description="This is the name on your public page and in search results."
      error={error}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Business name"
          autoComplete="organization"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="flex gap-3">
          <Button type="submit" isLoading={save.isPending}>
            Save and continue
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
      <StepShell title="Your first address" description="Something went wrong — your organization has no location yet.">
        <Alert variant="error">
          No location exists for this business. Create one in Locations, then come back to finish setup.
        </Alert>
        <Link to="/app/locations" className={buttonVariants({ variant: 'secondary' }, 'mt-4')}>
          Go to Locations
        </Link>
      </StepShell>
    )
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!form.addressLine1.trim() || !form.city.trim()) {
      setError('A street address and city are required — customers search by city.')
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
      setError(getErrorMessage(cause) ?? 'Could not save that.')
    }
  }

  return (
    <StepShell
      title="Where do you work?"
      description="Customers search by city, so this is what makes you findable. It appears on your public page."
      error={error}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Location name"
          hint='What you call this address internally, e.g. "Bastille".'
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <TextField
          label="Street address"
          autoComplete="address-line1"
          value={form.addressLine1}
          onChange={(event) => setForm({ ...form, addressLine1: event.target.value })}
        />
        <TextField
          label="Address line 2"
          hint="Optional."
          autoComplete="address-line2"
          value={form.addressLine2}
          onChange={(event) => setForm({ ...form, addressLine2: event.target.value })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="City"
            autoComplete="address-level2"
            value={form.city}
            onChange={(event) => setForm({ ...form, city: event.target.value })}
          />
          <TextField
            label="Postal code"
            autoComplete="postal-code"
            value={form.postalCode}
            onChange={(event) => setForm({ ...form, postalCode: event.target.value })}
          />
        </div>
        <Button type="submit" isLoading={updateLocation.isPending} className="self-start">
          Save and continue
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
      setError('Choose a currency — every price you set is quoted in it.')
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
      setError(getErrorMessage(cause) ?? 'Could not save that.')
    }
  }

  return (
    <StepShell
      title="Country, currency and timezone"
      description="The timezone decides what time a slot actually means, so it matters more than it looks. The currency is what every price you set is quoted in."
      error={error}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label="Country"
          value={countryCode}
          onChange={(event) => setCountryCode(event.target.value)}
          options={COMMON_COUNTRIES.map((country) => ({ value: country.code, label: country.label }))}
        />
        <SelectField
          label="Currency"
          value={currency}
          onChange={(event) => {
            setCurrencyTouched(true)
            setCurrency(event.target.value)
          }}
          options={[
            { value: '', label: 'Choose a currency' },
            ...COMMON_CURRENCIES.map((code) => ({ value: code, label: code })),
          ]}
        />
        <p className="-mt-2 text-sm text-ink-500">
          Suggested from your country. Change it if that isn&apos;t right — every price you set is quoted in it.
        </p>
        <TextField
          label="Timezone"
          hint="An IANA name, e.g. Europe/Paris."
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
          Save and continue
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
  const apply = useApplyStarterServices(organizationId)
  const [error, setError] = useState<string | null>(null)
  const template = useMemo(() => templateFor(readiness.businessType), [readiness.businessType])
  const [rows, setRows] = useState<(ServiceTemplate & { selected: boolean })[]>(() =>
    template.map((service) => ({ ...service, selected: service.recommended })),
  )

  function update(index: number, patch: Partial<ServiceTemplate & { selected: boolean }>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!location) {
      setError('Add an address first — services are offered at a location.')
      return
    }
    const chosen = rows.filter((row) => row.selected)
    if (chosen.length === 0) {
      setError('Pick at least one service. You can add more, and edit all of them, later.')
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
      setError(getErrorMessage(cause) ?? 'Could not save those services.')
    }
  }

  return (
    <StepShell
      title="What do you offer?"
      description="A starting point, not a final list. Rename anything, change the prices and durations, and add your own — all of it stays editable in Services afterwards."
      error={error}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <ul className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <li key={`${row.name}-${index}`} className="rounded-lg border border-border p-3">
              <Switch
                label={row.name}
                checked={row.selected}
                onChange={(event) => update(index, { selected: event.target.checked })}
              />
              {row.selected ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <TextField
                    label="Name"
                    value={row.name}
                    onChange={(event) => update(index, { name: event.target.value })}
                  />
                  <TextField
                    label="Minutes"
                    type="number"
                    inputMode="numeric"
                    value={String(row.durationMinutes)}
                    onChange={(event) => update(index, { durationMinutes: Number(event.target.value) || 0 })}
                  />
                  <TextField
                    label="Price"
                    type="number"
                    inputMode="decimal"
                    hint="In whole units of your currency."
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
          Save and continue
        </Button>
      </form>
    </StepShell>
  )
}

// --- step: professional -----------------------------------------------------

function ProfessionalStep({
  organizationId,
  location,
  onDone,
}: {
  organizationId: string
  location: Location | null
  onDone: () => void
}) {
  const { currentMembership } = useCurrentOrg()
  const ensure = useEnsureOwnerProfessional(organizationId)
  const applyServices = useApplyStarterServices(organizationId)
  const [error, setError] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [title, setTitle] = useState('')

  async function takeClients(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!location) {
      setError('Add an address first — a professional works at a location.')
      return
    }
    if (!displayName.trim()) {
      setError('A name is required — this is what customers see.')
      return
    }
    try {
      const barberId = await ensure.mutateAsync({
        organizationId,
        locationId: location.id,
        displayName: displayName.trim(),
        title: title.trim() || null,
      })
      // Link the services created in the previous step to this professional.
      // Without it a bookable professional offers nothing and no slot can be
      // computed — readiness would (correctly) still say "not ready", which
      // is confusing right after ticking this box. Idempotent, so a resumed
      // run is harmless.
      await applyServices.mutateAsync({
        organizationId,
        locationId: location.id,
        services: [],
        barberId,
      })
      onDone()
    } catch (cause) {
      setError(getErrorMessage(cause) ?? 'Could not save that.')
    }
  }

  const canInvite = currentMembership?.role === 'owner' || currentMembership?.role === 'manager'

  return (
    <StepShell
      title="Who takes clients?"
      description="At least one bookable professional is needed before anyone can book. If you work yourself, that is you."
      error={error}
    >
      <form onSubmit={takeClients} className="flex flex-col gap-4">
        <TextField
          label="Your name as customers see it"
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <TextField
          label="Title"
          hint='Optional — e.g. "Barber", "Coloriste", "Loctician".'
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button type="submit" isLoading={ensure.isPending || applyServices.isPending} className="self-start">
          I take clients — continue
        </Button>
      </form>

      {canInvite ? (
        <div className="mt-6 rounded-lg border border-border bg-paper-50 p-4">
          <p className="text-sm font-medium text-ink-950">Working with a team?</p>
          <p className="mt-1 text-sm text-ink-500">
            Invite them from the Team screen whenever you like — you do not need them here to finish setup.
          </p>
          <Link to="/app/team" className={buttonVariants({ variant: 'secondary', size: 'sm' }, 'mt-3')}>
            Go to Team
          </Link>
        </div>
      ) : null}
    </StepShell>
  )
}

// --- steps: hours -----------------------------------------------------------

function WeekEditor({ days, onChange }: { days: WeeklyDay[]; onChange: (days: WeeklyDay[]) => void }) {
  function update(dayOfWeek: number, patch: Partial<WeeklyDay>) {
    onChange(days.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day)))
  }

  return (
    <ul className="flex flex-col gap-2">
      {days.map((day) => (
        <li key={day.dayOfWeek} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-24 font-medium text-ink-950">{DAY_LABELS[day.dayOfWeek]}</span>
            <Switch
              label={day.isClosed ? 'Closed' : 'Open'}
              checked={!day.isClosed}
              onChange={(event) => update(day.dayOfWeek, { isClosed: !event.target.checked })}
            />
          </div>
          {!day.isClosed ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <TextField
                label="Opens"
                type="time"
                value={day.openTime ?? '09:00'}
                onChange={(event) => update(day.dayOfWeek, { openTime: event.target.value })}
              />
              <TextField
                label="Closes"
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
  const apply = useApplyWeeklyHours(organizationId)
  const [days, setDays] = useState<WeeklyDay[]>(DEFAULT_WEEK)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!location) {
      setError('Add an address first.')
      return
    }
    if (days.every((day) => day.isClosed)) {
      setError('At least one day needs to be open.')
      return
    }
    try {
      await apply.mutateAsync({ organizationId, locationId: location.id, days })
      onDone()
    } catch (cause) {
      setError(getErrorMessage(cause) ?? 'Could not save those hours.')
    }
  }

  return (
    <StepShell
      title="When are you open?"
      description="Your shop's opening hours. A professional's own hours are set next, and a customer can only book where the two overlap."
      error={error}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <WeekEditor days={days} onChange={setDays} />
        <Alert variant="info">
          One opening window per day for now. A midday closure needs a second window, which is a change we have not made
          yet — set the full span here and block the break in Availability.
        </Alert>
        <Button type="submit" isLoading={apply.isPending} className="self-start">
          Save and continue
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
  const ensure = useEnsureOwnerProfessional(organizationId)
  const apply = useApplyWeeklyHours(organizationId)
  const [days, setDays] = useState<WeeklyDay[]>(DEFAULT_WEEK)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!location) {
      setError('Add an address first.')
      return
    }
    try {
      // Resolve the caller's own professional record rather than asking them
      // to pick one: idempotent, and it is the record the previous step made.
      const barberId = await ensure.mutateAsync({ organizationId, locationId: location.id })
      await apply.mutateAsync({ organizationId, barberId, days })
      onDone()
    } catch (cause) {
      setError(getErrorMessage(cause) ?? 'Could not save those hours.')
    }
  }

  return (
    <StepShell
      title="When do you work?"
      description="Your own hours, which can be narrower than the shop's. Slots appear only where your hours and the shop's overlap."
      error={error}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <WeekEditor days={days} onChange={setDays} />
        <Button type="submit" isLoading={ensure.isPending || apply.isPending} className="self-start">
          Save and continue
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
  const ensure = useEnsureOwnerProfessional(organizationId)
  const [displayName, setDisplayName] = useState('')
  const [title, setTitle] = useState('')
  const [bio, setBio] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!location) {
      setError('Add an address first.')
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
      setError(getErrorMessage(cause) ?? 'Could not save that.')
    }
  }

  return (
    <StepShell
      title="Your public page"
      description="What a customer reads before booking. Short is fine — you can rewrite it any time."
      error={error}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Display name"
          hint="Leave blank to keep what you already have."
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <TextField
          label="Title"
          hint='Optional — e.g. "Barber", "Coloriste".'
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Textarea
          label="About"
          hint="Optional. A couple of sentences about how you work."
          rows={4}
          value={bio}
          onChange={(event) => setBio(event.target.value)}
        />
        <Alert variant="info">
          Photos come later — FadeUp has no image storage for shop or portfolio pictures yet, so we are not pretending
          to ask for them.
        </Alert>
        <Button type="submit" isLoading={ensure.isPending} className="self-start">
          Save and continue
        </Button>
      </form>
    </StepShell>
  )
}

// --- step: review + publish -------------------------------------------------

const REQUIREMENT_LABELS: Record<string, { label: string; step: Step }> = {
  business_type: { label: 'Choose a business type', step: 'type' },
  currency: { label: 'Choose a currency', step: 'locale' },
  location: { label: 'Add a location', step: 'location' },
  location_address: { label: 'Add a street address and city', step: 'location' },
  timezone: { label: 'Set a timezone', step: 'locale' },
  professional: { label: 'Add a bookable professional', step: 'professional' },
  service: { label: 'Add at least one service', step: 'services' },
  service_at_location: { label: 'Offer a service at your location', step: 'services' },
  service_for_professional: { label: 'Let a professional perform a service', step: 'professional' },
  location_hours: { label: 'Set your opening hours', step: 'hours' },
  professional_hours: { label: 'Set your working hours', step: 'pro-hours' },
  public_profile: { label: 'Complete your public profile', step: 'profile' },
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
      setError('Still a few things missing — see the list below.')
    } catch (cause) {
      setError(getErrorMessage(cause) ?? 'Could not finish setup.')
    }
  }

  return (
    <StepShell
      title={readiness.readyToBook ? 'You can be booked' : 'Almost there'}
      description={
        readiness.readyToBook
          ? 'Everything a booking needs is in place. Publishing also lists you in marketplace search.'
          : 'These are the pieces still missing. Each one links to the step that fixes it.'
      }
      error={error}
    >
      {readiness.missingRequirements.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {readiness.missingRequirements.map((requirement) => {
            const entry = REQUIREMENT_LABELS[requirement]
            return (
              <li key={requirement}>
                <button
                  type="button"
                  onClick={() => onSelect(entry?.step ?? 'type')}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-warning-100 bg-warning-100/40 px-3 text-left text-sm text-ink-950 hover:border-warning-700"
                >
                  <CircleAlert className="h-4 w-4 shrink-0 text-warning-700" aria-hidden="true" />
                  {entry?.label ?? requirement}
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <Alert variant="success">Your setup is complete.</Alert>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          onClick={() => finish(true)}
          isLoading={complete.isPending}
          disabled={!readiness.readyToPublish}
        >
          {readiness.isPublished ? 'Finish' : 'Publish and finish'}
        </Button>
        <Button variant="secondary" onClick={() => finish(false)} disabled={!readiness.readyToBook}>
          Finish without publishing
        </Button>
      </div>

      {!readiness.readyToPublish && readiness.readyToBook ? (
        <p className="mt-3 text-sm text-ink-500">
          You can take bookings from your own link now. Publishing to marketplace search needs the remaining items
          above.
        </p>
      ) : null}
    </StepShell>
  )
}
