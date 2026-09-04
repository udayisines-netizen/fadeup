/**
 * Hierarchical query-key factories — the ONLY way a V2 component names a
 * query. Hierarchy is what makes prefix invalidation work:
 * `invalidateQueries({ queryKey: bookingKeys.all })` sweeps every list and
 * every detail at once. No hand-written key arrays in components, ever.
 */

export interface BookingFilters {
  scope?: 'upcoming' | 'past'
}

export const accessKeys = {
  all: ['access'] as const,
  me: () => [...accessKeys.all, 'me'] as const,
} as const

export const entitlementKeys = {
  all: ['entitlements'] as const,
  organization: (organizationId: string) => [...entitlementKeys.all, organizationId] as const,
} as const

export const bookingKeys = {
  all: ['bookings'] as const,
  lists: () => [...bookingKeys.all, 'list'] as const,
  list: (f: BookingFilters) => [...bookingKeys.lists(), f] as const,
  detail: (id: string) => [...bookingKeys.all, 'detail', id] as const,
} as const

export const queueKeys = {
  all: ['queue'] as const,
  mine: () => [...queueKeys.all, 'mine'] as const,
  location: (locationId: string) => [...queueKeys.all, 'location', locationId] as const,
} as const

export const notificationKeys = {
  all: ['notifications'] as const,
  lists: () => [...notificationKeys.all, 'list'] as const,
} as const

export const profileKeys = {
  all: ['profiles'] as const,
  publicProfessional: (id: string) => [...profileKeys.all, 'public-professional', id] as const,
  publicByHandle: (handle: string) => [...profileKeys.all, 'public-handle', handle] as const,
} as const

export const organizationKeys = {
  all: ['organizations'] as const,
  publicBySlug: (slug: string) => [...organizationKeys.all, 'public-slug', slug] as const,
} as const
