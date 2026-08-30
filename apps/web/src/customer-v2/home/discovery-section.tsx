import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'
import type { HomeDiscovery } from '@/customer-v2/hooks/use-home-discovery'
import { useDelayedFlag } from '@/customer-v2/hooks/use-delayed'
import { ProfessionalResult } from '@/customer-v2/home/professional-result'
import { ResultSkeleton } from '@/customer-v2/home/result-skeleton'

/**
 * Home's discovery list and every state it can genuinely be in.
 *
 * ============================================================================
 * R5R.1A-R2: ONE SECTION, NOT TWO
 * ============================================================================
 *
 * The previous revision drew two plates, "Barbers" and "Barbershops", from two
 * server queries on `p_entity_type`. The product owner's correction is that
 * this is not a customer taxonomy at all: it exposed the RPC's internal row
 * shape, and it presented a shop's own team members as businesses a customer
 * could book independently of the shop.
 *
 * There is now one plate. What a customer sees is one list of independently
 * bookable supply, headed "Near you", and each listing says what KIND of supply
 * it is on its own line rather than being sorted into a bin by it. The
 * classification lives in `marketplace-supply.ts` and the exclusion happens in
 * Postgres — see `use-home-discovery.ts`.
 *
 * A location belonging to a multi-location organization is an ordinary listing
 * here, exactly like a standalone shop. Nothing in this file knows or can say
 * that an organization has more than one location.
 *
 * ============================================================================
 * THE HEADING IS STILL A CLAIM
 * ============================================================================
 *
 * "Near you" is the label the correction asks for. The count beside it is the
 * server's `total_count` for this exact filter, not `listings.length` — Home
 * asks for twelve, and "12" under a heading when the server found ninety would
 * be wrong. "Nearest first" appears only when coordinates were genuinely shared
 * and the RPC genuinely sorted by a computed distance; no new ranking was
 * introduced.
 *
 * Errors never render the raw error: the R5R.0 audit found
 * `require-platform-role.tsx` printing a Supabase message straight to the user,
 * and that pattern is not inherited here.
 */

export function DiscoverySection({
  discovery,
  onClearFilters,
  onSearchEverywhere,
}: {
  discovery: HomeDiscovery
  onClearFilters: () => void
  /** Null when the search is already unfiltered by country. */
  onSearchEverywhere: (() => void) | null
}) {
  const showSkeletons = useDelayedFlag(discovery.isPending)

  return (
    <div className="mt-4 md:mt-5">
      <Body
        discovery={discovery}
        showSkeletons={showSkeletons}
        onClearFilters={onClearFilters}
        onSearchEverywhere={onSearchEverywhere}
      />
    </div>
  )
}

function Body({
  discovery,
  showSkeletons,
  onClearFilters,
  onSearchEverywhere,
}: {
  discovery: HomeDiscovery
  showSkeletons: boolean
  onClearFilters: () => void
  onSearchEverywhere: (() => void) | null
}) {
  const { t } = useTranslation()

  if (discovery.isError) {
    return (
      <Notice
        tone="failure"
        title={t('customer-app:v2.discovery.errorTitle')}
        body={t('customer-app:v2.discovery.errorBody')}
        actionLabel={t('customer-app:v2.discovery.retry')}
        onAction={discovery.refetch}
      />
    )
  }

  if (discovery.isPending) {
    // Nothing at all until the delay elapses — a cached answer arrives faster
    // than this and a skeleton for it would be a flicker.
    if (!showSkeletons) return <div className="min-h-64" />

    return (
      <div className="v2-plate overflow-hidden">
        <div className="px-4 py-3 md:px-5">
          <div className="v2-skeleton h-5 w-28 rounded-v2-1" />
        </div>
        <ResultSkeleton count={3} />
      </div>
    )
  }

  if (discovery.listings.length === 0) {
    return discovery.isFiltered ? (
      <Notice
        tone="empty"
        title={t('customer-app:v2.discovery.noMatchTitle')}
        body={t('customer-app:v2.discovery.noMatchBody')}
        /*
          The action names what the customer will actually undo. "Clear filters"
          under a typed query is wrong — they set a query, not a filter — and
          telling someone to clear a thing they never set is how an empty state
          stops being trusted.
        */
        actionLabel={
          discovery.hasQuery && discovery.hasFacet
            ? t('customer-app:v2.discovery.clearAll')
            : discovery.hasQuery
              ? t('customer-app:v2.discovery.clearSearch')
              : t('customer-app:v2.discovery.clearFilters')
        }
        onAction={onClearFilters}
      />
    ) : (
      <Notice
        tone="empty"
        title={t('customer-app:v2.discovery.noneHereTitle')}
        /*
          "in this country" rather than the country's name. Interpolating a
          country after a fixed preposition is a real bug in most of the ten
          locales — French alone needs en/au/aux by gender and initial, and
          Japanese and Arabic reorder the clause outright. The location chip
          directly above already names the country, so the sentence does not
          have to.
        */
        body={t('customer-app:v2.discovery.noneHereBody')}
        actionLabel={onSearchEverywhere ? t('customer-app:v2.discovery.searchEverywhere') : null}
        onAction={onSearchEverywhere}
      />
    )
  }

  return <ListingPlate discovery={discovery} />
}

function ListingPlate({ discovery }: { discovery: HomeDiscovery }) {
  const { t } = useTranslation()
  const headingId = 'v2-discovery-heading'

  return (
    <section aria-labelledby={headingId} className="v2-plate overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-4 py-3 md:px-5">
        <h2 id={headingId} className="text-v2-title font-semibold text-v2-ink">
          {t('customer-app:v2.discovery.nearYou')}
        </h2>
        <p className="shrink-0 text-v2-caption tabular-nums text-v2-ink-mute">
          {discovery.isNearest ? t('customer-app:v2.discovery.nearestFirst') : null}
          {discovery.isNearest && discovery.totalCount ? (
            <span aria-hidden="true" className="mx-1.5">
              ·
            </span>
          ) : null}
          {discovery.totalCount !== null && discovery.totalCount > 0
            ? t('customer-app:v2.discovery.count', { count: discovery.totalCount })
            : null}
        </p>
      </div>

      {/*
        `aria-busy` while a refinement is in flight, and the rows recede rather
        than unmount. The previous answer staying on screen is the whole point:
        `keepPreviousData` is what stops the list collapsing and rebuilding on
        every keystroke.
      */}
      <ul
        className={discovery.isFetching ? 'v2-refining' : undefined}
        aria-busy={discovery.isFetching || undefined}
      >
        {discovery.listings.map((listing, index) => (
          <li key={listing.result.locationId} className="border-t border-v2-hairline">
            <ProfessionalResult
              result={listing.result}
              supplyType={listing.supplyType}
              currency={discovery.currencyByOrganization[listing.result.organizationId]}
              index={index}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * One shape for empty and failure, with one thing separating them.
 *
 * Both say what happened, what is still true, and offer at most one action. No
 * dashed box and no generic illustration — DESIGN_SYSTEM.md asks an empty state
 * to explain what to do next, and a grey outline around the explanation adds
 * nothing to it. It sits on a plate for the same reason the groups do: the page
 * should still be made of something when it has nothing to list.
 *
 * What must NOT be shared is the reading: "nothing exists here" and "we could
 * not reach the server" are different situations and one of them is our fault.
 * `tone="failure"` earns a warning-toned marker and a filled recovery button;
 * `tone="empty"` stays quiet, because there is nothing to recover from. The
 * filled button is INK, not green — green in this product means an action that
 * books a haircut, and "Try again" is not one.
 *
 * The title is a real `h2`, at the same level as a group heading, so a
 * screen-reader user navigating by heading finds the page's content region
 * whether it succeeded or failed.
 */
function Notice({
  tone,
  title,
  body,
  actionLabel,
  onAction,
}: {
  tone: 'empty' | 'failure'
  title: string
  body: string
  actionLabel: string | null
  onAction: (() => void) | null
}) {
  const { t } = useTranslation()
  const failed = tone === 'failure'

  return (
    <div className="v2-plate px-5 py-10 md:px-6 md:py-14">
      {failed ? (
        <p className="mb-2 flex items-center gap-1.5 text-v2-caption font-semibold uppercase tracking-[0.08em] text-v2-alert">
          <TriangleAlert className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          {t('customer-app:v2.discovery.errorEyebrow')}
        </p>
      ) : null}

      <h2 className="text-v2-lead font-semibold text-v2-ink">{title}</h2>
      <p className="mt-1.5 max-w-md text-v2-body text-v2-ink-soft">{body}</p>

      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className={
            failed
              ? 'v2-press mt-4 inline-flex h-11 items-center rounded-v2-2 bg-v2-ink px-4 text-v2-meta font-semibold text-v2-paper hover:bg-v2-ink/90'
              : 'v2-press mt-4 inline-flex h-11 items-center rounded-v2-2 border border-v2-edge bg-v2-paper px-4 text-v2-meta font-semibold text-v2-ink hover:bg-v2-fill'
          }
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}
