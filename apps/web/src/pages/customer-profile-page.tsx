import { Link, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth-context'
import { getSupabaseClient } from '@/lib/supabase'
import { useMyCustomerProfile, useUpsertMyCustomerProfile, useClaimCustomerRecords } from '@/lib/queries/customer-profile'
import { Container } from '@/components/ui/container'
import { Card } from '@/components/ui/card'
import { Button, buttonVariants } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { Badge } from '@/components/ui/badge'
import { ErrorState } from '@/components/ui/error-state'
import { PageSpinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'

const profileSchema = z.object({
  displayName: z.string().trim(),
  phone: z.string().trim(),
  email: z.string().trim(),
})

type ProfileFormValues = z.infer<typeof profileSchema>

/** /app/customer/profile — the customer's own editable identity + a summary of their onboarding "habits," plus sign out. */
export function CustomerProfilePage() {
  const { t } = useTranslation('customer-app')
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const profileQuery = useMyCustomerProfile(user?.id)
  const upsert = useUpsertMyCustomerProfile()
  const claimRecords = useClaimCustomerRecords()

  const {
    register,
    handleSubmit,
    reset,
    formState: { isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: '', phone: '', email: '' },
  })

  useEffect(() => {
    if (profileQuery.data) {
      reset({
        displayName: profileQuery.data.displayName ?? '',
        phone: profileQuery.data.phone ?? '',
        email: profileQuery.data.email ?? '',
      })
    }
  }, [profileQuery.data, reset])

  if (!user) return null

  if (profileQuery.isPending) {
    return <PageSpinner label="Loading…" />
  }

  if (profileQuery.isError) {
    return (
      <Container size="sm" className="py-10">
        <ErrorState
          title="Couldn't load your profile"
          description={profileQuery.error.message}
          action={
            <Button variant="secondary" onClick={() => void profileQuery.refetch()}>
              Try again
            </Button>
          }
        />
      </Container>
    )
  }

  async function onSubmit(values: ProfileFormValues) {
    await upsert.mutateAsync({
      userId: user!.id,
      displayName: values.displayName || null,
      phone: values.phone || null,
      email: values.email || null,
    })
    // Best-effort: retroactively link any past bookings made with this
    // contact info before the customer had an account. Never blocks the
    // profile save itself on failure.
    if (values.phone || values.email) {
      claimRecords.mutate({ phone: values.phone || null, email: values.email || null })
    }
    toast.toast({ variant: 'success', title: t('profile.saved') })
    reset(values)
  }

  async function handleSignOut() {
    const supabase = getSupabaseClient()
    await supabase.auth.signOut()
    navigate('/customer/login', { replace: true })
  }

  const profile = profileQuery.data
  const hasHabits = Boolean(profile?.haircutFrequency || profile?.stylePreference || profile?.appointmentPreference)

  return (
    <Container size="sm" className="flex flex-col gap-6 py-6">
      <h1 className="text-2xl font-semibold text-ink-950">{t('profile.title')}</h1>

      <Card className="p-5">
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <TextField label={t('profile.nameLabel')} autoComplete="name" {...register('displayName')} />
          <TextField label={t('profile.phoneLabel')} type="tel" autoComplete="tel" {...register('phone')} />
          <TextField label={t('profile.emailLabel')} type="email" autoComplete="email" {...register('email')} />
          <Button type="submit" isLoading={upsert.isPending} disabled={!isDirty} className="self-start">
            {t('profile.save')}
          </Button>
        </form>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-950">{t('profile.habitsTitle')}</h2>
          <Link to="/app/customer/onboarding" className="text-sm font-medium text-accent-700 hover:text-accent-800">
            {t('profile.editHabits')}
          </Link>
        </div>
        {hasHabits ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {profile?.haircutFrequency ? <Badge variant="accent">{t(`onboarding.frequency.${profile.haircutFrequency}`)}</Badge> : null}
            {profile?.stylePreference ? <Badge variant="accent">{t(`onboarding.style.${profile.stylePreference}`)}</Badge> : null}
            {profile?.appointmentPreference ? (
              <Badge variant="accent">{t(`onboarding.appointmentPreference.${profile.appointmentPreference}`)}</Badge>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-500">{t('profile.noHabitsYet')}</p>
        )}
      </Card>

      <Link
        to="/app/customer/favorites"
        className="flex items-center justify-between rounded-xl border border-border bg-paper-0 p-4 text-sm font-medium text-ink-950 hover:bg-paper-100"
      >
        {t('favorites.title')}
        <span aria-hidden="true">→</span>
      </Link>

      <button
        type="button"
        onClick={() => void handleSignOut()}
        className={buttonVariants({ variant: 'secondary' }, 'self-start')}
      >
        {t('profile.signOut')}
      </button>
    </Container>
  )
}
