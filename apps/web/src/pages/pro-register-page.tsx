import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Store, User, Scissors, Home, Car, ShieldCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AuthCard } from '@/components/auth/auth-card'
import { TextField } from '@/components/ui/text-field'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { getSupabaseClient } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/get-error-message'
import { cn } from '@/lib/cn'
import { parsePlanId } from '@/lib/commerce/plans'
import { useOptionalFadeUpPricing } from '@/lib/commerce/pricing-context'
import {
  PROFESSIONAL_TYPES,
  useSubmitProfessionalApplication,
  type ProfessionalType,
} from '@/lib/queries/professional-applications'

/**
 * /pro/register — a professional APPLICATION, not a professional account.
 *
 * Submitting creates an auth user (so the applicant can come back and check
 * their status) and a pending application. It grants nothing: no
 * organization, no membership, no Pro access. Only a platform reviewer, via
 * review_professional_application, turns this into a real tenant.
 *
 * Field set is deliberately short. The brief's own rule — "enough
 * information to contact and qualify the professional, without creating a
 * terrible signup experience" — means everything past name/email/password/
 * phone/business/type is optional, and the optional block is collapsed by
 * default so the form reads as six fields, not fourteen.
 */

const TYPE_ICONS: Record<ProfessionalType, LucideIcon> = {
  barbershop: Store,
  independent_barber: Scissors,
  private_studio: Home,
  mobile_barber: Car,
}

// Mirrors public.normalize_phone_number: E.164, 00-prefixed, or a national
// number of plausible length. The server normalizes and is the real
// authority — this only spares the applicant a round trip.
const PHONE_PATTERN = /^(\+[1-9]\d{6,14}|00[1-9]\d{6,14}|0?\d{6,14})$/

/**
 * Shows the plan the applicant picked on /for-business, when they picked one.
 *
 * `?plan=` is INTENT and nothing else. It pre-fills a sentence on a form; it
 * does not create a subscription, does not grant a capability, and is not read
 * by anything server-side. `parsePlanId` rejects anything that is not one of the
 * seven canonical identifiers, so an edited query string produces no banner
 * rather than an invented plan name — and even a valid one changes only what
 * this paragraph says. The application still goes to a platform reviewer, and
 * entitlement will come from the server when billing exists.
 */
function SelectedPlanNotice() {
  const { t } = useTranslation('landing')
  const [searchParams] = useSearchParams()
  const pricing = useOptionalFadeUpPricing()

  const planId = parsePlanId(searchParams.get('plan'))
  if (!planId) return null

  return (
    <div className="rounded-lg border border-border bg-paper-50 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.14em] text-ink-500">{t('business.register.planLabel')}</p>
      <p className="mt-1 text-base font-medium text-ink-950">
        {t(`business.plans.${planId}.name`)}
        {pricing?.isResolved ? (
          <span className="ms-2 font-normal text-ink-500">
            {pricing.formatPlan(planId)} · {t('business.pricing.perMonth')}
          </span>
        ) : null}
      </p>
      <p className="mt-1.5 text-sm text-ink-500">{t('business.register.planNote')}</p>
    </div>
  )
}

export function ProRegisterPage() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const submitApplication = useSubmitProfessionalApplication()
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null)
  const [showOptional, setShowOptional] = useState(false)

  const schema = z.object({
    firstName: z.string().trim().min(1, t('register.errors.firstNameRequired')),
    lastName: z.string().trim().min(1, t('register.errors.lastNameRequired')),
    email: z.string().min(1, t('register.errors.emailRequired')).email(t('register.errors.emailInvalid')),
    password: z.string().min(8, t('register.errors.passwordTooShort')),
    phone: z
      .string()
      .trim()
      .min(1, t('register.errors.phoneRequired'))
      .refine((value) => PHONE_PATTERN.test(value.replace(/[\s().-]/g, '')), t('register.errors.phoneInvalid')),
    businessName: z.string().trim().min(1, t('register.errors.businessNameRequired')),
    professionalType: z.enum(['barbershop', 'independent_barber', 'private_studio', 'mobile_barber']),
    city: z.string().trim(),
    addressLine1: z.string().trim(),
    postalCode: z.string().trim(),
    staffCount: z.string().trim(),
    website: z.string().trim(),
    instagram: z.string().trim(),
    businessIdentifier: z.string().trim(),
  })

  type FormValues = z.infer<typeof schema>

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      phone: '',
      businessName: '',
      professionalType: 'barbershop',
      city: '',
      addressLine1: '',
      postalCode: '',
      staffCount: '',
      website: '',
      instagram: '',
      businessIdentifier: '',
    },
  })

  const selectedType = watch('professionalType')

  async function onSubmit(values: FormValues) {
    setFormError(null)
    const supabase = getSupabaseClient()

    // One auth system (CLAUDE.md). signup_intent is a routing hint only —
    // the application row, not this field, is what the workflow reads.
    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        data: { full_name: `${values.firstName} ${values.lastName}`.trim(), signup_intent: 'pro' },
      },
    })

    if (error) {
      setFormError(error.message)
      return
    }

    // Email confirmation is on: no session yet, so the application cannot be
    // written (submit_professional_application requires auth.uid()). Tell the
    // applicant the truth rather than pretending the application landed.
    if (!data.session) {
      setConfirmationEmail(values.email)
      return
    }

    try {
      const staffCount = values.staffCount ? Number.parseInt(values.staffCount, 10) : null
      await submitApplication.mutateAsync({
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone,
        businessName: values.businessName,
        professionalType: values.professionalType,
        city: values.city || null,
        addressLine1: values.addressLine1 || null,
        postalCode: values.postalCode || null,
        staffCount: Number.isFinite(staffCount) ? staffCount : null,
        website: values.website || null,
        instagram: values.instagram || null,
        businessIdentifier: values.businessIdentifier || null,
      })
      navigate('/pro/application', { replace: true })
    } catch (submitError) {
      setFormError(getErrorMessage(submitError) ?? 'Something went wrong. Please try again.')
    }
  }

  if (confirmationEmail) {
    return (
      <AuthCard title={t('pro.registerTitle')} subtitle={t('pro.registerSubtitle')}>
        <Alert variant="success">
          We sent a confirmation link to <strong>{confirmationEmail}</strong>. Follow it, then log in to finish
          sending your application.
        </Alert>
        <div className="mt-6">
          <Link to="/pro/login" className="text-sm font-medium text-accent-700 underline underline-offset-2">
            {t('pro.logIn')}
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      size="lg"
      badge={t('pro.badge')}
      title={t('pro.registerTitle')}
      subtitle={t('pro.registerSubtitle')}
      footer={
        <div className="flex flex-col gap-1">
          <p>
            {t('pro.haveAccount')}{' '}
            <Link to="/pro/login" className="font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800">
              {t('pro.logIn')}
            </Link>
          </p>
          <p className="text-ink-500">
            {t('pro.switchToCustomer')}{' '}
            <Link to="/login" className="font-medium text-ink-700 underline underline-offset-2 hover:text-ink-950">
              {t('pro.switchToCustomerCta')}
            </Link>
          </p>
        </div>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
        {formError ? <Alert variant="error">{formError}</Alert> : null}

        <SelectedPlanNotice />

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
            {t('register.sectionAbout')}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('register.firstName')} autoComplete="given-name" error={errors.firstName?.message} {...register('firstName')} />
            <TextField label={t('register.lastName')} autoComplete="family-name" error={errors.lastName?.message} {...register('lastName')} />
          </div>
          <TextField
            label={t('register.email')}
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            error={errors.email?.message}
            {...register('email')}
          />
          <TextField
            label={t('register.phone')}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            hint={t('register.phoneHint')}
            error={errors.phone?.message}
            {...register('phone')}
          />
          <TextField
            label={t('register.password')}
            type="password"
            autoComplete="new-password"
            hint={t('register.passwordHint')}
            error={errors.password?.message}
            {...register('password')}
          />
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
            {t('register.sectionBusiness')}
          </legend>
          <TextField label={t('register.businessName')} autoComplete="organization" error={errors.businessName?.message} {...register('businessName')} />

          <div>
            <span className="mb-2 block text-sm font-medium text-ink-800">{t('register.professionalType')}</span>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('register.professionalType')}>
              {PROFESSIONAL_TYPES.map((type) => {
                const Icon = TYPE_ICONS[type]
                const isSelected = selectedType === type
                return (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setValue('professionalType', type, { shouldValidate: true })}
                    className={cn(
                      'flex min-h-16 items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                      isSelected
                        ? 'border-accent-600 bg-accent-100/40 ring-1 ring-accent-600'
                        : 'border-border-strong bg-paper-0 hover:border-accent-600/60',
                    )}
                  >
                    <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', isSelected ? 'text-accent-700' : 'text-ink-400')} aria-hidden="true" />
                    <span>
                      <span className="block text-sm font-medium text-ink-950">{t(`professionalType.${type}`)}</span>
                      <span className="block text-xs text-ink-500">{t(`professionalType.${type}Hint`)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('register.city')} autoComplete="address-level2" {...register('city')} />
            <TextField label={t('register.staffCount')} type="number" inputMode="numeric" min={0} {...register('staffCount')} />
          </div>

          {/*
            Everything below is optional and collapsed by default. A pro
            signup that opens with fourteen inputs reads like a permit
            application; these are useful for qualification but must never be
            the first impression.
          */}
          {showOptional ? (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-paper-50 p-4">
              <TextField label={t('register.addressLine1')} autoComplete="address-line1" {...register('addressLine1')} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label={t('register.postalCode')} autoComplete="postal-code" {...register('postalCode')} />
                <TextField label={t('register.businessIdentifier')} {...register('businessIdentifier')} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label={t('register.website')} type="url" inputMode="url" spellCheck={false} {...register('website')} />
                <TextField label={t('register.instagram')} spellCheck={false} {...register('instagram')} />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowOptional(true)}
              className="min-h-11 self-start text-sm font-medium text-accent-700 underline underline-offset-2 hover:text-accent-800"
            >
              + {t('register.optional')}
            </button>
          )}
        </fieldset>

        <div className="flex flex-col gap-3">
          <Button type="submit" size="lg" isLoading={isSubmitting || submitApplication.isPending} className="w-full">
            {t('register.submit')}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-ink-500">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {t('register.reassurance')}
          </p>
        </div>
      </form>
    </AuthCard>
  )
}

/** Exported for the customer pages so both auth contexts share one switcher treatment. */
export function AuthContextSwitch({ label, cta, to }: { label: string; cta: string; to: string }) {
  return (
    <p className="text-ink-500">
      {label}{' '}
      <Link to={to} className="font-medium text-ink-700 underline underline-offset-2 hover:text-ink-950">
        {cta}
      </Link>
    </p>
  )
}

export { User }
