import { Link, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Heart, IdCard, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { getSupabaseClient } from '@/lib/supabase'
import { useMyCustomerProfile, useUpsertMyCustomerProfile } from '@/lib/queries/customer-profile'
import { CountryPreferenceField } from '@/components/customer/country-preference-field'
import { PageHeader } from '@/components/ui/page-header'
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

/**
 * `/app/customer/profile` — editable identity, a summary of the onboarding
 * "habits", the way through to Fade Passport and Favorites, and sign out.
 *
 * Both of those live here rather than in the tab bar on purpose. They are
 * places you go occasionally, and the phone's primary navigation has five
 * slots — one of which R5 spent on BOOK, which is the thing the product is
 * actually for. An identity card and a saved list are exactly what a profile
 * screen is meant to hold.
 */
export function CustomerProfilePage() {
  const { t } = useTranslation('customer-app')
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const profileQuery = useMyCustomerProfile(user?.id)
  const upsert = useUpsertMyCustomerProfile()

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
    return <PageSpinner label={t('common:state.loadingEllipsis')} />
  }

  if (profileQuery.isError) {
    return (
      <ErrorState
        title={t('customer-app:profile.couldntLoadYourProfile')}
        description={profileQuery.error.message}
        action={
          <Button variant="secondary" onClick={() => void profileQuery.refetch()}>
            {t('common:action.tryAgain')}
          </Button>
        }
      />
    )
  }

  async function onSubmit(values: ProfileFormValues) {
    await upsert.mutateAsync({
      userId: user!.id,
      displayName: values.displayName || null,
      phone: values.phone || null,
      email: values.email || null,
    })
    // Note: saving contact details here deliberately does NOT retroactively
    // attach past shop records to this account. Typing an address into a
    // form is not proof of owning it — that assumption was the takeover
    // vector removed in 20260813150000_appointment_ownership_hardening.sql.
    // Past anonymous bookings attach via their one-time claim token instead.
    toast.toast({ variant: 'success', title: t('profile.saved') })
    reset(values)
  }

  async function handleSignOut() {
    const supabase = getSupabaseClient()
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  const profile = profileQuery.data
  const hasHabits = Boolean(profile?.haircutFrequency || profile?.stylePreference || profile?.appointmentPreference)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('profile.title')} />

      <section className="rounded-xl border border-border bg-paper-0 p-5">
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <TextField label={t('profile.nameLabel')} autoComplete="name" {...register('displayName')} />
          <TextField label={t('profile.phoneLabel')} type="tel" autoComplete="tel" {...register('phone')} />
          <TextField label={t('profile.emailLabel')} type="email" autoComplete="email" {...register('email')} />
          <Button type="submit" isLoading={upsert.isPending} disabled={!isDirty} className="self-start">
            {t('profile.save')}
          </Button>
        </form>
      </section>

      {/*
        §31: language already persisted an explicit choice; country did not.
        The marketplace's "Search everywhere" chip can turn the filter off, but
        once it is gone nothing on that screen mentions countries — so the way
        BACK lives here, beside the other preferences.
      */}
      <section className="rounded-xl border border-border bg-paper-0 p-5">
        <CountryPreferenceField />
      </section>

      <section className="rounded-xl border border-border bg-paper-0 p-5">
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
      </section>

      {/*
        FADE PASSPORT LIVES HERE NOW (§18).

        It held a fifth of the phone's primary navigation as a top-level tab,
        which is a lot of permanent screen for an identity artefact people look
        at occasionally. Profile is where an identity card belongs, and it sits
        ABOVE Favorites because the passport is who you are and favourites are
        a list you keep.

        The route did not move — /app/customer/passport still resolves, so
        every existing link, share and bookmark keeps working.
      */}
      <ProfileRow to="/app/customer/passport" icon={IdCard} label={t('passport:title')} />
      <ProfileRow to="/app/customer/favorites" icon={Heart} label={t('favorites.title')} />

      <button
        type="button"
        onClick={() => void handleSignOut()}
        className={buttonVariants({ variant: 'secondary' }, 'self-start')}
      >
        {t('profile.signOut')}
      </button>
    </div>
  )
}

/**
 * One navigable row inside Profile.
 *
 * Extracted the moment there were two of them: Passport and Favorites are the
 * same object with a different label, and two hand-written copies of a
 * fourteen-class row is how the second one ends up 4px shorter than the first.
 */
function ProfileRow({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-[--fu-control-lg] items-center gap-3 rounded-xl border border-border bg-paper-0 p-4 text-sm font-medium text-ink-950 hover:bg-paper-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
    >
      <Icon className="h-4 w-4 text-accent-600" aria-hidden="true" />
      {label}
      {/* A literal "→" points the wrong way in Arabic. */}
      <ChevronRight className="ms-auto h-4 w-4 text-ink-300 rtl:hidden" aria-hidden="true" />
      <ChevronLeft className="ms-auto hidden h-4 w-4 text-ink-300 rtl:block" aria-hidden="true" />
    </Link>
  )
}
