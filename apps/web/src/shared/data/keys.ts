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
  /** F4 — créneaux réels d'un jour (`get_public_available_slots`). */
  slots: (slug: string, locationId: string, barberId: string, serviceId: string, date: string) =>
    [...bookingKeys.all, 'slots', slug, locationId, barberId, serviceId, date] as const,
  /** F4 — barbers aptes à UN service (`list_public_barbers`). */
  barbers: (slug: string, locationId: string, serviceId: string) =>
    [...bookingKeys.all, 'barbers', slug, locationId, serviceId] as const,
  /** F4 — alternatives après expiration (`get_public_booking_alternatives`). */
  alternatives: (excludeOrganizationId: string, serviceQuery: string | null, coords: string | null) =>
    [...bookingKeys.all, 'alternatives', excludeOrganizationId, serviceQuery, coords] as const,
  /** F4 — mes demandes d'intérêt (`get_my_interest_requests`). */
  interestRequests: () => [...bookingKeys.all, 'interest-requests'] as const,
} as const

export const queueKeys = {
  all: ['queue'] as const,
  mine: () => [...queueKeys.all, 'mine'] as const,
  location: (locationId: string) => [...queueKeys.all, 'location', locationId] as const,
  /** File publique /q/:slug — entrées anonymisées, poll 6 s. */
  publicStatus: (slug: string, locationId: string) => [...queueKeys.all, 'public', slug, locationId] as const,
  /** État de service public (mode effectif, file acceptante) — poll 120 s. */
  publicServiceState: (slug: string, locationId: string) => [...queueKeys.all, 'public-state', slug, locationId] as const,
  /** Lieux publics d'une organisation, pour résoudre /q/:slug. */
  publicLocations: (slug: string) => [...queueKeys.all, 'public-locations', slug] as const,
  /** File pro d'un lieu — LA clé que le canal realtime écrit directement. */
  pro: (locationId: string) => [...queueKeys.all, 'pro', locationId] as const,
  /** Jeton QR + seuils du lieu (owner/manager/réceptionniste). */
  checkIn: (locationId: string) => [...queueKeys.all, 'check-in', locationId] as const,
  /** Modes de service côté pro. */
  proModes: (locationId: string) => [...queueKeys.all, 'pro-modes', locationId] as const,
  /** F1b — les files par barber d'un lieu, « premier disponible » en tête. */
  publicQueues: (slug: string, locationId: string) => [...queueKeys.all, 'public-queues', slug, locationId] as const,
  /** F1b — suivi de la PROPRE entrée du client (position, échéance, estimation). */
  tracking: (entryId: string) => [...queueKeys.all, 'tracking', entryId] as const,
  /** F1b — barbers du lieu côté pro (files, déplacement, réglages). */
  proBarbers: (locationId: string) => [...queueKeys.all, 'pro-barbers', locationId] as const,
  /** F1b — transparence des durées : déclaré vs observé. */
  durationInsights: (locationId: string) => [...queueKeys.all, 'duration-insights', locationId] as const,
} as const

export const setupKeys = {
  all: ['setup'] as const,
  readiness: (organizationId: string) => [...setupKeys.all, 'readiness', organizationId] as const,
  context: () => [...setupKeys.all, 'context'] as const,
} as const

export const notificationKeys = {
  all: ['notifications'] as const,
  lists: () => [...notificationKeys.all, 'list'] as const,
} as const

export const profileKeys = {
  all: ['profiles'] as const,
  publicProfessional: (id: string) => [...profileKeys.all, 'public-professional', id] as const,
  publicByHandle: (handle: string) => [...profileKeys.all, 'public-handle', handle] as const,
  /** F2 — résolution inverse : identité revendiquée -> lieu de travail public. */
  workplace: (professionalId: string) => [...profileKeys.all, 'workplace', professionalId] as const,
  /** F2 — fiche staff publique d'un barber (slug + barber_id). */
  barber: (slug: string, barberId: string) => [...profileKeys.all, 'barber', slug, barberId] as const,
  barberServices: (slug: string, barberId: string) => [...profileKeys.all, 'barber-services', slug, barberId] as const,
  serviceState: (slug: string, locationId: string, barberId: string | null) =>
    [...profileKeys.all, 'service-state', slug, locationId, barberId] as const,
  /** F2 — portfolio B4, paginé par curseur temporel. */
  posts: (handle: string) => [...profileKeys.all, 'posts', handle] as const,
  reviews: (professionalId: string) => [...profileKeys.all, 'reviews', professionalId] as const,
  reputation: (professionalId: string) => [...profileKeys.all, 'reputation', professionalId] as const,
  /** F2 — mes follows pro (état du bouton Suivre). */
  myFollowedProfessionals: () => [...profileKeys.all, 'my-followed'] as const,
} as const

export const organizationKeys = {
  all: ['organizations'] as const,
  publicBySlug: (slug: string) => [...organizationKeys.all, 'public-slug', slug] as const,
  /** F2 — profil salon : lieux, services, équipe, files, horaires, preuve sociale. */
  locations: (slug: string) => [...organizationKeys.all, 'locations', slug] as const,
  services: (slug: string, locationId: string) => [...organizationKeys.all, 'services', slug, locationId] as const,
  team: (slug: string) => [...organizationKeys.all, 'team', slug] as const,
  hours: (slug: string, locationId: string) => [...organizationKeys.all, 'hours', slug, locationId] as const,
  queues: (slug: string, locationId: string) => [...organizationKeys.all, 'queues', slug, locationId] as const,
  serviceState: (slug: string, locationId: string, barberId: string | null) =>
    [...organizationKeys.all, 'service-state', slug, locationId, barberId] as const,
  followerCount: (organizationId: string) => [...organizationKeys.all, 'follower-count', organizationId] as const,
  reputation: (organizationId: string) => [...organizationKeys.all, 'reputation', organizationId] as const,
  reviews: (organizationId: string) => [...organizationKeys.all, 'reviews', organizationId] as const,
  posts: (slug: string) => [...organizationKeys.all, 'posts', slug] as const,
  /** F2 — handle public d'un membre d'équipe revendiqué. */
  memberHandle: (professionalId: string) => [...organizationKeys.all, 'member-handle', professionalId] as const,
  /** F2 — mes follows organisation (état du bouton Suivre). */
  myFollowed: () => [...organizationKeys.all, 'my-followed'] as const,
} as const

/** F2 — URL signées des médias de posts (bucket privé B4). */
export const postMediaKeys = {
  all: ['post-media'] as const,
  signed: (sortedPaths: readonly string[]) => [...postMediaKeys.all, 'signed', sortedPaths] as const,
} as const

/** F3 — la recherche marketplace (/search) et la découverte de l'accueil. */
export const discoveryKeys = {
  all: ['discovery'] as const,
  searches: () => [...discoveryKeys.all, 'search'] as const,
  /** UNE recherche = ses arguments RPC exacts (pagination par pages infinies). */
  search: (args: Record<string, unknown>) => [...discoveryKeys.searches(), args] as const,
  /** Élargissement progressif après zéro résultat (rayon supérieur). */
  widened: (args: Record<string, unknown>) => [...discoveryKeys.all, 'widened', args] as const,
  /** Repli « par service » quand la recherche par nom ne rend rien. */
  serviceFallback: (args: Record<string, unknown>) => [...discoveryKeys.all, 'service-fallback', args] as const,
  /** Devises par organisation pour les prix « à partir de » des rangées. */
  currencies: (organizationIds: readonly string[]) => [...discoveryKeys.all, 'currencies', organizationIds] as const,
} as const

/** P1PRO — l'OS professionnel : accueil, demandes, historique. */
export const proKeys = {
  all: ['pro'] as const,
  /** Demandes pending d'une organisation (`get_booking_requests`). */
  requests: (organizationId: string) => [...proKeys.all, 'requests', organizationId] as const,
  /** Demandes traitées avec leur issue (`get_booking_request_history`). */
  requestHistory: (organizationId: string) => [...proKeys.all, 'request-history', organizationId] as const,
  /** Agenda du jour de l'accueil (`get_calendar_appointments`, fenêtre locale). */
  today: (organizationId: string, day: string) => [...proKeys.all, 'today', organizationId, day] as const,
  /** Résumé de file de l'accueil (`queue_entries` org, RLS). */
  queueSummary: (organizationId: string) => [...proKeys.all, 'queue-summary', organizationId] as const,
  /** OS-1 — l'identité barber du compte connecté dans l'organisation. */
  myBarber: (organizationId: string, userId: string) => [...proKeys.all, 'my-barber', organizationId, userId] as const,
  /** OS-1 — les fauteuils de l'organisation (barbers + fiche staff + membership). */
  barbers: (organizationId: string) => [...proKeys.all, 'barbers', organizationId] as const,
  /** OS-1 — l'agenda fenêtré (`get_calendar_appointments`), TOUTES les clés d'une organisation sous `agendas`. */
  agendas: (organizationId: string) => [...proKeys.all, 'agenda', organizationId] as const,
  agenda: (organizationId: string, from: string, to: string, locationId = '', barberId = '') =>
    [...proKeys.agendas(organizationId), from, to, locationId, barberId] as const,
  /** OS-1 — les blocages de temps fenêtrés (`time_blocks`, RLS). */
  timeBlocks: (organizationId: string, from: string, to: string) =>
    [...proKeys.all, 'time-blocks', organizationId, from, to] as const,
  /** OS-1 — services actifs d'un lieu et aptitudes barber/service (réservation manuelle). */
  services: (organizationId: string, locationId: string) => [...proKeys.all, 'services', organizationId, locationId] as const,
} as const

/**
 * P1PRO — capacité de réservation PUBLIQUE (« Réservable » vs « Sur
 * demande »). Une seule famille de clés pour le tunnel, la découverte et les
 * profils : arriver sur le profil depuis la recherche part d'un cache chaud.
 */
export const capabilityKeys = {
  all: ['booking-capability'] as const,
  organization: (slug: string) => [...capabilityKeys.all, slug] as const,
  batch: (sortedSlugs: readonly string[]) => [...capabilityKeys.all, 'batch', sortedSlugs] as const,
} as const

/** Clés des compositions /demo (P1c) — mêmes règles que le produit. */
export const demoKeys = {
  all: ['demo'] as const,
  discovery: (filters: Record<string, string | boolean | undefined>) => [...demoKeys.all, 'discovery', filters] as const,
  organization: (slug: string) => [...demoKeys.all, 'org', slug] as const,
  barber: (slug: string, barberId: string) => [...demoKeys.all, 'barber', slug, barberId] as const,
  barberServices: (slug: string, barberId: string) => [...demoKeys.all, 'barber-services', slug, barberId] as const,
  serviceState: (slug: string, locationId: string, barberId?: string) =>
    [...demoKeys.all, 'service-state', slug, locationId, barberId ?? null] as const,
  professional: (professionalId: string) => [...demoKeys.all, 'professional', professionalId] as const,
  handleProbe: (handle: string) => [...demoKeys.all, 'handle', handle] as const,
  proContext: () => [...demoKeys.all, 'pro-context'] as const,
  proAgenda: (organizationId: string, day: string) => [...demoKeys.all, 'pro-agenda', organizationId, day] as const,
  proQueue: (organizationId: string) => [...demoKeys.all, 'pro-queue', organizationId] as const,
  proModes: (locationId: string) => [...demoKeys.all, 'pro-modes', locationId] as const,
} as const
