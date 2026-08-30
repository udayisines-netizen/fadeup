/**
 * Where the R5R greenfield customer experience lives while it is a preview.
 *
 * ============================================================================
 * WHY A PREVIEW PREFIX AND NOT /app/customer
 * ============================================================================
 *
 * `/app/customer` is the canonical customer product and it works today.
 * GREENFIELD_RULES.md §14 and CLAUDE.md's legacy-safety rule both say the same
 * thing: the replacement is not the source of truth until a human has approved
 * actual browser rendering, and the working surface is not removed before the
 * replacement is verified. Mounting this over `/app/customer` now would swap a
 * verified experience for an unapproved one on the strength of a green test
 * suite, which is precisely the substitution R5R exists to prevent.
 *
 * So the greenfield mounts beside it. `_preview` is a real, unambiguous path
 * segment — no router conflict with `app`, `s`, `search` or any existing
 * branch — and the leading underscore reads as "not a product URL" to anyone
 * who encounters it in a log or a bug report.
 *
 * ============================================================================
 * WHY IT IS NOT BEHIND RequireAuth
 * ============================================================================
 *
 * Home's data is `search_public_professionals`, which is granted to `anon` and
 * needs no session. Wrapping the preview in `RequireAuth` would gate a public
 * marketplace behind a login and — as the R5R.0 audit found when `/app/customer`
 * redirected every one of its browser probes — would make the surface
 * impossible to review in a browser at all, which is the one thing this lot
 * must deliver.
 *
 * The auth-dependent parts degrade instead of demanding: the notification
 * count queries nothing without a user id, and every result's Book action goes
 * to the existing public booking flow, which has always been anonymous.
 *
 * ============================================================================
 * PATHS ARE DECLARED ONCE
 * ============================================================================
 *
 * The shell, the navigation and the router all read from here, so moving the
 * preview — or promoting it to the canonical path after approval — is one edit
 * rather than a search for string literals.
 */

const PREVIEW_ROOT = '/_preview/r5r'

export const V2_ROUTES = {
  root: PREVIEW_ROOT,
  home: PREVIEW_ROOT,
  marketplace: `${PREVIEW_ROOT}/marketplace`,
  book: `${PREVIEW_ROOT}/book`,
  appointments: `${PREVIEW_ROOT}/appointments`,
  profile: `${PREVIEW_ROOT}/profile`,
  queue: `${PREVIEW_ROOT}/queue`,
} as const

/**
 * Detail routes take builders rather than constants, so a caller can never
 * assemble a preview path by string concatenation in one file and drift from
 * the router's declaration in another.
 */
export const v2BookingPath = (
  organizationSlug: string,
  context: {
    locationId?: string | null
    barberId?: string | null
    /* A service the customer already chose on a profile is carried in, so the
       flow never asks for the same decision twice. */
    serviceId?: string | null
  } = {},
) => {
  const params = new URLSearchParams()
  if (context.locationId) params.set('location', context.locationId)
  if (context.barberId) params.set('barber', context.barberId)
  if (context.serviceId) params.set('service', context.serviceId)
  const query = params.toString()
  return `${PREVIEW_ROOT}/s/${organizationSlug}/book${query ? `?${query}` : ''}`
}

export const v2ShopProfilePath = (organizationSlug: string, locationId?: string | null) => {
  const params = new URLSearchParams()
  if (locationId) params.set('location', locationId)
  const query = params.toString()
  return `${PREVIEW_ROOT}/s/${organizationSlug}${query ? `?${query}` : ''}`
}

export const v2BarberProfilePath = (organizationSlug: string, barberId: string) =>
  `${PREVIEW_ROOT}/s/${organizationSlug}/b/${barberId}`

/** The router mounts the shell at this path; children are relative to it. */
export const V2_ROUTE_PATH = PREVIEW_ROOT.slice(1)
