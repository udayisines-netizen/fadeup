import { z } from 'zod'

/**
 * THE CLIENT ANALYTICS CONTRACT.
 *
 * This module is deliberately free of React, of Supabase and of anything in
 * `@/components`. It is pure data and pure functions, so that `apps/mobile`
 * can import the same contract when it exists (§19) without dragging a web
 * component tree behind it. Nothing here touches the network; `client.ts`
 * does that, and takes its transport as an argument for the same reason.
 *
 * WHAT MAY LIVE HERE, AND WHAT MAY NOT
 *
 * Only CLIENT INTENT events. Every name below is `emission = 'client'` in
 * public.analytics_event_definitions, and the database refuses to accept a
 * server-authoritative event from a browser origin at all — so a
 * `appointment_completed` added to this file would not produce a wrong number,
 * it would produce a rejection. That is intentional: the wall between intent
 * and evidence is enforced in the database, not in this file's discipline.
 *
 * WHY THE PROPERTY KEYS ARE snake_case
 *
 * These keys land verbatim in a jsonb column that BI, the future Pro
 * dashboard and every SQL report will read. One vocabulary across the client,
 * the server emitters and the query layer is worth more than camelCase
 * ergonomics in one of the three, and a translation layer in the middle is one
 * more place for `serviceId` and `service_id` to both exist.
 *
 * WHAT IS DELIBERATELY NOT SENT
 *
 *  - The raw search query. It is free text a customer can type anything into,
 *    including their own name or a phone number. Its SHAPE is measurable
 *    (length, whether it was empty) and that is what `search_performed`
 *    carries.
 *  - The chosen appointment time. §12 forbids future appointment details in
 *    analytics. `booking_slot_selected` carries how far AHEAD the slot was,
 *    which is the actually interesting question and identifies nobody.
 *  - Anything the server can derive. No actor, no plan, no timestamp, no
 *    country. `track_analytics_event` does not even accept them.
 */

/**
 * Origins a client is permitted to claim. The database holds the same list and
 * rejects anything else; this exists so a typo is a TypeScript error rather
 * than a runtime rejection.
 */
export const ANALYTICS_ORIGINS = ['public_web', 'customer_web'] as const
export type AnalyticsOrigin = (typeof ANALYTICS_ORIGINS)[number]

const uuid = z.string().uuid()

/**
 * Bounded, non-negative integer. Used for every count and position, so a
 * runaway render loop reporting `Infinity` is rejected here rather than
 * quietly stored.
 */
const smallCount = z.number().int().nonnegative().max(100_000)

/**
 * The client event registry. Keys must match analytics_event_definitions
 * exactly; the R3 verification suite asserts both sides agree.
 */
export const ANALYTICS_CLIENT_EVENTS = {
  discovery_viewed: z.object({
    surface: z.enum(['marketplace', 'customer_discover']),
  }),

  search_performed: z.object({
    result_count: smallCount,
    has_filters: z.boolean(),
    /** Length only. The query itself is free text and never leaves the device. */
    query_length: smallCount,
  }),

  search_result_viewed: z.object({
    /** 1-based rank in the result list — the number that makes result quality measurable. */
    position: smallCount,
    result_type: z.enum(['organization', 'professional']),
  }),

  public_profile_viewed: z.object({
    profile_type: z.enum(['organization', 'professional']),
  }),

  booking_started: z.object({}),

  booking_service_selected: z.object({
    service_id: uuid,
  }),

  booking_barber_selected: z.object({
    /** "Any available" is a real customer choice, not a missing value. */
    any_available: z.boolean(),
  }),

  booking_slot_selected: z.object({
    /**
     * Minutes between now and the chosen slot. Deliberately relative: an
     * absolute timestamp would be a future appointment detail, which §12
     * forbids, and "how far ahead do people book" is the question anyone
     * actually asks.
     */
    lead_time_minutes: z.number().int().nonnegative().max(525_600),
  }),

  queue_viewed: z.object({}),

  queue_join_started: z.object({}),
} as const

export type AnalyticsClientEventName = keyof typeof ANALYTICS_CLIENT_EVENTS

export type AnalyticsProperties<N extends AnalyticsClientEventName> =
  z.infer<(typeof ANALYTICS_CLIENT_EVENTS)[N]>

/**
 * Business context for an event. Every field is validated server-side against
 * real tenant state — an organization that is not public, or a barber
 * belonging to a different shop, is refused there. This type only stops the
 * obvious mistakes early.
 */
export interface AnalyticsContext {
  organizationId?: string | null
  locationId?: string | null
  barberId?: string | null
  professionalId?: string | null
}

const contextSchema = z.object({
  organizationId: uuid.nullish(),
  locationId: uuid.nullish(),
  barberId: uuid.nullish(),
  professionalId: uuid.nullish(),
})

/** The exact argument object `public.track_analytics_event` expects. */
export interface AnalyticsRpcArgs {
  p_event_name: string
  p_event_origin: AnalyticsOrigin
  p_organization_id: string | null
  p_location_id: string | null
  p_barber_id: string | null
  p_professional_id: string | null
  p_properties: Record<string, unknown>
  p_session_id: string | null
  p_locale: string | null
  p_correlation_id: string | null
}

export type AnalyticsBuildResult =
  | { ok: true; args: AnalyticsRpcArgs }
  | { ok: false; reason: string }

export interface AnalyticsEnvelope {
  origin: AnalyticsOrigin
  sessionId?: string | null
  locale?: string | null
  correlationId?: string | null
}

/**
 * Validates one event and produces the RPC arguments for it.
 *
 * Returns a result rather than throwing, and never throws itself. Analytics
 * must not be able to take down a render, and a `track()` inside an effect
 * that threw would do exactly that — so the failure mode is a value the caller
 * may ignore, which `client.ts` does after reporting it.
 */
export function buildAnalyticsCall<N extends AnalyticsClientEventName>(
  name: N,
  input: { properties: AnalyticsProperties<N>; context?: AnalyticsContext },
  envelope: AnalyticsEnvelope,
): AnalyticsBuildResult {
  const schema = ANALYTICS_CLIENT_EVENTS[name]

  if (!schema) {
    return { ok: false, reason: `unknown client analytics event: ${String(name)}` }
  }

  const properties = schema.safeParse(input.properties ?? {})
  if (!properties.success) {
    return { ok: false, reason: `invalid properties for ${String(name)}: ${properties.error.message}` }
  }

  const context = contextSchema.safeParse(input.context ?? {})
  if (!context.success) {
    return { ok: false, reason: `invalid context for ${String(name)}: ${context.error.message}` }
  }

  if (!ANALYTICS_ORIGINS.includes(envelope.origin)) {
    return { ok: false, reason: `invalid analytics origin: ${String(envelope.origin)}` }
  }

  return {
    ok: true,
    args: {
      p_event_name: name,
      p_event_origin: envelope.origin,
      p_organization_id: context.data.organizationId ?? null,
      p_location_id: context.data.locationId ?? null,
      p_barber_id: context.data.barberId ?? null,
      p_professional_id: context.data.professionalId ?? null,
      p_properties: properties.data as Record<string, unknown>,
      p_session_id: envelope.sessionId ?? null,
      p_locale: envelope.locale ?? null,
      p_correlation_id: envelope.correlationId ?? null,
    },
  }
}

/**
 * The throttle key for one call. Two calls sharing a key inside the throttle
 * window are the same view being reported twice — a re-render, a StrictMode
 * double-mount, a back-navigation restoring a cached page — and only the first
 * is sent (§13: avoid trivial inflation, without building an anti-fraud
 * system).
 *
 * Genuinely distinct events differ in properties or context and therefore in
 * key, so a customer who really does view two shops is counted twice.
 */
export function analyticsThrottleKey(args: AnalyticsRpcArgs): string {
  return [
    args.p_event_name,
    args.p_organization_id ?? '',
    args.p_location_id ?? '',
    args.p_barber_id ?? '',
    args.p_professional_id ?? '',
    JSON.stringify(args.p_properties),
  ].join('|')
}
