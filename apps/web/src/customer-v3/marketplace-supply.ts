import type {
  MarketplaceProfessionalResult,
  MarketplaceSupplyType,
} from '@/lib/queries/marketplace'

/**
 * What the customer marketplace is allowed to contain.
 *
 * ============================================================================
 * THE PRODUCT RULE
 * ============================================================================
 *
 * The marketplace represents INDEPENDENTLY BOOKABLE SUPPLY. There are exactly
 * two customer-facing kinds of it:
 *
 *   INDEPENDENT   a professional operating as their own business — mobile, at
 *                 home, at the customer's home, or from their own place.
 *   BARBERSHOP    any independently bookable barbershop location.
 *
 * There is no third kind, and a location belonging to a multi-location
 * organization is a BARBERSHOP like any other.
 *
 * ============================================================================
 * THE MAPPING IS NOT HERE, AND THAT IS THE POINT
 * ============================================================================
 *
 * An earlier revision of this module owned the mapping from
 * `organizations.business_type` to those two values. It no longer does, and no
 * frontend code should reintroduce it.
 *
 * The classification is derived authoritatively in the RPC and arrives already
 * collapsed, as `marketplace_supply_type`
 * (20260830090000_marketplace_supply_type.sql). The customer contract therefore
 * never carries FadeUp's internal organization modelling: a client cannot tell
 * a `hair_salon` from a `mixed_salon`, and — the case that actually matters —
 * cannot tell that a shop belongs to a multi-location organization. That is Pro
 * topology; a branch of a chain is an ordinary barbershop to a customer.
 *
 * Keeping the mapping server-side also means the internal enum can gain values
 * without touching a single client, and that an unclassified one arrives as
 * NULL rather than as a guess.
 *
 * What is left here is the one decision the frontend still owns: WHICH ROWS ARE
 * SUPPLY AT ALL.
 *
 * ============================================================================
 * WHY A BARBER ROW IS NEVER SUPPLY
 * ============================================================================
 *
 * `search_public_professionals` emits two shapes of row, and an early Home read
 * both as supply — so a barbershop appeared once as itself and again once per
 * public team member. Three barbers at one shop would have produced four
 * results for one bookable place.
 *
 * Read the RPC's own `barber_base` and the reason is structural: it joins
 * `barbers b → organizations o → locations l`, so **every barber row is by
 * construction a member of an organization at one of its locations**. That is
 * the definition of staff. A barber row is a person who works somewhere, not a
 * business a customer can book independently of that somewhere.
 *
 * A professional who genuinely runs their own business is not an exception —
 * they are their own ORGANIZATION and reach the customer through the
 * shop-shaped row for their own location, classified `independent`.
 *
 * That makes the exclusion safe rather than lossy: `barber_base` requires
 * `o.marketplace_visible` and `l.is_active`, and `shop_base` emits a row for
 * every active location of every marketplace-visible organization, so every
 * barber row has a shop-shaped row for the very same location. Dropping barber
 * rows cannot make a bookable place disappear — only stop counting one place
 * once per team member.
 *
 * Their profiles stay valid and discoverable through the shop's team,
 * portfolio, follows, social content and direct links. They are simply not
 * separate supply.
 */

export type { MarketplaceSupplyType }

/**
 * Why a candidate is not supply. Rendered nowhere — it exists so the exclusion
 * is a named rule rather than a silent `filter`.
 */
export type IneligibleReason = 'staff-of-a-shop'

export type SupplyClassification =
  | { eligible: true; type: MarketplaceSupplyType | null }
  | { eligible: false; reason: IneligibleReason }

/**
 * Whether a marketplace row may be shown as supply, and what to call it.
 *
 * The label is passed straight through from the contract — this function
 * decides eligibility, not vocabulary. A null stays null and renders nothing.
 */
export function classifyMarketplaceSupply(
  result: Pick<MarketplaceProfessionalResult, 'entityType' | 'marketplaceSupplyType'>,
): SupplyClassification {
  if (result.entityType === 'barber') {
    return { eligible: false, reason: 'staff-of-a-shop' }
  }

  return { eligible: true, type: result.marketplaceSupplyType }
}
