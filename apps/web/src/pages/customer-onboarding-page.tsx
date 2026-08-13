import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth-context'
import {
  useMyCustomerProfile,
  useUpsertMyCustomerProfile,
  type AppointmentPreference,
  type HaircutFrequency,
  type StylePreference,
} from '@/lib/queries/customer-profile'
import { Container } from '@/components/ui/container'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ErrorState } from '@/components/ui/error-state'
import { PageSpinner } from '@/components/ui/spinner'
import { cn } from '@/lib/cn'

const FREQUENCY_OPTIONS: HaircutFrequency[] = ['weekly', 'every_2_weeks', 'every_3_weeks', 'monthly', 'less_often', 'depends']
const STYLE_OPTIONS: StylePreference[] = ['fade', 'taper', 'crop', 'buzz', 'afro', 'curly', 'long', 'beard_focus', 'other']
const APPOINTMENT_OPTIONS: AppointmentPreference[] = ['appointment', 'walk_in', 'either']

/**
 * /app/customer/onboarding — the ~3-question, skippable personalization
 * flow (spec: "Maximum target: approximately three useful personalization
 * questions"). Doubles as the "edit your habits" screen from the Profile
 * page (same component, prefilled) rather than building a second form.
 * Nothing here is collected that Wave 1 doesn't use: haircut frequency +
 * last-cut date feed the home page's freshness copy (Phase 4), style
 * preference/appointment preference feed rebooking defaults.
 */
export function CustomerOnboardingPage() {
  const { t } = useTranslation('customer-app')
  const { user } = useAuth()
  const navigate = useNavigate()
  const profileQuery = useMyCustomerProfile(user?.id)
  const upsert = useUpsertMyCustomerProfile()

  const [frequency, setFrequency] = useState<HaircutFrequency | null>(null)
  const [style, setStyle] = useState<StylePreference | null>(null)
  const [styleNotes, setStyleNotes] = useState('')
  const [appointmentPreference, setAppointmentPreference] = useState<AppointmentPreference | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (hydrated || !profileQuery.isSuccess) return
    const profile = profileQuery.data
    if (profile) {
      setFrequency(profile.haircutFrequency)
      setStyle(profile.stylePreference)
      setStyleNotes(profile.styleNotes ?? '')
      setAppointmentPreference(profile.appointmentPreference)
    }
    setHydrated(true)
  }, [hydrated, profileQuery.isSuccess, profileQuery.data])

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

  async function handleSkip() {
    await upsert.mutateAsync({ userId: user!.id, markOnboardingComplete: true })
    navigate('/app/customer', { replace: true })
  }

  async function handleSave() {
    await upsert.mutateAsync({
      userId: user!.id,
      haircutFrequency: frequency,
      stylePreference: style,
      styleNotes: styleNotes.trim() || null,
      appointmentPreference,
      markOnboardingComplete: true,
    })
    navigate('/app/customer', { replace: true })
  }

  return (
    <Container size="sm" className="flex flex-col gap-6 py-6 sm:py-10">
      <div>
        <h1 className="text-2xl font-semibold text-balance text-ink-950">{t('onboarding.title')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('onboarding.subtitle')}</p>
      </div>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-950">{t('onboarding.frequencyQuestion')}</h2>
        <ChipGroup>
          {FREQUENCY_OPTIONS.map((option) => (
            <Chip key={option} selected={frequency === option} onClick={() => setFrequency(option)}>
              {t(`onboarding.frequency.${option}`)}
            </Chip>
          ))}
        </ChipGroup>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-950">{t('onboarding.styleQuestion')}</h2>
        <ChipGroup>
          {STYLE_OPTIONS.map((option) => (
            <Chip key={option} selected={style === option} onClick={() => setStyle(option)}>
              {t(`onboarding.style.${option}`)}
            </Chip>
          ))}
        </ChipGroup>
        <Textarea
          className="mt-4"
          label={t('onboarding.styleNotesLabel')}
          placeholder={t('onboarding.styleNotesPlaceholder')}
          rows={2}
          maxLength={500}
          value={styleNotes}
          onChange={(event) => setStyleNotes(event.target.value)}
        />
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-950">{t('onboarding.appointmentQuestion')}</h2>
        <ChipGroup>
          {APPOINTMENT_OPTIONS.map((option) => (
            <Chip key={option} selected={appointmentPreference === option} onClick={() => setAppointmentPreference(option)}>
              {t(`onboarding.appointmentPreference.${option}`)}
            </Chip>
          ))}
        </ChipGroup>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => void handleSkip()}
          disabled={upsert.isPending}
          className="text-sm font-medium text-ink-500 hover:text-ink-800"
        >
          {t('onboarding.skip')}
        </button>
        <Button onClick={() => void handleSave()} isLoading={upsert.isPending}>
          {t('onboarding.save')}
        </Button>
      </div>
    </Container>
  )
}

function ChipGroup({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition-colors',
        selected
          ? 'border-accent-700 bg-accent-700 text-on-accent'
          : 'border-border-strong bg-paper-0 text-ink-700 hover:bg-paper-100',
      )}
    >
      {children}
    </button>
  )
}
