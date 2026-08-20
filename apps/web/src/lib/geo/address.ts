/**
 * Addresses, formatted once.
 *
 * Three pages were each joining the same six nullable columns with their own
 * slightly different rules — one included the postal code, one did not, one
 * dropped `addressLine2` entirely. An address printed differently on the
 * profile and in the booking summary reads as two different shops.
 */

export interface AddressParts {
  name?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
}

/** Street through postal code. Null when the shop published no address at all. */
export function formatFullAddress(parts: AddressParts): string | null {
  const present = [parts.addressLine1, parts.addressLine2, parts.city, parts.region, parts.postalCode].filter(
    (part): part is string => Boolean(part && part.trim()),
  )
  return present.length > 0 ? present.join(', ') : null
}

/** Just enough to say where this is — for a card, beside a name. */
export function formatShortAddress(parts: AddressParts): string | null {
  const present = [parts.addressLine1, parts.city].filter((part): part is string => Boolean(part && part.trim()))
  return present.length > 0 ? present.join(', ') : null
}

/**
 * A maps search link, or null when there is nothing to search for.
 *
 * `google.com/maps/search/?api=1` is the documented, key-less deep link, and
 * it hands off to whatever the device actually uses for maps. FadeUp embeds
 * no map: an embed needs an API key, a consent story and a tile budget, and
 * a link does the one thing a customer wants from a shop address.
 *
 * The shop NAME is included in the query — a search for "Le Fade Parisien,
 * 12 Rue des Rosiers, Paris" resolves far more reliably than the street line
 * alone when a building holds several businesses.
 */
export function directionsUrl(parts: AddressParts): string | null {
  const address = formatFullAddress(parts)
  if (!address) return null
  const query = [parts.name, address].filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}
