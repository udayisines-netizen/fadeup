import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useApplySurfaceTheme } from '@/shared/theme/useTheme'
import { useDiscovery } from '@/features/demo/api/discovery'
import {
  useHandleProbe,
  useOrganizationBarbers,
  usePublicBarber,
  usePublicBarberServices,
  usePublicLocations,
  usePublicOrganization,
  usePublicProfessional,
  usePublicServiceState,
} from '@/features/demo/api/profile'
import { DemoFrame } from '@/features/demo/components/DemoFrame'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/Button'
import { ClaimBadge } from '@/shared/ui/ClaimBadge'
import { Duration } from '@/shared/ui/Duration'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { MediaFrame } from '@/shared/ui/MediaFrame'
import { MetricValue } from '@/shared/ui/MetricValue'
import { Money } from '@/shared/ui/Money'
import { Rating } from '@/shared/ui/Rating'
import { Row } from '@/shared/ui/Row'
import { SkeletonCircle, SkeletonText } from '@/shared/ui/Skeleton'
import { StateBadge } from '@/shared/ui/StateBadge'
import { StickyActionBar } from '@/shared/ui/StickyActionBar'
import { IconLocation } from '@/shared/ui/icons'

/**
 * Étude B — identité barber (P1c §5B), hiérarchie du MASTER_SPEC §9 :
 * média/avatar → identité → état revendiqué → handle/accroche →
 * « Travaille chez [Salon] » → localisation → RÉSERVER → Suivre →
 * signaux opérationnels réels → portfolio → services → preuve sociale → avis.
 *
 * Données 100 % RPC publiques ; les absences (photo, métriques, avis d'un
 * profil non revendiqué) rendent leurs états vides honnêtes — c'est l'un des
 * deux états exigés par P1c.
 */

function ProfilePicker() {
  const { t } = useTranslation('v2')
  const { rows, loading } = useDiscovery({})
  return (
    <div className="mx-auto max-w-xl">
      <h2 className="text-fu-lg font-semibold">{t('demo.profile.pickTitle')}</h2>
      <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">{t('demo.profile.pickDescription')}</p>
      <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--fu-border)]">
        {loading ? (
          <div className="flex items-center gap-3 p-4">
            <SkeletonCircle />
            <SkeletonText className="w-1/2" />
          </div>
        ) : (
          rows.map((row) => (
            <Row
              key={row.locationId}
              as="link"
              to={`/demo/profile?org=${encodeURIComponent(row.organizationSlug)}`}
              clampTitle
              leading={<Avatar name={row.organizationName} />}
              title={row.organizationName}
              subtitle={row.city ?? undefined}
              chevron
            />
          ))
        )}
      </div>
    </div>
  )
}

function HandleProbe() {
  const { t } = useTranslation('v2')
  const [value, setValue] = useState('')
  const [probed, setProbed] = useState<string | null>(null)
  const probe = useHandleProbe(probed)
  return (
    <section className="mt-8 rounded-[var(--radius-card)] border border-[var(--fu-border)] p-4">
      <h3 className="font-fu-mono text-fu-xs text-[var(--fu-text-secondary)]">{t('demo.profile.handleProbe')}</h3>
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          setProbed(value.trim() || null)
        }}
      >
        <Input
          label="@handle"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="min-w-0 flex-1 basis-40"
        />
        <Button type="submit" variant="secondary">
          {t('common.action.search')}
        </Button>
      </form>
      {probed && !probe.isPending && (
        <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">
          {probe.data ? probe.data.display_name : t('demo.profile.handleProbeEmpty')}
        </p>
      )}
    </section>
  )
}

function ProfileStudy({ slug }: { slug: string }) {
  const { t } = useTranslation('v2')
  const organization = usePublicOrganization(slug)
  const barbers = useOrganizationBarbers(slug)
  const barberId = barbers.data?.[0]?.barber_id ?? null
  const barber = usePublicBarber(slug, barberId)
  const services = usePublicBarberServices(slug, barberId)
  const locations = usePublicLocations(slug)
  const locationId = barber.data?.location_id ?? locations.data?.[0]?.id ?? null
  const serviceState = usePublicServiceState(slug, locationId, barberId)
  const professional = usePublicProfessional(barber.data?.professional_id ?? null)

  if (barbers.isLoading || barber.isLoading) {
    return (
      <div className="mx-auto flex max-w-xl items-center gap-4 py-10">
        <SkeletonCircle className="size-20" />
        <div className="flex-1 space-y-2">
          <SkeletonText className="w-2/3" />
          <SkeletonText className="w-1/3" />
        </div>
      </div>
    )
  }

  const identity = barber.data
  if (!identity) {
    return (
      <EmptyState
        title={t('errors.route.notFoundTitle')}
        description={t('errors.route.notFoundDescription')}
        action={
          <Link to="/demo/profile" className="text-fu-sm text-[var(--fu-accent-text)] underline-offset-2 hover:underline">
            {t('demo.profile.pickTitle')}
          </Link>
        }
      />
    )
  }

  const claimState = identity.professional_id ? 'claimed' : 'unclaimed'
  const state = serviceState.data
  /* CONSTAT P1c (bloquant P2, voir BLOCKERS.md) : `get_public_service_state`
     est STABLE mais INSÈRE (ensure_location_service_settings) → PostgREST la
     refuse en transaction lecture seule (25006 → 405) pour TOUT appelant.
     Tant qu'elle échoue, l'état opérationnel est INCONNU : on l'affiche
     `partial-data` et Réserver reste désactivé — jamais un état inventé. */
  const stateUnknown = serviceState.isError
  const bookingOpen = Boolean(state?.booking_accepting_new_entries)
  const queueOpen = Boolean(state?.queue_accepting_new_entries)
  const location = locations.data?.[0]
  const currency = organization.data?.currency ?? 'EUR'

  /* Signal opérationnel RÉEL, dérivé du mode effectif. */
  const operationalState = stateUnknown
    ? ('partial-data' as const)
    : bookingOpen
      ? ('bookable' as const)
      : queueOpen
        ? ('queue-open' as const)
        : ('not-bookable' as const)

  return (
    <div className="mx-auto max-w-xl lg:grid lg:max-w-4xl lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
      <div>
        {/* 1. Média + avatar */}
        <MediaFrame alt="" ratio="landscape" />
        <div className="-mt-8 flex items-end gap-4 px-4">
          <Avatar name={identity.display_name} src={identity.avatar_url} size="xl" className="ring-4 ring-[var(--fu-canvas)]" />
        </div>

        <div className="mt-3 px-4">
          {/* 2–4. Identité, état revendiqué, accroche */}
          <h2 className="text-fu-2xl font-semibold tracking-tight">{identity.display_name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <ClaimBadge state={claimState} size="sm" />
            {professional.data?.handle && (
              <span className="font-fu-mono text-fu-sm text-[var(--fu-text-secondary)]">@{professional.data.handle}</span>
            )}
          </div>
          {identity.title && <p className="mt-2 text-fu-base text-[var(--fu-text-secondary)]">{identity.title}</p>}

          {/* 5. « Travaille chez [Salon] » — cliquable */}
          {organization.data && (
            <p className="mt-2 text-fu-sm">
              <Link
                to={`/shop/${encodeURIComponent(organization.data.slug)}`}
                className="font-medium text-[var(--fu-accent-text)] underline-offset-2 hover:underline"
              >
                {t('demo.profile.worksAt', { salon: organization.data.name })}
              </Link>
            </p>
          )}

          {/* 6. Localisation */}
          {location && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-fu-sm text-[var(--fu-text-secondary)]">
              <IconLocation aria-hidden="true" className="size-3.5" />
              {[location.address_line1, location.city].filter(Boolean).join(', ')}
            </p>
          )}

          {/* 9. Signaux opérationnels réels */}
          <div className="mt-3 flex flex-wrap gap-2">
            <StateBadge state={operationalState} size="sm" />
            {!bookingOpen && queueOpen && (
              <span className="text-fu-sm text-[var(--fu-text-secondary)]">{t('demo.profile.queueOnlyNote')}</span>
            )}
          </div>
          {!stateUnknown && !bookingOpen && !queueOpen && (
            <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('demo.profile.bookingClosed')}</p>
          )}

          {identity.bio && <p className="mt-4 text-fu-base leading-relaxed">{identity.bio}</p>}
        </div>

        {/* 10. Portfolio — état vide honnête */}
        <section className="mt-8 px-4">
          <h3 className="text-fu-lg font-semibold">{t('demo.profile.portfolio')}</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <MediaFrame alt="" ratio="square" />
            <MediaFrame alt="" ratio="square" />
            <MediaFrame alt="" ratio="square" />
          </div>
          <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('demo.profile.portfolioEmpty')}</p>
        </section>

        {/* 11. Services — rangées à filet fin, Mono pour durée et prix */}
        <section className="mt-8 px-4">
          <h3 className="text-fu-lg font-semibold">{t('demo.profile.services')}</h3>
          <div className="mt-3 rounded-[var(--radius-card)] border border-[var(--fu-border)]">
            {(services.data ?? []).map((service) => (
              <Row
                key={service.id}
                clampTitle
                title={<span className="text-fu-base font-medium">{service.name}</span>}
                subtitle={<Duration minutes={service.duration_minutes} />}
                trailing={<Money cents={service.price_cents} currency={currency} />}
              />
            ))}
          </div>
        </section>
      </div>

      <aside className="px-4 lg:px-0 lg:pt-6">
        {/* 12. Preuve sociale — cinq métriques distinctes, jamais un zéro fabriqué */}
        <section className="mt-8 lg:mt-0">
          <h3 className="text-fu-lg font-semibold">{t('demo.profile.socialProof')}</h3>
          <div className="mt-3 flex flex-col items-start gap-2.5">
            <MetricValue kind="followers" value={professional.data ? professional.data.follower_count : null} />
            <MetricValue kind="verified-clients" value={null} />
            <MetricValue kind="rating" value={null} />
            <MetricValue kind="reviews" value={null} />
            <MetricValue kind="likes" value={null} />
          </div>
        </section>

        {/* 13. Avis — aucun en base : jamais zéro étoile */}
        <section className="mt-8">
          <h3 className="text-fu-lg font-semibold">{t('demo.profile.reviews')}</h3>
          <div className="mt-2">
            <Rating value={null} />
          </div>
        </section>

        <HandleProbe />
      </aside>

      {/* 7–8. RÉSERVER (vert plein, dominant) + Suivre (secondaire) —
          la barre collante, seule ombre du consumer. Le CTA affiche
          l'ÉTAT RÉEL : désactivé si le mode ne l'autorise pas. */}
      <StickyActionBar>
        <div className="flex gap-2 [&>button:first-child]:flex-[2] [&>button:last-child]:flex-1">
          <Button variant="primary" size="lg" disabled={!bookingOpen}>
            {t('common.action.book')}
          </Button>
          <Button variant="secondary" size="lg">
            {t('common.action.follow')}
          </Button>
        </div>
      </StickyActionBar>
    </div>
  )
}

export function DemoProfilePage() {
  useApplySurfaceTheme('consumer')
  const { t } = useTranslation('v2')
  const [params] = useSearchParams()
  const slug = params.get('org')

  return (
    <DemoFrame
      title={t('demo.index.profileTitle')}
      note="get_public_barber · list_public_barber_services · get_public_service_state · get_public_professional"
    >
      {slug ? <ProfileStudy slug={slug} /> : <ProfilePicker />}
    </DemoFrame>
  )
}
