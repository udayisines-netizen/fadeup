import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ANYWHERE } from '@/lib/intl/country-preference'
import { useTrackView } from '@/lib/analytics'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useCustomerLocation } from '@/customer-v2/hooks/use-customer-location'
import { useHomeDiscovery } from '@/customer-v2/hooks/use-home-discovery'
import { useDebounced } from '@/customer-v2/hooks/use-delayed'
import { LocationSelector } from '@/customer-v2/home/location-selector'
import { SearchEntry } from '@/customer-v2/home/search-entry'
import { DiscoverySection } from '@/customer-v2/home/discovery-section'

/**
 * FadeUp Home — the first screen of the greenfield customer product.
 *
 * ============================================================================
 * ONE JOB
 * ============================================================================
 *
 * Get someone from "I need a cut" to a real, bookable professional. Everything
 * on the page is on the shortest path to that, in the order the blueprint sets:
 * where you are, what you are here to do, how to say it, and who is available.
 *
 *     ⌖ France ⌄
 *     Find your next barber
 *     ⌕ Search barbers, shops or a service
 *                                          [ Open now ]
 *     ┌ Barbers ───────────────────── 1 ─┐
 *     │ ◯  Barber Test ✓                 │
 *     │    Side Agency · Antony (92)     │
 *     │    Open · from €25.00     [Book] │
 *     └──────────────────────────────────┘
 *     ┌ Barbershops ───────────────── 1 ─┐
 *     │ ▢  Side Agency                   │
 *     │    19 rue Danton · Antony (92)   │
 *     │    Open · from €25.00     [Book] │
 *     └──────────────────────────────────┘
 *
 * ============================================================================
 * WHAT THE FIRST HUMAN REVIEW CHANGED HERE
 * ============================================================================
 *
 * THE HERO SHRANK. "Find your next barber" was a 32px display headline on a
 * phone and 44px on a laptop — a marketing hero on an application Home, and the
 * single biggest reason discovery content started so far down the page. It is
 * now a 20px page title, one line, unchanged in wording because the blueprint
 * is explicit that this is the first thing a customer should understand. The
 * header zone above the first result went from roughly 200px to roughly 120px
 * on a 390px viewport, which is the density the review asked for and none of it
 * came out of the content.
 *
 * THE FILTER LEFT THE HEADER. A 44px bordered "Open now" control sitting
 * directly under the search field made Home look like a half-built filter page.
 * It is now a 32px chip in the group toolbar, still driving `p_open_now_only`
 * server-side. See `discovery-section.tsx` for why it survived at all rather
 * than being deleted.
 *
 * THE LOCATION STOPPED BEING TWO CONTROLS. A country label with a permanent
 * "Use my location" button beside it became one chip that opens a scope menu.
 * See `location-selector.tsx`, including why the chip still says "France"
 * rather than a locality.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY STILL NOT HERE
 * ============================================================================
 *
 * No stories, no "Available now" carousel and no social feed above the fold —
 * PRODUCT_UI_BLUEPRINT.md §4 rules out all three by name. No service-category
 * tiles, because they would filter into a Marketplace that does not exist yet,
 * which is the dead-end pattern R5's Discover already proved. No Follow on a
 * result: the contract is real (`follow_professional`) but it needs an
 * authenticated customer, and this preview is anonymous, so shipping a control
 * that could be neither exercised nor QA'd in this lot would be shipping an
 * assumption. The row reserves the space for it.
 *
 * The page is short, because two listings is the entire marketplace. It is not
 * padded to look fuller: the same composition carries eight results per group
 * without changing, and CLAUDE.md forbids inventing the difference.
 *
 * ============================================================================
 * DESKTOP IS A DIFFERENT COMPOSITION, NOT A WIDER ONE
 * ============================================================================
 *
 * The review's objection to the first desktop pass was that it was sparse and
 * unfinished, and the answer is NOT to stretch the rows. So the header becomes
 * a genuine band — title and location on one side, search sized to a real
 * measure on the other, using the width instead of centring a phone in it — and
 * the two discovery groups sit side by side rather than stacked, which is what
 * makes a two-row database still read as a complete page at 1440px.
 *
 * The rows inside those groups are the SAME rows as on the phone. One grammar
 * at every width was the hard-won lesson of the first pass, when a desktop-only
 * card grid turned the product into a list on a phone and a card wall on a
 * laptop. Two compositions is two design systems.
 */
export function CustomerV2HomePage() {
  const { t } = useTranslation()

  const location = useCustomerLocation()
  const [query, setQuery] = useState('')
  const [openNowOnly, setOpenNowOnly] = useState(false)

  // The input stays instant; the network waits until typing settles.
  const debouncedQuery = useDebounced(query, 300)

  const discovery = useHomeDiscovery({ location, query: debouncedQuery, openNowOnly })

  /* The same R3 funnel event the legacy Discover surface records. */
  useTrackView('discovery_viewed', { properties: { surface: 'customer_discover' } }, true)

  useDocumentMeta({
    title: t('customer-app:v2.home.documentTitle'),
    description: t('customer-app:v2.home.documentDescription'),
    // A preview route must never enter an index while the canonical customer
    // product is still the real one.
    noIndex: true,
  })

  return (
    <div className="flex flex-col">
      <div className="lg:flex lg:items-end lg:justify-between lg:gap-10">
        <div className="min-w-0">
          {/*
            THE CONTEXT ROW: where, and when.

            The facet used to have a band of its own between the search field
            and the results, and browser QA put a number on what that cost —
            44px of chrome carrying one chip, which pushed the first real result
            to 256px on a 390px viewport. Location and Open now are both scope
            controls (where am I looking, and does it have to be open right
            now), they are both 32px chips, and pairing them on one line deletes
            the band outright.

            Measured in the production build after the change: the first result
            starts at 219px at both 390 and 430, and at 186px at 1440.
          */}
          {/*
            The two chips are a PAIR — where you are looking, and whether it has
            to be open now — so they sit together.

            They were `justify-between` at first, which pinned one to each edge:
            a 300px void on desktop, and a measured 162px void at 390. Two
            controls at opposite ends of a line read as unrelated, and an
            unrelated facet floating on the right is exactly the disconnected
            filter §6 asked to remove. The desktop half was fixed and the phone
            half was left, which was the wrong half to fix first — 390 is the
            primary width.
          */}
          <div className="flex min-h-11 items-center justify-start gap-2">
            <LocationSelector location={location} />

            <button
              type="button"
              aria-pressed={openNowOnly}
              onClick={() => setOpenNowOnly((current) => !current)}
              /*
                Same 44px-target-around-a-32px-chip construction as the location
                control beside it, and for the same reason.
              */
              className="v2-press inline-flex h-11 shrink-0 items-center rounded-v2-2"
            >
              <span
                className={
                  openNowOnly
                    ? 'inline-flex h-8 items-center rounded-v2-2 bg-v2-green-tint px-3 text-v2-meta font-semibold text-v2-green-ink'
                    : 'inline-flex h-8 items-center rounded-v2-2 border border-v2-hairline bg-v2-paper px-3 text-v2-meta font-medium text-v2-ink-soft'
                }
              >
                {t('customer-app:v2.home.openNowFilter')}
              </span>
            </button>
          </div>

          {/*
            20px, and 24px only once there is a desktop band to hold it. The
            blueprint's wording, at an application's weight rather than a
            landing page's.
          */}
          <h1 className="mt-1.5 text-v2-lead font-semibold tracking-[-0.02em] text-v2-ink lg:mt-2 lg:text-[1.5rem]/[1.75rem]">
            {t('customer-app:v2.home.headline')}
          </h1>
        </div>

        {/*
          Capped rather than stretched. A search field does not get better at
          1200px — the R5R.0 audit measured a two-option toggle occupying 960px
          on the old search page, and that is what stretching everything looks
          like. What desktop gets instead is the field sitting BESIDE the title
          rather than under it, which is width doing something useful.
        */}
        <div className="mt-3.5 lg:mt-0 lg:w-full lg:max-w-[26rem] lg:shrink-0">
          <SearchEntry value={query} onChange={setQuery} />
        </div>
      </div>

      <DiscoverySection
        discovery={discovery}
        onClearFilters={() => {
          setQuery('')
          setOpenNowOnly(false)
        }}
        onSearchEverywhere={location.countryCode ? () => location.chooseCountry(ANYWHERE) : null}
      />
    </div>
  )
}
