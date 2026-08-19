import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Scissors } from 'lucide-react'
import { usePublicOrganization } from '@/lib/queries/public-booking'
import { usePublicBarber, usePublicBarberServices } from '@/lib/queries/public-barber'
import { FavoriteButton } from '@/components/customer/favorite-button'
import { Container } from '@/components/ui/container'
import { Card } from '@/components/ui/card'
import { Button, buttonVariants } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PageSpinner } from '@/components/ui/spinner'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useMoney } from '@/lib/intl/use-intl'


function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} hr${hours > 1 ? 's' : ''}` : `${hours} hr ${rest} min`
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}

/**
 * A barber's shareable public profile — "Barber Passport" (LOT 12). Real
 * data only: name/title/bio/photo from `staff_profiles`, and the actual
 * active services they perform, never a fabricated "specialties" list or
 * review count. `get_public_barber`/`list_public_barber_services` both
 * return zero rows for a private (`is_public = false`), unbookable, or
 * unknown barber — indistinguishable from a wrong link, same privacy
 * posture as the rest of the public surface.
 *
 * "Book with [name]" deep-links `/s/:slug?barber=<id>&location=<id>` — the
 * booking wizard (public-booking-page.tsx) preselects that barber and skips
 * the location step once the customer reaches a service that barber offers.
 */
export function PublicBarberPage() {
  const { slug, barberId } = useParams<{ slug: string; barberId: string }>()
  const organizationQuery = usePublicOrganization(slug)
  const barberQuery = usePublicBarber(slug, barberId)
  const servicesQuery = usePublicBarberServices(slug, barberId)

  useDocumentMeta({
    title: barberQuery.data
      ? `${barberQuery.data.displayName}${organizationQuery.data ? ` — ${organizationQuery.data.name}` : ''} — FadeUp`
      : 'Barber profile — FadeUp',
    description: barberQuery.data?.bio ?? 'A barber profile on FadeUp.',
  })

  if (organizationQuery.isPending || barberQuery.isPending) {
    return <PageSpinner label="Loading profile…" />
  }

  if (organizationQuery.isError) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState
          title="Couldn't load this profile"
          description={organizationQuery.error.message}
          action={
            <Button variant="secondary" onClick={() => void organizationQuery.refetch()}>
              Try again
            </Button>
          }
        />
      </Container>
    )
  }

  if (barberQuery.isError) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState
          title="Couldn't load this profile"
          description={barberQuery.error.message}
          action={
            <Button variant="secondary" onClick={() => void barberQuery.refetch()}>
              Try again
            </Button>
          }
        />
      </Container>
    )
  }

  if (!organizationQuery.data || !barberQuery.data) {
    return (
      <Container size="sm" className="flex flex-1 items-center py-16">
        <ErrorState
          title="We couldn't find this profile"
          description="This link may be out of date, or the profile may no longer be public. Check the link with the shop directly."
          action={
            <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
              Go to FadeUp
            </Link>
          }
        />
      </Container>
    )
  }

  return (
    <BarberProfile organization={organizationQuery.data} barber={barberQuery.data} servicesQuery={servicesQuery} />
  )
}

function BarberProfile({
  organization,
  barber,
  servicesQuery,
}: {
  organization: { id: string; slug: string; name: string; currency: string }
  barber: { barberId: string; displayName: string; title: string | null; bio: string | null; avatarUrl: string | null; locationId: string | null }
  servicesQuery: ReturnType<typeof usePublicBarberServices>
}) {
  const money = useMoney()

  const bookHref = `/s/${organization.slug}${
    barber.locationId
      ? `?barber=${barber.barberId}&location=${barber.locationId}`
      : `?barber=${barber.barberId}`
  }`

  return (
    <Container size="sm" className="flex flex-1 flex-col py-6 sm:py-10">
      <Card elevated className="relative p-6 text-center">
        <FavoriteButton organizationId={organization.id} barberId={barber.barberId} className="absolute right-4 top-4" />
        <BarberPhoto name={barber.displayName} avatarUrl={barber.avatarUrl} />
        <h1 className="mt-4 text-2xl font-semibold text-balance text-ink-950">{barber.displayName}</h1>
        {barber.title ? <p className="mt-1 text-sm font-medium text-accent-600">{barber.title}</p> : null}
        <p className="mt-1 text-sm text-ink-500">at {organization.name}</p>
        {barber.bio ? <p className="mt-4 text-sm text-ink-700">{barber.bio}</p> : null}

        <Link to={bookHref} className={buttonVariants({ size: 'lg' }, 'mt-6 w-full')}>
          Book with {barber.displayName.split(' ')[0]}
        </Link>
      </Card>

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">Services</h2>
        {servicesQuery.isPending ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : servicesQuery.isError ? (
          <p className="text-sm text-danger-700">{servicesQuery.error.message}</p>
        ) : servicesQuery.data.length === 0 ? (
          <p className="text-sm text-ink-500">No services listed right now.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {servicesQuery.data.map((service) => (
              <li
                key={service.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-border bg-paper-0 px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Scissors className="h-4 w-4 shrink-0 text-accent-600" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-950">{service.name}</p>
                    <p className="text-xs text-ink-500">{formatDuration(service.durationMinutes)}</p>
                  </div>
                </div>
                <span className="shrink-0 font-medium text-ink-950">{money(service.priceCents, organization.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Container>
  )
}

function BarberPhoto({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const [failed, setFailed] = useState(false)

  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="mx-auto h-24 w-24 rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-accent-100 text-2xl font-semibold text-accent-700">
      {initialsOf(name)}
    </div>
  )
}
