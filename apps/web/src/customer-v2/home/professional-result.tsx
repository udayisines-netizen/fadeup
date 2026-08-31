import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { MarketplaceProfessionalResult } from '@/lib/queries/marketplace'
import { useMoney } from '@/lib/intl/use-intl'
import { IdentityTile } from '@/customer-v2/home/identity-tile'
import type { MarketplaceSupplyType } from '@/customer-v2/marketplace-supply'
import { v2BookingPath, v2ShopProfilePath } from '@/customer-v2/routes'

/**
 * One marketplace listing — an independently bookable place.
 *
 * ============================================================================
 * R5R.1A-R2: EVERY ROW IS SUPPLY, AND SUPPLY IS A PLACE
 * ============================================================================
 *
 * This used to render two shapes: a shop, and a barber who worked at one. The
 * product owner's correction removed the second — a shop's team members are not
 * businesses a customer books independently of the shop, so they are not
 * marketplace results at all. `marketplace-supply.ts` sets out why that is
 * structural in the schema rather than a policy choice.
 *
 * What remains is one shape. Each row is a bookable location, and it says which
 * of the two customer-facing kinds of supply it is:
 *
 *   Independent   a professional operating as their own business.
 *   Barbershop    a barbershop location — including one belonging to a
 *                 multi-location organization, which is an ordinary barbershop
 *                 to a customer and is never labelled as part of a group.
 *
 * `supplyType` is null until `organizations.business_type` reaches a public
 * contract, and a null renders NOTHING rather than defaulting to the commoner
 * value. That is the same rule the operational values below follow, applied to
 * a classification.
 *
 * ============================================================================
 * THE NAME IS THE LOCATION'S, WHEN THE LOCATION HAS ITS OWN
 * ============================================================================
 *
 * A single-site shop stores the same string twice — "Side Agency" as the
 * organization and as its one location — and the customer should see it once.
 * A multi-location organization does not: "Fade Factory Group" runs "Fade
 * Factory Créteil", and the customer is standing outside Créteil. So the title
 * is the LOCATION's name whenever it differs from the organization's, which
 * flattens a group's sites into ordinary listings without ever naming the
 * group.
 *
 * ============================================================================
 * EVERY OPERATIONAL VALUE IS STILL CONDITIONAL ON BEING REAL
 * ============================================================================
 *
 * `is_open_now` is nullable and null means UNKNOWN, not closed — a shop with no
 * published hours renders nothing. `distance_km` is null until the customer
 * shares coordinates, so distance appears only when it was actually computed.
 * `queue_waiting_count` shows only above zero, because "0 waiting" on a closed
 * shop reads as an invitation. Price is omitted when the organization's
 * currency has not resolved, because a number without the right currency beside
 * it is a wrong price, not a partial one.
 *
 * ============================================================================
 * WHERE BOOK GOES, AND WHY IT LEAVES THE PREVIEW
 * ============================================================================
 *
 * `/s/{slug}` is the real, working, anonymous booking entry. The greenfield
 * booking interaction is R5R.1E; until it exists, pointing at the surface that
 * genuinely books beats a button that opens nothing.
 *
 * The row is clickable as a whole through an overlay on the title link, so
 * exactly one link per destination sits in the accessibility tree instead of an
 * anchor nested inside an anchor. Book is `relative`, which paints it above that
 * overlay without any z-index bookkeeping.
 */
export function ProfessionalResult({
  result,
  supplyType,
  currency,
  index,
}: {
  result: MarketplaceProfessionalResult
  /**
   * The customer-facing kind of supply, or null when the domain has not said.
   * Null renders no label at all — never a default.
   */
  supplyType: MarketplaceSupplyType | null
  /** The organization's real currency, or undefined until it resolves. */
  currency: string | undefined
  /** Position in the list, for the staggered entry only. */
  index: number
}) {
  const { t, i18n } = useTranslation()
  const money = useMoney()

  /*
    The location's own name when it has one, otherwise the organization's — see
    the note above. This is the whole of how a multi-location organization is
    flattened: its sites appear under their own names and the group is never
    mentioned.
  */
  const name =
    result.locationName && result.locationName !== result.organizationName
      ? result.locationName
      : result.organizationName

  /*
    WHAT THE SECOND LINE CARRIES, NOW THAT IT CARRIES A TYPE.

    The supply type leads, and the locality follows it. The street used to lead
    and it no longer fits: with "Barbershop · " in front of it, "19 rue Danton ·
    Antony (92)" truncated at 390px and the ELLIPSIS ate the city — losing the
    one part a customer scanning a country-wide list actually needs.

    So the street appears only when there is no city to print. It is not lost
    information, it is information that belongs one tap deeper, on the profile,
    where the whole address has room.
  */
  const place =
    result.city ??
    result.addressLine1 ??
    (result.locationName !== name ? result.locationName : null)

  const supplyLabel =
    supplyType === 'independent'
      ? t('customer-app:v2.result.typeIndependent')
      : supplyType === 'barbershop'
        ? t('customer-app:v2.result.typeBarbershop')
        : null

  const distanceLabel = useMemo(() => {
    if (result.distanceKm === null) return null
    return new Intl.NumberFormat(i18n.language, {
      style: 'unit',
      unit: 'kilometer',
      unitDisplay: 'short',
      maximumFractionDigits: result.distanceKm < 10 ? 1 : 0,
    }).format(result.distanceKm)
  }, [result.distanceKm, i18n.language])

  const priceLabel =
    result.startingPriceCents !== null && currency
      ? t('customer-app:v2.result.priceFrom', { price: money(result.startingPriceCents, currency) })
      : null

  /*
    R5R.1D: the row opens the GREENFIELD establishment profile, carrying the
    location so a multi-location organization's row opens as the site the
    customer chose, not the organization's first site.
  */
  const profilePath = v2ShopProfilePath(result.organizationSlug, result.locationId)

  /*
    `location` is carried because `search_public_professionals` emits one row
    per active LOCATION, so a multi-location organization is several listings
    with several cities — and `public-booking-page.tsx` only auto-skips its
    location step when the org has exactly one location or the parameter is
    supplied. Dropping it made the customer choose a branch on Home and then
    choose it again in the wizard, with a real chance of landing on the wrong
    one.
  */
  // R5R.1E: Book stays inside the greenfield — same context parameters,
  // consumed by the new booking experience instead of the legacy wizard.
  const bookPath = v2BookingPath(result.organizationSlug, { locationId: result.locationId })

  return (
    <article
      /*
        WHY BOOK IS ON THE LAST LINE AND NOT BESIDE THE NAME.

        It was beside the name for one revision, and the French screenshot at
        390px settled the question: "Réserver" is 100px of button, which left
        the text column 150px, which truncated the shop to "Anto…" and wrapped
        the operational strip onto a second line beginning with an orphaned
        separator. Every one of those is a defect, and all three came from the
        same decision.

        Putting the action on its own line gives identity the full 262px, so the
        name and the place stop truncating in the language the product is most
        used in — and Book, which is the conversion action, gets a trailing
        position of its own rather than competing with the name for width.

        It costs height and the cost is worth it. The row is 87px with Book
        inline and about 115px without; the first pass, by its own browser QA,
        spent 115px on an empty media well alone.

        AND DESKTOP IS NOT THIS ROW AT A WIDER MEASURE. Independent review
        measured the first revision's 1440 page ending at y=357 of a 900px
        viewport — 60% empty, and shorter than the version the product owner had
        already rejected — with the cause named in this file's own comment: the
        rows were literally the phone's. Brief §11 rules that out by name. From
        `lg` a result is a genuinely larger object: a 96px identity against 56px,
        a 17px name, a 15px relationship line and 24px of padding. Same grammar,
        its own scale.
      */
      className="v2-enter relative flex gap-3 px-3.5 py-3 md:gap-4 md:px-5 md:py-4 lg:gap-5 lg:px-6 lg:py-6"
      // Capped so a full page of results is a quick cascade, never a wave.
      style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}
    >
      <IdentityTile
        src={result.barberAvatarUrl}
        /*
          Empty on purpose. The professional's name is the very next element and
          is already a link; an `alt` repeating it would make a screen reader
          announce the same person twice per result. WCAG's own guidance is that
          an image duplicating adjacent text is decorative.
        */
        alt=""
        kind={supplyType === 'independent' ? 'barber' : 'shop'}
        /* Design Pass A no-media system: initials from the real name. */
        name={supplyType === 'independent' ? (result.barberDisplayName ?? name) : name}
        className="h-14 w-14 text-[1.05rem] md:h-[4.5rem] md:w-[4.5rem] md:text-[1.2rem] lg:h-20 lg:w-20"
      />

      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-1 text-v2-body font-semibold text-v2-ink lg:text-v2-title">
          {/*
            `<bdi>` on every piece of operator-entered text.

            The Arabic capture rendered "19 rue Danton · Antony (92)" as
            "rue Danton · Antony (92) 19": a Latin address inside an RTL
            paragraph, with its leading house number reordered to the far end by
            the bidi algorithm. The address was not wrong in the database and
            not wrong in the DOM — it was resolved against the paragraph's
            direction instead of its own.

            `<bdi>` isolates each run so a name, an establishment and an address
            are laid out in THEIR script's direction whatever the page is set
            to. It applies to all three because all three are arbitrary
            operator-entered strings; only the address happened to expose it.
          */}
          <Link to={profilePath} className="min-w-0 truncate after:absolute after:inset-0 after:content-['']">
            <bdi>{name}</bdi>
          </Link>
        </h3>

        {/*
          THE EMPLOYER IS GREEN TEXT, NOT A LINK.

          It was a link for one revision. Browser QA measured it at 89×15 — an
          inline target a fifth of the 44px floor, sitting inside a row whose
          whole surface already navigates somewhere ELSE. WCAG 2.5.8 exempts
          inline links from the size rule, so it was not a conformance failure;
          it was a mis-tap hazard, which is worse, because the two destinations
          were 15px apart and the small one was not the one the customer meant.

          So the establishment keeps the colour that identifies it as a FadeUp
          entity and gives up the tap. It is one tap further away — reachable
          from the barber's own profile, which is where PRODUCT_UI_BLUEPRINT.md
          §11 actually puts the clickable "Working at".
        */}
        {/*
          TYPE FIRST, THEN WHERE.

          The kind of supply is the thing the correction added, and it leads the
          line because it is what tells a customer whether they are looking at a
          person's own business or an establishment. It is omitted entirely when
          the domain has not said — see the header note.
        */}
        <p className="mt-0.5 truncate text-v2-meta text-v2-ink-soft lg:mt-1 lg:text-v2-body">
          {supplyLabel ? <span className="font-medium text-v2-ink">{supplyLabel}</span> : null}
          {supplyLabel && place ? (
            <span aria-hidden="true" className="mx-1 text-v2-ink-mute">
              ·
            </span>
          ) : null}
          {place ? <bdi>{place}</bdi> : null}
        </p>

        <div className="mt-1.5 flex items-center gap-3 lg:mt-3">
          <OperationalStrip
            isOpenNow={result.isOpenNow}
            priceLabel={priceLabel}
            distanceLabel={distanceLabel}
            queueWaitingCount={result.queueWaitingCount}
          />

          {/*
            `ms-auto` rather than relying on the strip to push it: the strip
            renders NOTHING when the backend knows nothing about this listing,
            and Book must sit at the trailing edge on those rows too.

            The whole row is already a tap target leading to the profile, so an
            under-sized Book would make the largest target on the row the one
            that does NOT book. 44px tall, and wide enough to read as the row's
            action in every language.
          */}
          <Link
            to={bookPath}
            className="v2-press relative ms-auto inline-flex h-11 shrink-0 items-center justify-center rounded-v2-2 bg-v2-green px-4 text-v2-meta font-semibold text-v2-paper hover:bg-v2-green-deep"
          >
            {t('customer-app:v2.result.book')}
          </Link>
        </div>
      </div>
    </article>
  )
}

/**
 * The operational line. Separated with a middle dot rather than pills, because
 * four badges in a row is the "wall of badges" PRODUCT_UI_BLUEPRINT.md §6 warns
 * against — open state is the only value that earns colour, since it is the one
 * that decides whether the customer can go now.
 *
 * Distance leads the facts when it exists: it is the value the blueprint calls
 * out as belonging directly on a result, and it is the one a customer filters
 * on mentally before price.
 */
function OperationalStrip({
  isOpenNow,
  priceLabel,
  distanceLabel,
  queueWaitingCount,
}: {
  isOpenNow: boolean | null
  priceLabel: string | null
  distanceLabel: string | null
  queueWaitingCount: number
}) {
  const { t } = useTranslation()

  const facts = [
    distanceLabel,
    priceLabel,
    queueWaitingCount > 0 ? t('customer-app:v2.result.waiting', { count: queueWaitingCount }) : null,
  ].filter((fact): fact is string => Boolean(fact))

  if (isOpenNow === null && facts.length === 0) return null

  return (
    /*
      ONE LINE, NEVER TWO — AND IT ENDS IN AN ELLIPSIS, NOT A CUT.

      Two bugs were fixed here, both found by looking at the French render
      rather than at a probe.

      It used to wrap, which put "· à partir de 25,00 €" on a second line
      beginning with an orphaned separator — a bullet list nobody designed.

      The first fix made it `flex` + `truncate`, which was worse:
      `text-overflow: ellipsis` has no effect across flex ITEMS, so the strip
      clipped mid-word with no ellipsis at all and simply looked broken. This is
      an ordinary block with inline children, which is the only arrangement
      where `truncate` actually produces the "…" it promises.

      Facts are ordered open-state, distance, price, queue, so what an ellipsis
      eats first is what matters least.
    */
    <p className="min-w-0 truncate text-v2-meta lg:text-v2-body">
      {isOpenNow === true ? (
        <span className="font-semibold text-v2-green-ink">{t('customer-app:v2.result.open')}</span>
      ) : null}
      {isOpenNow === false ? (
        <span className="font-medium text-v2-ink-mute">{t('customer-app:v2.result.closed')}</span>
      ) : null}
      {facts.map((fact, position) => (
        <span key={fact} className="text-v2-ink-soft">
          {/*
            `mx`, not `me`. As a flex container the strip had `gap-x-1.5` doing
            the work on the leading side; as an inline block that gap is gone
            and JSX collapses the whitespace between elements, so a margin-end
            alone rendered "Ouvert· dès 25,00 €" with the dot welded to the word
            before it.
          */}
          {(isOpenNow !== null || position > 0) && (
            <span aria-hidden="true" className="mx-1.5 text-v2-ink-mute">
              ·
            </span>
          )}
          {fact}
        </span>
      ))}
    </p>
  )
}
