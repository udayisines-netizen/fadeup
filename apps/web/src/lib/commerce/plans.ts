/**
 * FadeUp's commercial plan catalog — plan identities and what each one packages.
 *
 * This module is the ONE place that answers "which plans exist" and "what does
 * this plan include". Money lives next door in `pricing.ts`, which imports from
 * here; nothing imports back, so there is a single direction of truth:
 *
 *     plans.ts  (identity + packaging)  ->  pricing.ts  (region + amount)
 *
 * Three rules this file exists to enforce.
 *
 * 1. FADE PASSPORT IS IN EVERY PLAN. It is a network feature — a customer owns
 *    their Passport and carries it between shops — so paywalling it would break
 *    the thing that makes it worth having. `assertPassportEverywhere()` below is
 *    executed by the test suite precisely so this cannot regress quietly.
 *
 * 2. RETENTION IS PRO-LEVEL. Remembering a customer is included; actively
 *    analysing, predicting and automating their return is what Pro-and-above
 *    pays for. Encoded once, here, not as `plan === 'shop_pro'` scattered
 *    through a dozen components.
 *
 * 3. NOTHING UNBUILT IS ADVERTISED AS AVAILABLE. Every capability carries a
 *    `status`. `live` means the feature exists in this repository today and was
 *    verified against the routes and migrations. `planned` means the packaging
 *    decision is made but the product is not shipped — the marketing surface
 *    must render those distinctly and must never count them as included. See
 *    `docs/design-2026/for-business.md` for the audit behind each status.
 *
 * A note on what this is NOT: this is a DISPLAY and PACKAGING matrix. It is not
 * authorization. Since R2 the database holds the same catalog in
 * `commercial_plans` / `commercial_capabilities` / `plan_capabilities`, and THAT
 * is what triggers and RLS consult. A client-side capability lookup answers
 * "what should this pricing page say", never "may this request proceed".
 *
 * The two catalogs are kept in step by `catalog.test.ts`, which parses the
 * migration and compares it to this file key by key and price by price. If they
 * ever disagree the test fails — which is the only reason it is safe to keep a
 * compiled copy at all.
 */

/**
 * Which marketing narrative the /for-business page is telling. Presentation
 * only, never persisted, and deliberately NOT the same axis as the commercial
 * family below: `barbershop` is a story about a shop floor, `salon` is a
 * statement about what FadeUp is owed.
 */
export type BusinessMode = 'independent' | 'barbershop' | 'multi_location'

export const BUSINESS_MODES: BusinessMode[] = ['independent', 'barbershop', 'multi_location']

/**
 * The commercial family — the durable axis, mirroring the
 * `public.commercial_family` enum exactly.
 *
 * Kept separate from BusinessMode because they answer different questions and
 * will diverge: a hair salon and a barbershop tell different marketing stories
 * and buy the same `salon` plans.
 */
export type CommercialFamily = 'free' | 'independent' | 'salon' | 'multi_salon'

/**
 * Durable machine identities. These strings are the primary key of
 * `public.commercial_plans` and are the only thing business logic may branch on.
 *
 * `salon_pro` and `multi_pro` are BOTH displayed as "Pro" and are different
 * products at different prices, so branching on the label is always a bug.
 * Branching on the price is also a bug: the regional table in pricing.ts
 * already gives one plan several amounts.
 */
export type PlanId =
  | 'free'
  | 'solo'
  | 'salon_essential'
  | 'salon_pro'
  | 'salon_business'
  | 'multi_growth'
  | 'multi_pro'
  | 'multi_scale'

/**
 * Stable capability identifiers.
 *
 * These are keys, not labels. The translated string a visitor reads is looked
 * up from the id; the id itself never changes with locale, which is why a
 * feature comparison can be built in ten languages from one matrix.
 */
export type CapabilityId =
  // --- foundation: every plan ---
  | 'marketplace'
  | 'publicProfile'
  | 'services'
  | 'availability'
  | 'booking'
  | 'customers'
  | 'customerHistory'
  | 'passport'
  | 'manualRebook'
  | 'notifications'
  // --- shop floor ---
  | 'walkIns'
  | 'team'
  | 'liveQueue'
  | 'queueDisplay'
  | 'chairs'
  | 'chairMode'
  | 'waitlist'
  // --- retention suite ---
  | 'returnCycles'
  | 'comebackReminders'
  | 'inactiveCustomers'
  | 'customerSegments'
  | 'retentionAutomation'
  | 'retentionInsights'
  // --- scale ---
  | 'multiLocation'
  | 'locationSwitching'
  | 'crossLocationView'
  | 'advancedPermissions'
  | 'advancedBookingRules'
  | 'advancedReporting'
  | 'prioritySupport'

/**
 * `live`    — shipped in this repository, verified against routes + migrations.
 * `planned` — packaged and priced, but not built. Never shown as included.
 */
export type CapabilityStatus = 'live' | 'planned'

export type CapabilityGroup = 'foundation' | 'floor' | 'retention' | 'scale'

export interface Capability {
  id: CapabilityId
  group: CapabilityGroup
  status: CapabilityStatus
  /**
   * Why this status. Kept in code rather than a wiki because the honesty rule
   * only holds if the next person can see what was checked.
   */
  evidence: string
}

export const CAPABILITIES: Record<CapabilityId, Capability> = {
  /* ------------------------------------------------------------ foundation */
  marketplace: {
    id: 'marketplace',
    group: 'foundation',
    status: 'live',
    evidence: 'search_public_organizations RPC + /search + marketplace_visible opt-in',
  },
  publicProfile: {
    id: 'publicProfile',
    group: 'foundation',
    status: 'live',
    evidence: '/s/:slug shop profile and /s/:slug/barbers/:id barber profile',
  },
  services: {
    id: 'services',
    group: 'foundation',
    status: 'live',
    evidence: 'services, service_categories, service_locations, barber_services',
  },
  availability: {
    id: 'availability',
    group: 'foundation',
    status: 'live',
    evidence: 'location_hours, barber_working_hours, barber_availability_exceptions',
  },
  booking: {
    id: 'booking',
    group: 'foundation',
    status: 'live',
    evidence: 'appointments + get_public_available_slots + book_public_appointment',
  },
  customers: {
    id: 'customers',
    group: 'foundation',
    status: 'live',
    evidence: 'customers table + /app/customers',
  },
  customerHistory: {
    id: 'customerHistory',
    group: 'foundation',
    status: 'live',
    evidence: 'appointments linked to customers; per-customer visit list',
  },
  passport: {
    id: 'passport',
    group: 'foundation',
    status: 'live',
    evidence: 'customer_passports + photos + shares (customer-owned, portable)',
  },
  manualRebook: {
    id: 'manualRebook',
    group: 'foundation',
    status: 'live',
    evidence: 'booking a known customer again from the shop or the customer app',
  },
  notifications: {
    id: 'notifications',
    group: 'foundation',
    status: 'live',
    evidence: 'transactional booking/queue confirmations via Supabase auth + queue state',
  },

  /* ----------------------------------------------------------------- floor */
  walkIns: {
    id: 'walkIns',
    group: 'floor',
    status: 'live',
    evidence: '/s/:slug/walk-in public walk-in intake',
  },
  team: {
    id: 'team',
    group: 'floor',
    status: 'live',
    evidence: 'memberships (owner/manager/receptionist/barber) + invitations',
  },
  liveQueue: {
    id: 'liveQueue',
    group: 'floor',
    status: 'live',
    evidence: 'queue_entries + realtime + /app/queue + get_my_queue_status',
  },
  queueDisplay: {
    id: 'queueDisplay',
    group: 'floor',
    status: 'live',
    evidence: '/s/:slug/display in-shop queue screen',
  },
  chairs: {
    id: 'chairs',
    group: 'floor',
    status: 'live',
    evidence: 'chairs table + /app/chairs',
  },
  chairMode: {
    id: 'chairMode',
    group: 'floor',
    status: 'planned',
    evidence:
      'GAP: no dedicated at-the-chair surface. queue_status reaches in_service and chairs exist, ' +
      'but chairs are not joined to queue_entries and there is no barber-facing chair screen.',
  },
  waitlist: {
    id: 'waitlist',
    group: 'floor',
    status: 'live',
    evidence: 'waitlist + no-show rules migration + /app/waitlist',
  },

  /* ------------------------------------------------------------- retention */
  returnCycles: {
    id: 'returnCycles',
    group: 'retention',
    status: 'planned',
    evidence: 'GAP: no return-cycle or days-since-last-cut computation anywhere in db/migrations.',
  },
  comebackReminders: {
    id: 'comebackReminders',
    group: 'retention',
    status: 'planned',
    evidence: 'GAP: no scheduled outbound messaging exists.',
  },
  inactiveCustomers: {
    id: 'inactiveCustomers',
    group: 'retention',
    status: 'planned',
    evidence: 'GAP: no inactivity detection.',
  },
  customerSegments: {
    id: 'customerSegments',
    group: 'retention',
    status: 'planned',
    evidence: 'GAP: no segmentation model.',
  },
  retentionAutomation: {
    id: 'retentionAutomation',
    group: 'retention',
    status: 'planned',
    evidence: 'GAP: no automation engine.',
  },
  retentionInsights: {
    id: 'retentionInsights',
    group: 'retention',
    status: 'planned',
    evidence: 'GAP: no retention analytics.',
  },

  /* ----------------------------------------------------------------- scale */
  multiLocation: {
    id: 'multiLocation',
    group: 'scale',
    status: 'live',
    evidence: 'locations are 1:N under an organization; services/hours/queues are location-scoped',
  },
  locationSwitching: {
    id: 'locationSwitching',
    group: 'scale',
    status: 'live',
    evidence: 'active-location scope across /app + invitation_location_scope',
  },
  crossLocationView: {
    id: 'crossLocationView',
    group: 'scale',
    status: 'live',
    evidence: 'owner/manager read across every location of their own organization via RLS',
  },
  advancedPermissions: {
    id: 'advancedPermissions',
    group: 'scale',
    status: 'planned',
    evidence: 'GAP: membership_role is a fixed four-value enum; no per-capability grants.',
  },
  advancedBookingRules: {
    id: 'advancedBookingRules',
    group: 'scale',
    status: 'planned',
    evidence: 'GAP: beyond hours/no-show rules there is no configurable booking policy engine.',
  },
  advancedReporting: {
    id: 'advancedReporting',
    group: 'scale',
    status: 'planned',
    evidence: 'GAP: no reporting or analytics surface exists.',
  },
  prioritySupport: {
    id: 'prioritySupport',
    group: 'scale',
    status: 'planned',
    evidence: 'GAP: no support tiering is in place operationally.',
  },
}

/** The capabilities that together make up the Retention Suite. */
export const RETENTION_SUITE: CapabilityId[] = [
  'returnCycles',
  'comebackReminders',
  'inactiveCustomers',
  'customerSegments',
  'retentionAutomation',
  'retentionInsights',
]

/** Included in every plan, without exception. Passport is the anchor of this set. */
const FOUNDATION: CapabilityId[] = [
  'marketplace',
  'publicProfile',
  'services',
  'availability',
  'booking',
  'customers',
  'customerHistory',
  'passport',
  'manualRebook',
  'notifications',
]

/** Running a floor: several barbers, walk-ins arriving, chairs filling. */
const FLOOR: CapabilityId[] = ['walkIns', 'team', 'liveQueue', 'queueDisplay', 'chairs', 'chairMode', 'waitlist']

const MULTI_CORE: CapabilityId[] = ['multiLocation', 'locationSwitching', 'crossLocationView']

const ADVANCED_CONTROL: CapabilityId[] = [
  'advancedPermissions',
  'advancedBookingRules',
  'advancedReporting',
  'prioritySupport',
]

/**
 * Free is the network tier, and it is a strict SUBSET rather than "foundation
 * minus a couple of things": be findable, show what you do and when, keep your
 * Fade Passport. No booking, no customer records, no team, no queue.
 *
 * That is what makes Solo at 19 € an upgrade rather than a formality, and it is
 * the honest reading of "Soyez visible. Commencez à construire votre présence."
 */
const FREE_SET: CapabilityId[] = ['marketplace', 'publicProfile', 'services', 'availability', 'passport']

export interface Plan {
  id: PlanId
  /** The durable commercial axis. Mirrors public.commercial_plans.commercial_family. */
  family: CommercialFamily
  /**
   * Which marketing rail this plan appears on, or null for a plan that is not
   * on one. Free is null: it is surfaced as the network state beneath the
   * rail, not as a fourth column competing with the paid plans.
   */
  mode: BusinessMode | null
  /** Position within its family, cheapest first. Drives the plan rail order. */
  tier: number
  /** The family's recommended plan — exactly one per family that offers a choice. */
  recommended: boolean
  capabilities: CapabilityId[]
  /**
   * Commercial cap on ACTIVE establishments, mirroring
   * public.commercial_plans.max_establishments.
   *
   * Deliberately data, not a sentence buried in JSX: the number is shown in the
   * UI through a translated template, so changing the commercial limit is a
   * one-line edit here rather than an edit in ten locale files.
   *
   * A CAP, never a billed quantity. FadeUp does not charge per location, and
   * nothing multiplies a price by this number.
   */
  maxEstablishments: number
  /**
   * Commercial cap on ACTIVE operational professionals, or null for unlimited —
   * which is how "team is included" is spelled. Mirrors
   * public.commercial_plans.max_operational_professionals.
   *
   * Deliberately null rather than a large number: a large number is a
   * multiplier waiting to be discovered.
   */
  maxOperationalProfessionals: number | null
}

function plan(
  id: PlanId,
  family: CommercialFamily,
  mode: BusinessMode | null,
  tier: number,
  capabilities: CapabilityId[],
  options: {
    recommended?: boolean
    maxEstablishments: number
    maxOperationalProfessionals?: number | null
  },
): Plan {
  return {
    id,
    family,
    mode,
    tier,
    recommended: options.recommended ?? false,
    // Deduplicate and keep a stable order, so a comparison table built from two
    // different plans lines its rows up without extra sorting.
    capabilities: Array.from(new Set(capabilities)),
    maxEstablishments: options.maxEstablishments,
    maxOperationalProfessionals: options.maxOperationalProfessionals ?? null,
  }
}

/**
 * Free is a legitimate state, not an error one: not an expiry, not a failed
 * trial, not a lapsed subscription. One presence, one professional.
 */
const FREE = plan('free', 'free', null, 1, FREE_SET, {
  maxEstablishments: 1,
  maxOperationalProfessionals: 1,
})

/**
 * Independent Solo is NOT a crippled salon plan. It is a smaller product for
 * one person: the whole foundation, plus walk-ins and the live queue for a
 * barber who takes people off the street, and none of the team/chair machinery
 * that would only be noise for someone working alone.
 *
 * Exactly one operational professional, and that cap is real: the database
 * refuses the second one.
 */
const SOLO = plan('solo', 'independent', 'independent', 1, [...FOUNDATION, 'walkIns', 'liveQueue'], {
  maxEstablishments: 1,
  maxOperationalProfessionals: 1,
})

/** Essential is a real entry-level salon product, not a demo of what you cannot have. */
const SALON_ESSENTIAL = plan(
  'salon_essential',
  'salon',
  'barbershop',
  1,
  [...FOUNDATION, 'walkIns', 'team'],
  { maxEstablishments: 1 },
)

/** Pro is the core FadeUp salon experience: the floor runs live, and customers come back. */
const SALON_PRO = plan(
  'salon_pro',
  'salon',
  'barbershop',
  2,
  [...FOUNDATION, ...FLOOR, ...RETENTION_SUITE],
  { recommended: true, maxEstablishments: 1 },
)

const SALON_BUSINESS = plan(
  'salon_business',
  'salon',
  'barbershop',
  3,
  [...FOUNDATION, ...FLOOR, ...RETENTION_SUITE, ...ADVANCED_CONTROL],
  { maxEstablishments: 1 },
)

/** Growth runs several salons properly. Retention is what Multi Pro adds on top. */
const MULTI_GROWTH = plan(
  'multi_growth',
  'multi_salon',
  'multi_location',
  1,
  [...FOUNDATION, ...FLOOR, ...MULTI_CORE],
  { maxEstablishments: 2 },
)

const MULTI_PRO = plan(
  'multi_pro',
  'multi_salon',
  'multi_location',
  2,
  [...FOUNDATION, ...FLOOR, ...MULTI_CORE, ...RETENTION_SUITE],
  { recommended: true, maxEstablishments: 5 },
)

const MULTI_SCALE = plan(
  'multi_scale',
  'multi_salon',
  'multi_location',
  3,
  [...FOUNDATION, ...FLOOR, ...MULTI_CORE, ...RETENTION_SUITE, ...ADVANCED_CONTROL],
  { maxEstablishments: 10 },
)

export const PLANS: Record<PlanId, Plan> = {
  free: FREE,
  solo: SOLO,
  salon_essential: SALON_ESSENTIAL,
  salon_pro: SALON_PRO,
  salon_business: SALON_BUSINESS,
  multi_growth: MULTI_GROWTH,
  multi_pro: MULTI_PRO,
  multi_scale: MULTI_SCALE,
}

export const PLAN_IDS = Object.keys(PLANS) as PlanId[]

/** The Free network tier, for the surfaces that present it separately. */
export const FREE_PLAN = FREE

/** The plans offered on a given marketing rail, cheapest first. Free is not on one. */
export function plansForMode(mode: BusinessMode): Plan[] {
  return PLAN_IDS.map((id) => PLANS[id])
    .filter((p) => p.mode === mode)
    .sort((a, b) => a.tier - b.tier)
}

/** The plans in a commercial family, cheapest first. */
export function plansForFamily(family: CommercialFamily): Plan[] {
  return PLAN_IDS.map((id) => PLANS[id])
    .filter((p) => p.family === family)
    .sort((a, b) => a.tier - b.tier)
}

export function familyForPlan(planId: PlanId): CommercialFamily {
  return PLANS[planId].family
}

export function recommendedPlanFor(mode: BusinessMode): Plan {
  const plans = plansForMode(mode)
  return plans.find((p) => p.recommended) ?? plans[0]!
}

/**
 * Plan keys that were canonical before R2 renamed the Salon family.
 *
 * `/pro/register?plan=shop_pro` links exist in the wild — in emails, in the
 * business landing page's own CTA history, and in anything anyone bookmarked.
 * Silently returning null for them would drop a visitor's stated intent on the
 * floor, so they are mapped forward rather than rejected. The old strings are
 * NOT valid plan identities anywhere else: nothing in the database, the
 * catalog, or any gate accepts them.
 */
const LEGACY_PLAN_ALIASES: Record<string, PlanId> = {
  shop_essential: 'salon_essential',
  shop_pro: 'salon_pro',
  shop_business: 'salon_business',
}

export function planHas(planId: PlanId, capability: CapabilityId): boolean {
  return PLANS[planId].capabilities.includes(capability)
}

/** True when the plan packages the automated Retention Suite. */
export function hasRetentionSuite(planId: PlanId): boolean {
  return RETENTION_SUITE.every((id) => planHas(planId, id))
}

/** True for every plan, by design. Kept as a function so tests can prove it. */
export function hasFadePassport(planId: PlanId): boolean {
  return planHas(planId, 'passport')
}

/**
 * Capabilities of a plan that are actually shipped, in matrix order.
 *
 * The marketing surface renders THIS, never `plan.capabilities` — that is how
 * "do not advertise what is not built" is enforced by construction rather than
 * by remembering to check a flag at each call site.
 */
export function liveCapabilities(planId: PlanId): CapabilityId[] {
  return PLANS[planId].capabilities.filter((id) => CAPABILITIES[id].status === 'live')
}

/** Packaged but unbuilt. Shown only under an explicit "on the roadmap" framing. */
export function plannedCapabilities(planId: PlanId): CapabilityId[] {
  return PLANS[planId].capabilities.filter((id) => CAPABILITIES[id].status === 'planned')
}

/**
 * Whether a string from an untrusted source (a query parameter, mostly) names a
 * real plan.
 *
 * Returning the id does NOT grant anything. `/pro/register?plan=multi_scale` is
 * a statement of intent that pre-fills a form; the application still goes to the
 * platform for approval, and entitlement will come from the server when billing
 * exists.
 */
export function parsePlanId(value: string | null | undefined): PlanId | null {
  if (!value) return null
  if ((PLAN_IDS as string[]).includes(value)) return value as PlanId
  return LEGACY_PLAN_ALIASES[value] ?? null
}

/** Which marketing rail a plan belongs to, or null for Free, which is on none. */
export function modeForPlan(planId: PlanId): BusinessMode | null {
  return PLANS[planId].mode
}

/** Steps a mode index forward or backward, wrapping at both ends. */
export function cycleMode(current: BusinessMode, direction: 1 | -1): BusinessMode {
  const index = BUSINESS_MODES.indexOf(current)
  const next = (index + direction + BUSINESS_MODES.length) % BUSINESS_MODES.length
  return BUSINESS_MODES[next]!
}
