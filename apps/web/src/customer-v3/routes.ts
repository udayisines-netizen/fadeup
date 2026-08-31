/**
 * Where the FadeUp V3 visual reconstruction lives while it is a preview.
 *
 * `/_preview/v3` mounts beside the canonical routes AND beside the rejected
 * R5R preview (`/_preview/r5r`). Canonical routes are untouched until the
 * product owner approves the rendered V3 direction; the R5R preview remains
 * inspectable for comparison until Phase V10 removes it.
 *
 * The public Landing sits at the namespace root because it is the anonymous
 * front door; the signed-in customer product lives one segment deeper. When
 * V3 is promoted, the root maps to `/` and the app paths keep their relative
 * shape — one edit here, not a string hunt.
 *
 * Not behind RequireAuth for the same reason as the R5R preview: discovery
 * reads `search_public_professionals` (granted to `anon`), and gating a
 * public marketplace behind login would make browser review impossible.
 * Auth-dependent regions degrade instead of demanding.
 */

const PREVIEW_ROOT = '/_preview/v3'

export const V3_ROUTES = {
  root: PREVIEW_ROOT,
  landing: PREVIEW_ROOT,
  home: `${PREVIEW_ROOT}/home`,
  marketplace: `${PREVIEW_ROOT}/marketplace`,
  book: `${PREVIEW_ROOT}/book`,
  appointments: `${PREVIEW_ROOT}/appointments`,
  profile: `${PREVIEW_ROOT}/profile`,
  queue: `${PREVIEW_ROOT}/queue`,
  pro: `${PREVIEW_ROOT}/pro`,
  proCalendar: `${PREVIEW_ROOT}/pro/calendar`,
  proCustomers: `${PREVIEW_ROOT}/pro/customers`,
  proAnalytics: `${PREVIEW_ROOT}/pro/analytics`,
  proRetention: `${PREVIEW_ROOT}/pro/retention`,
  proProfile: `${PREVIEW_ROOT}/pro/profile`,
} as const

/**
 * Detail routes are builders so no caller ever assembles a preview path by
 * hand and drifts from the router's declaration.
 */
export const v3ShopProfilePath = (organizationSlug: string, locationId?: string | null) => {
  const params = new URLSearchParams()
  if (locationId) params.set('location', locationId)
  const query = params.toString()
  return `${PREVIEW_ROOT}/s/${organizationSlug}${query ? `?${query}` : ''}`
}

export const v3BarberProfilePath = (organizationSlug: string, barberId: string) =>
  `${PREVIEW_ROOT}/s/${organizationSlug}/b/${barberId}`

export const v3BookingPath = (
  organizationSlug: string,
  context: {
    locationId?: string | null
    barberId?: string | null
    /* A service already chosen on a profile is carried in, so the flow never
       asks for the same decision twice. */
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

/** The router mounts the V3 branch at this path; children are relative to it. */
export const V3_ROUTE_PATH = PREVIEW_ROOT.slice(1)
