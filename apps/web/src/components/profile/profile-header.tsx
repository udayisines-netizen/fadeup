import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '@/components/ui/avatar'
import { VerifiedBadge } from '@/components/ui/verified-badge'
import { cn } from '@/lib/cn'

/**
 * ============================================================================
 * THE SOCIAL HEADER, SHARED BY BOTH PROFILE KINDS
 * ============================================================================
 *
 * §13 sets the hierarchy for a professional: identity, then social
 * credibility, then Follow, then Book. §15 says a shop profile must share
 * FadeUp's DNA without being identical — more "place and collective", less
 * "person and creator".
 *
 * One component with a `variant`, rather than two headers, because the parts
 * that must agree are the parts a customer reads as "this is the same product":
 * the avatar treatment, where the verified badge sits relative to the name, the
 * order of the stat row, and the fact that the actions are BELOW the identity
 * rather than floating over a banner. The parts that differ are shape only —
 * a person gets a circle, a place gets a rounded square.
 *
 * ============================================================================
 * THE STAT ROW ONLY EVER SHOWS WHAT IS TRUE
 * ============================================================================
 *
 * `stats` is a list the caller builds from real values. There is no "0
 * followers" and no "— reviews": FadeUp has no reviews table, and a zero
 * follower count on a new professional is a discouraging number that says
 * nothing a customer needs. A stat with no value is simply not passed.
 */
export function ProfileHeader({
  variant,
  name,
  avatarUrl,
  headline,
  subtitle,
  verified,
  stats,
  actions,
  meta,
}: {
  variant: 'person' | 'place'
  name: string
  avatarUrl?: string | null
  /** The professional's own one-line headline, or the shop's location line. */
  headline?: ReactNode
  subtitle?: ReactNode
  verified: boolean
  stats?: Array<{ key: string; value: string; label: string }>
  /** Follow / Favourite / Book. Laid out by the caller in its own order. */
  actions?: ReactNode
  /** Anything below the actions — an availability note, a service-mode CTA. */
  meta?: ReactNode
}) {
  const { t } = useTranslation('common')

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-paper-0">
      {/*
        A tinted band rather than a photograph. There is no image column for
        either entity, and a stock photo behind a real business is the kind of
        decoration that quietly becomes a lie. The gradient is tokenised so it
        rethemes with the rest of the product.
      */}
      <div
        aria-hidden="true"
        className={cn(
          'h-24 bg-gradient-to-br sm:h-28',
          variant === 'person'
            ? 'from-accent-100 via-paper-100 to-paper-200'
            : 'from-paper-200 via-paper-100 to-accent-100',
        )}
      />

      <div className="-mt-10 flex flex-col gap-4 px-5 pb-5 sm:px-6 sm:pb-6">
        <Avatar
          name={name}
          src={avatarUrl}
          size="xl"
          className={cn('ring-4 ring-paper-0', variant === 'place' && 'rounded-2xl')}
        />

        <div className="min-w-0">
          <h1 className="flex min-w-0 flex-wrap items-center gap-2 text-title text-ink-950">
            <span className="text-balance">{name}</span>
            <VerifiedBadge verified={verified} size="lg" />
          </h1>
          {headline ? <div className="mt-1 text-sm font-medium text-accent-700">{headline}</div> : null}
          {subtitle ? <div className="mt-1 text-sm text-ink-500">{subtitle}</div> : null}
        </div>

        {stats && stats.length > 0 ? (
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {stats.map((stat) => (
              <div key={stat.key} className="flex items-baseline gap-1.5">
                <dt className="sr-only">{stat.label}</dt>
                <dd className="text-base font-semibold tabular-nums text-ink-950">{stat.value}</dd>
                <span aria-hidden="true" className="text-caption text-ink-500">
                  {stat.label}
                </span>
              </div>
            ))}
          </dl>
        ) : null}

        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}

        {meta}
      </div>

      {/* The accessible name for the whole region, so a screen reader user
          moving by landmark hears whose profile this is. */}
      <span className="sr-only">{t('nav.profileOf', { name })}</span>
    </section>
  )
}
