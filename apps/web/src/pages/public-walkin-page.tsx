import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CircleCheckBig, MapPin, Users } from 'lucide-react'
import {
  useJoinPublicQueue,
  type JoinedQueueEntry,
} from '@/lib/queries/public-queue'
import {
  usePublicLocations,
  usePublicOrganization,
  type PublicLocation,
  type PublicOrganization,
} from '@/lib/queries/public-booking'
import { Container } from '@/components/ui/container'
import { Card } from '@/components/ui/card'
import { Button, buttonVariants } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageSpinner } from '@/components/ui/spinner'
import { TextField } from '@/components/ui/text-field'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { getErrorMessage } from '@/lib/get-error-message'
import { useTranslation } from 'react-i18next'

/**
 * Turns `join_public_queue`'s raw Postgres error message into user-facing
 * copy. Deliberately scoped only to the errors this flow can actually
 * trigger (name + optional phone, no barber/service selection) — see
 * `friendlyBookingError` in `public-booking-page.tsx` for the fuller,
 * booking-specific version of this pattern.
 */
function friendlyWalkinError(rawMessage: string): string {
  const message = rawMessage.toLowerCase()

  if (message.includes('customer_name is required')) {
    return 'Please enter your name.'
  }
  if (message.includes('location is not available')) {
    return "This location isn't accepting walk-ins right now — please ask a team member for help."
  }
  if (message.includes('unknown organization')) {
    return "We couldn't find this shop. Please check with a team member."
  }

  return rawMessage
}

export function PublicWalkinPage() {
  const { t } = useTranslation()
  const { slug } = useParams<{ slug: string }>()
  const organizationQuery = usePublicOrganization(slug)

  useDocumentMeta({
    title: organizationQuery.data ? `Walk-in check-in — ${organizationQuery.data.name} — FadeUp` : 'Walk-in check-in — FadeUp',
    description: organizationQuery.data
      ? `Check in for the walk-in line at ${organizationQuery.data.name}.`
      : 'Check in for a walk-in barbershop queue.',
  })

  if (organizationQuery.isPending) {
    return <PageSpinner label={t('booking:walkin.loadingCheckin')} />
  }

  if (organizationQuery.isError) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState
          title={t('booking:walkin.couldntLoadCheckin')}
          description={organizationQuery.error.message}
          action={
            <Button variant="secondary" onClick={() => void organizationQuery.refetch()}>
              {t('common:action.tryAgain')}
            </Button>
          }
        />
      </Container>
    )
  }

  if (!organizationQuery.data) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState
          title={t('booking:walkin.weCouldntFindThisShop')}
          description={t('booking:walkin.thisCheckinLinkMayBe')}
          action={
            <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
              {t('booking:walkin.goToFadeup')}
            </Link>
          }
        />
      </Container>
    )
  }

  return <WalkinCheckIn organization={organizationQuery.data} />
}

// --- check-in flow (single form, no wizard — a walk-in should be fast) --------------------

const walkinSchema = z.object({
  customerName: z.string().trim().min(1, 'Name is required'),
  customerPhone: z.string().trim(),
})

type WalkinFormValues = z.infer<typeof walkinSchema>

function WalkinCheckIn({ organization }: { organization: PublicOrganization }) {
  const { t } = useTranslation()
  const locationsQuery = usePublicLocations(organization.slug)
  const joinQueue = useJoinPublicQueue()

  const [locationId, setLocationId] = useState<string | null>(null)
  const [lastEntry, setLastEntry] = useState<JoinedQueueEntry | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Auto-select the (very common) single-location shop — a kiosk shouldn't
  // make every customer tap through a step with only one possible answer.
  useEffect(() => {
    if (locationId || !locationsQuery.data) return
    if (locationsQuery.data.length === 1) {
      setLocationId(locationsQuery.data[0]!.id)
    }
  }, [locationsQuery.data, locationId])

  const selectedLocation = useMemo(
    () => locationsQuery.data?.find((location) => location.id === locationId) ?? null,
    [locationsQuery.data, locationId],
  )

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<WalkinFormValues>({
    resolver: zodResolver(walkinSchema),
    defaultValues: { customerName: '', customerPhone: '' },
  })

  async function onSubmit(values: WalkinFormValues) {
    if (!selectedLocation) return
    setSubmitError(null)
    try {
      const entry = await joinQueue.mutateAsync({
        organizationSlug: organization.slug,
        locationId: selectedLocation.id,
        customerName: values.customerName,
        customerPhone: values.customerPhone || null,
      })
      setLastEntry(entry)
    } catch (error) {
      const rawMessage = getErrorMessage(error) ?? 'Something went wrong. Please try again.'
      setSubmitError(friendlyWalkinError(rawMessage))
    }
  }

  function handleCheckInAnother() {
    setLastEntry(null)
    setSubmitError(null)
    reset({ customerName: '', customerPhone: '' })
  }

  if (locationsQuery.isPending) {
    return (
      <Container size="sm" className="flex flex-1 flex-col py-6 sm:py-10">
        <Header organization={organization} />
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </Container>
    )
  }

  if (locationsQuery.isError) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState
          title={t('booking:walkin.couldntLoadLocations')}
          description={locationsQuery.error.message}
          action={
            <Button variant="secondary" onClick={() => void locationsQuery.refetch()}>
              {t('common:action.tryAgain')}
            </Button>
          }
        />
      </Container>
    )
  }

  if (locationsQuery.data.length === 0) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <EmptyState title={t('booking:walkin.noLocationsAvailable')} description={t('booking:walkin.thisShopDoesntHaveAny')} />
      </Container>
    )
  }

  if (lastEntry) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-10">
        <SuccessScreen organization={organization} location={selectedLocation} onCheckInAnother={handleCheckInAnother} />
      </Container>
    )
  }

  // More than one location and none chosen yet — a physical kiosk device
  // stays at one location, but this covers the moment it's first set up (or
  // a multi-location shop sharing one link).
  if (locationsQuery.data.length > 1 && !selectedLocation) {
    return (
      <Container size="sm" className="flex flex-1 flex-col py-6 sm:py-10">
        <Header organization={organization} />
        <h2 className="mb-4 text-lg font-semibold text-ink-950">{t('booking:walkin.chooseALocation')}</h2>
        <div className="flex flex-col gap-3">
          {locationsQuery.data.map((location) => (
            <button
              key={location.id}
              type="button"
              onClick={() => setLocationId(location.id)}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-border-strong bg-paper-0 p-4 text-left transition-colors hover:border-accent-600 hover:bg-accent-100/30 focus-visible:outline-2 focus-visible:outline-accent-600"
            >
              <MapPin className="h-5 w-5 shrink-0 text-accent-600" aria-hidden="true" />
              <span className="font-medium text-ink-950">{location.name}</span>
            </button>
          ))}
        </div>
      </Container>
    )
  }

  return (
    <Container size="sm" className="flex flex-1 flex-col py-6 sm:py-10">
      <Header organization={organization} />

      {locationsQuery.data.length > 1 && selectedLocation ? (
        <button
          type="button"
          onClick={() => setLocationId(null)}
          className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm font-medium text-ink-700 hover:text-ink-950"
        >
          <MapPin className="h-4 w-4" aria-hidden="true" />
          {selectedLocation.name} · Change
        </button>
      ) : null}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {submitError ? <Alert variant="error">{submitError}</Alert> : null}

        <TextField
          label={t('booking:walkin.fullName')}
          autoComplete="name"
          autoFocus
          error={errors.customerName?.message}
          {...register('customerName')}
        />
        <TextField
          label={t('booking:walkin.phoneNumberOptional')}
          type="tel"
          autoComplete="tel"
          error={errors.customerPhone?.message}
          {...register('customerPhone')}
        />

        <Button type="submit" size="lg" isLoading={isSubmitting} className="mt-2">
          {t('booking:walkin.checkIn')}
        </Button>
        <p className="text-xs text-ink-500">You&apos;ll join the walk-in line right away — no appointment needed.</p>
      </form>
    </Container>
  )
}

function Header({ organization }: { organization: PublicOrganization }) {
  const { t } = useTranslation()
  return (
    <div className="mb-6">
      <p className="text-xs font-medium uppercase tracking-wide text-accent-600">{t('booking:walkin.walkinCheckin')}</p>
      <h1 className="mt-1 text-2xl font-semibold text-balance text-ink-950">{organization.name}</h1>
    </div>
  )
}

// --- success screen ----------------------------------------------------------------------

function SuccessScreen({
  organization,
  location,
  onCheckInAnother,
}: {
  organization: PublicOrganization
  location: PublicLocation | null
  onCheckInAnother: () => void
}) {
  const { t } = useTranslation()
  return (
    <Card elevated className="w-full p-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-100">
        <CircleCheckBig className="h-6 w-6 text-success-700" aria-hidden="true" />
      </div>
      <h1 className="mt-4 text-xl font-semibold text-ink-950">You&apos;re checked in</h1>
      <p className="mt-1 text-sm text-ink-500">
        You&apos;ve joined the walk-in line at {organization.name}
        {location ? ` — ${location.name}` : ''}. A team member will call you when it&apos;s your turn.
      </p>

      <div className="mt-6 flex items-center justify-center gap-2 text-sm text-ink-500">
        <Users className="h-4 w-4" aria-hidden="true" />
        {t('booking:walkin.thanksForYourPatience')}
      </div>

      <Button size="lg" onClick={onCheckInAnother} className="mt-6 w-full">
        {t('booking:walkin.checkInAnotherCustomer')}
      </Button>
    </Card>
  )
}
