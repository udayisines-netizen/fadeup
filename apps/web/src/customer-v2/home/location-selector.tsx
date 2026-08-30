import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Globe, LocateFixed, MapPin } from 'lucide-react'
import { ANYWHERE } from '@/lib/intl/country-preference'
import { PRECISE_RADIUS_KM, type CustomerLocation } from '@/customer-v2/hooks/use-customer-location'

/**
 * Where the customer is looking, as one chip.
 *
 * ============================================================================
 * WHAT THE FIRST HUMAN REVIEW REJECTED
 * ============================================================================
 *
 * The first pass put a country name and a permanent 44px "Use my location"
 * button side by side above the headline, and the review's objection was exact:
 * too country-oriented, visually heavy, and a large standing action next to a
 * label that was not itself interactive. Two controls competing at the very top
 * of the first screen, neither of which is what the customer came to do.
 *
 * So the whole thing collapsed into one 32px chip that states the current scope
 * and opens a menu containing every scope FadeUp can actually offer. The scopes
 * are mutually exclusive, so the menu is a radio group rather than a pile of
 * buttons — choosing one IS the interaction, and "Use my location" stops being
 * a permanent fixture and becomes one option among three.
 *
 * ============================================================================
 * WHY THIS STILL SAYS "FRANCE" AND NOT "CRÉTEIL"
 * ============================================================================
 *
 * The review asked for a locality — Créteil, Antony, Paris 8e — where truthful
 * location data permits. It does not permit, and the reason is worth stating
 * precisely rather than quietly falling back.
 *
 * FadeUp resolves a customer's position two ways and neither produces a
 * locality. `locale-detect` reads the address nginx forwarded and returns an
 * ISO country code; its own source notes it carries "a country code and never
 * coordinates, city or ASN". `navigator.geolocation` returns a latitude and a
 * longitude, and a grep of the entire repository finds no reverse geocoder
 * behind them. Printing a district name would therefore be inventing one, which
 * is the same class of failure as inventing availability.
 *
 * What FadeUp does know at locality resolution is where the RESULTS are, and
 * that is real: every row carries its own `city`, and each one prints it. So a
 * customer in France sees "Antony (92)" on the listing rather than in the
 * header — attached to the thing it is actually true of.
 *
 * The compact honest fallback the review allows for is the country name, in the
 * reader's own language, in a chip that no longer dominates anything.
 *
 * ============================================================================
 * THE WAY BACK IS INSIDE THE MENU
 * ============================================================================
 *
 * "Search everywhere" writes `fadeup-country-explicit` permanently, and the
 * CANONICAL customer product reads that key too — `discover-page`,
 * `search-page` and `marketplace-search-page` all filter on it. Offering that
 * door without the return trip would let one tap in an unapproved preview
 * change the approved product's country filter forever. Because the menu is a
 * radio group over all three scopes, the way back is structural: whatever is in
 * force, the alternatives are always one tap away and the current one is
 * checked.
 *
 * ============================================================================
 * DENIAL IS A STATE, NOT AN ERROR
 * ============================================================================
 *
 * A customer who refuses the permission prompt has not broken anything: the
 * country-level search behind them is still a working marketplace. The refusal
 * is one calm sentence at the foot of the menu — in the menu, because that is
 * where the decision was made and where it can be revisited — rather than a
 * line of apology permanently occupying the page. A device with no geolocation
 * at all gets a different sentence, because retrying cannot help it.
 */

/** The three scopes FadeUp can genuinely search at. */
type LocationScope = 'precise' | 'country' | 'anywhere'

export function LocationSelector({ location }: { location: CustomerLocation }) {
  const { t } = useTranslation()

  const locating = location.preciseStatus === 'locating'

  const scope: LocationScope =
    location.precision === 'precise' ? 'precise' : location.isAnywhere ? 'anywhere' : 'country'

  const label =
    scope === 'precise'
      ? t('customer-app:v2.location.nearYouShort')
      : (location.countryLabel ?? t('customer-app:v2.location.everywhere'))

  const ScopeIcon = scope === 'precise' ? LocateFixed : scope === 'anywhere' ? Globe : MapPin

  function choose(next: string) {
    if (next === 'precise') {
      location.requestPrecise()
      return
    }

    // Both remaining scopes are country-level, so any precise fix in force has
    // to be released first — otherwise the radius would keep filtering under a
    // label that no longer mentions it.
    location.clearPrecise()
    location.chooseCountry(next === 'anywhere' ? ANYWHERE : null)
  }

  return (
    <DropdownMenu.Root>
      {/*
        THE CHIP IS 32px AND THE TARGET IS 44px.

        Browser QA caught the first revision shipping this as a 105×32 control,
        which passes WCAG 2.5.8's 24px floor and fails FadeUp's own bar of 44px
        for every control a thumb can reach. Both numbers matter and they are
        not in conflict: the BUTTON is 44px tall and transparent, the chip
        inside it is the 32px thing you see. Nothing about the compact look is
        given up to make the target honest.
      */}
      <DropdownMenu.Trigger
        className="v2-press inline-flex h-11 max-w-full items-center rounded-v2-2"
        disabled={locating}
      >
        <span className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-v2-2 border border-v2-hairline bg-v2-paper ps-2.5 pe-2 text-v2-meta font-medium text-v2-ink">
          <ScopeIcon className="h-4 w-4 shrink-0 text-v2-ink-mute" strokeWidth={1.8} aria-hidden="true" />
          {/*
            The accessible name becomes "Location: France", so a screen-reader
            user hears what the control is before hearing its value. The visible
            chip stays two words wide.
          */}
          <span className="sr-only">{t('customer-app:v2.location.fieldLabel')}</span>
          <span className="truncate">{locating ? t('customer-app:v2.location.locating') : label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-v2-ink-mute" strokeWidth={2} aria-hidden="true" />
        </span>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        {/*
          `data-fu-v2` travels with the portal. Radix renders this at the
          document root, outside the shell, so without it the menu would lose
          the V2 font stack and — more seriously — the scoped `:focus-visible`
          ring, leaving a keyboard user with no visible focus inside a menu.
        */}
        <DropdownMenu.Content
          data-fu-v2
          align="start"
          sideOffset={6}
          className="v2-plate z-40 min-w-[15rem] max-w-[calc(100vw-2rem)] overflow-hidden py-1 text-v2-ink"
        >
          <DropdownMenu.RadioGroup value={scope} onValueChange={choose}>
            <ScopeItem
              value="precise"
              icon={LocateFixed}
              label={t('customer-app:v2.location.useMyLocation')}
              hint={t('customer-app:v2.location.withinRadius', { radius: PRECISE_RADIUS_KM })}
            />

            {/*
              Only offered when detection actually resolved a country. With no
              country there is nothing for this option to mean, and an item
              reading "Everywhere" twice is not a choice.
            */}
            {location.countryLabel ? (
              <ScopeItem value="country" icon={MapPin} label={location.countryLabel} />
            ) : null}

            <ScopeItem value="anywhere" icon={Globe} label={t('customer-app:v2.location.everywhere')} />
          </DropdownMenu.RadioGroup>

          {location.preciseStatus === 'denied' || location.preciseStatus === 'unsupported' ? (
            <DropdownMenu.Label className="mt-1 border-t border-v2-hairline px-3 pb-1 pt-2 text-v2-caption font-normal text-v2-ink-mute">
              {location.preciseStatus === 'unsupported'
                ? t('customer-app:v2.location.unsupported')
                : t('customer-app:v2.location.denied')}
            </DropdownMenu.Label>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/**
 * One scope. 44px tall because this menu is reachable by thumb on the phone
 * that is the primary target, and Radix's own `RadioItem` carries the
 * `menuitemradio` role and checked state, so the tick renders real state rather
 * than being a decoration painted beside it.
 */
function ScopeItem({
  value,
  icon: Icon,
  label,
  hint,
}: {
  value: LocationScope
  icon: typeof MapPin
  label: string
  hint?: string
}) {
  return (
    <DropdownMenu.RadioItem
      value={value}
      className="flex min-h-11 cursor-pointer select-none items-center gap-2.5 px-3 py-2 text-v2-meta outline-none data-[highlighted]:bg-v2-fill"
    >
      <Icon className="h-4 w-4 shrink-0 text-v2-ink-mute" strokeWidth={1.8} aria-hidden="true" />
      <span className="flex-1">
        <span className="block font-medium">{label}</span>
        {hint ? <span className="block text-v2-caption text-v2-ink-mute">{hint}</span> : null}
      </span>
      <DropdownMenu.ItemIndicator>
        <Check className="h-4 w-4 shrink-0 text-v2-green" strokeWidth={2.2} aria-hidden="true" />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  )
}
