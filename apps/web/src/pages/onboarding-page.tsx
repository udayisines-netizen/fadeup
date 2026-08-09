import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { TextField } from '@/components/ui/text-field'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { useAuth } from '@/lib/auth-context'
import { getSupabaseClient } from '@/lib/supabase'
import { SLUG_PATTERN, slugify } from '@/lib/slug'
import { setStoredOrganizationId } from '@/lib/current-organization'

const onboardingSchema = z.object({
  shopName: z.string().min(1, 'Shop name is required'),
  slug: z
    .string()
    .min(1, 'URL slug is required')
    .regex(SLUG_PATTERN, 'Use lowercase letters, numbers and single hyphens only, e.g. "fade-up-barbers"'),
  locationName: z.string().min(1, 'Location name is required'),
  timezone: z.string().min(1, 'Timezone is required'),
})

type OnboardingFormValues = z.infer<typeof onboardingSchema>

interface OnboardingResult {
  organization_id: string
  organization_name: string
  organization_slug: string
  location_id: string
  location_name: string
}

function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function OnboardingPage() {
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
  } = useForm<OnboardingFormValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: { timezone: defaultTimezone() },
  })

  const mutation = useMutation({
    mutationFn: async (values: OnboardingFormValues): Promise<OnboardingResult> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('complete_organization_onboarding', {
        p_org_name: values.shopName,
        p_org_slug: values.slug,
        p_location_name: values.locationName,
        p_timezone: values.timezone,
      })

      if (error) throw error

      const row = (Array.isArray(data) ? data[0] : data) as OnboardingResult
      return row
    },
    onSuccess: (result) => {
      setStoredOrganizationId(result.organization_id)
      void queryClient.invalidateQueries({ queryKey: ['memberships', 'mine', user?.id] })
      navigate('/app', { replace: true })
    },
    onError: (error: Error) => {
      // Postgres unique_violation on organizations.slug — the DB is the
      // source of truth for slug uniqueness; surface it against the field.
      if (error.message.toLowerCase().includes('slug')) {
        setError('slug', { message: 'That URL is already taken — try another.' })
        return
      }
      setFormError(error.message)
    },
  })

  function handleShopNameBlur() {
    if (slugTouched) return
    const currentSlug = getValues('slug')
    if (currentSlug) return
    const name = getValues('shopName')
    if (name) setValue('slug', slugify(name), { shouldValidate: true })
  }

  function onSubmit(values: OnboardingFormValues) {
    setFormError(null)
    mutation.mutate(values)
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold text-neutral-900">Set up your shop</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Create your organization and its first location to get started.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 flex flex-col gap-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <TextField
            label="Shop name"
            error={errors.shopName?.message}
            {...register('shopName', { onBlur: handleShopNameBlur })}
          />

          <TextField
            label="URL slug"
            hint="Used in your booking link. Lowercase letters, numbers and hyphens only."
            error={errors.slug?.message}
            {...register('slug', {
              onChange: () => setSlugTouched(true),
            })}
          />

          <TextField
            label="First location name"
            hint='e.g. "Downtown" or your shop name if you only have one location.'
            error={errors.locationName?.message}
            {...register('locationName')}
          />

          <TextField label="Timezone" error={errors.timezone?.message} {...register('timezone')} />

          <Button type="submit" isLoading={isSubmitting || mutation.isPending} className="w-full">
            Create shop
          </Button>
        </form>
      </div>
    </main>
  )
}
