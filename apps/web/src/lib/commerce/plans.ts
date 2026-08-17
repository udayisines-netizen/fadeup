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
 * authorization. There is no subscription table in the database today, and when
 * there is, entitlement will be decided server-side. A client-side capability
 * lookup answers "what should this pricing page say", never "may this request
 * proceed".
 */

export type BusinessMode = 'independent' | 'barbershop' | 'multi_location'

export const BUSINESS_MODES: BusinessMode[] = ['independent', 'barbershop', 'multi_location']

export type PlanId =
  | 'solo'
  | 'shop_essential'
  | 'shop_pro'
  | 'shop_business'
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

export interface Plan {
  id: PlanId
  mode: BusinessMode
  /** Position within its family, cheapest first. Drives the plan rail order. */
  tier: number
  /** The family's recommended plan — exactly one per mode. */
  recommended: boolean
  capabilities: CapabilityId[]
  /**
   * Commercial location cap, or null for "not applicable / unlimited".
   *
   * Deliberately data, not a sentence buried in JSX: the number is shown in the
   * UI through a translated template, so changing the commercial limit is a
   * one-line edit here rather than an edit in ten locale files.
   */
  locationLimit: number | null
}

function plan(
  id: PlanId,
  mode: BusinessMode,
  tier: number,
  capabilities: CapabilityId[],
  options: { recommended?: boolean; locationLimit?: number | null } = {},
): Plan {
  return {
    id,
    mode,
    tier,
    recommended: options.recommended ?? false,
    // Deduplicate and keep a stable order, so a comparison table built from two
    // different plans lines its rows up without extra sorting.
    capabilities: Array.from(new Set(capabilities)),
    locationLimit: options.locationLimit ?? null,
  }
}

/**
 * Independent Solo is NOT a crippled salon plan. It is a smaller product for
 * one person: the whole foundation, plus walk-ins and the live queue for a
 * barber who takes people off the street, and none of the team/chair machinery
 * that would only be noise for someone working alone.
 */
const SOLO = plan('solo', 'independent', 1, [...FOUNDATION, 'walkIns', 'liveQueue'], {
  recommended: true,
  locationLimit: 1,
})

/** Essential is a real entry-level shop product, not a demo of what you cannot have. */
const SHOP_ESSENTIAL = plan('shop_essential', 'barbershop', 1, [...FOUNDATION, 'walkIns', 'team'], {
  locationLimit: 1,
})

/** Pro is the core FadeUp salon experience: the floor runs live, and customers come back. */
const SHOP_PRO = plan('shop_pro', 'barbershop', 2, [...FOUNDATION, ...FLOOR, ...RETENTION_SUITE], {
  recommended: true,
  locationLimit: 1,
})

const SHOP_BUSINESS = plan(
  'shop_business',
  'barbershop',
  3,
  [...FOUNDATION, ...FLOOR, ...RETENTION_SUITE, ...ADVANCED_CONTROL],
  { locationLimit: 1 },
)

/** Growth runs several shops properly. Retention automation is what Pro adds on top. */
const MULTI_GROWTH = plan('multi_growth', 'multi_location', 1, [...FOUNDATION, ...FLOOR, ...MULTI_CORE], {
  locationLimit: 2,
})

const MULTI_PRO = plan(
  'multi_pro',
  'multi_location',
  2,
  [...FOUNDATION, ...FLOOR, ...MULTI_CORE, ...RETENTION_SUITE],
  { recommended: true, locationLimit: 5 },
)

const MULTI_SCALE = plan(
  'multi_scale',
  'multi_location',
  3,
  [...FOUNDATION, ...FLOOR, ...MULTI_CORE, ...RETENTION_SUITE, ...ADVANCED_CONTROL],
  { locationLimit: 10 },
)

export const PLANS: Record<PlanId, Plan> = {
  solo: SOLO,
  shop_essential: SHOP_ESSENTIAL,
  shop_pro: SHOP_PRO,
  shop_business: SHOP_BUSINESS,
  multi_growth: MULTI_GROWTH,
  multi_pro: MULTI_PRO,
  multi_scale: MULTI_SCALE,
}

export const PLAN_IDS = Object.keys(PLANS) as PlanId[]

/** The plans offered to a given business mode, cheapest first. */
export function plansForMode(mode: BusinessMode): Plan[] {
  return PLAN_IDS.map((id) => PLANS[id])
    .filter((p) => p.mode === mode)
    .sort((a, b) => a.tier - b.tier)
}

export function recommendedPlanFor(mode: BusinessMode): Plan {
  const plans = plansForMode(mode)
  return plans.find((p) => p.recommended) ?? plans[0]!
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
  return (PLAN_IDS as string[]).includes(value) ? (value as PlanId) : null
}

export function modeForPlan(planId: PlanId): BusinessMode {
  return PLANS[planId].mode
}

/** Steps a mode index forward or backward, wrapping at both ends. */
export function cycleMode(current: BusinessMode, direction: 1 | -1): BusinessMode {
  const index = BUSINESS_MODES.indexOf(current)
  const next = (index + direction + BUSINESS_MODES.length) % BUSINESS_MODES.length
  return BUSINESS_MODES[next]!
}
