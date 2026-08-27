import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  ANALYTICS_CLIENT_EVENTS,
  analyticsThrottleKey,
  buildAnalyticsCall,
  createAnalyticsClient,
  type AnalyticsRpcArgs,
} from '@/lib/analytics'

/**
 * WHAT THESE TESTS ARE FOR.
 *
 * Not the markup, and not that a hook fires — a test asserting "useEffect ran"
 * proves React works. What actually breaks analytics is quieter than that:
 *
 *   * an event name drifting out of agreement with the database taxonomy, so
 *     every row is rejected and the reports go silently empty;
 *   * a property carrying something §12 forbids;
 *   * `track()` throwing or rejecting, and taking a booking down with it —
 *     the §14/§19 guarantee, which is worth more than every number this
 *     module collects;
 *   * a re-render inflating a view count, which is invisible in the product
 *     and therefore never noticed.
 *
 * So these exercise the pure contract and the failure behaviour.
 */

function argsFor(overrides: Partial<AnalyticsRpcArgs> = {}): AnalyticsRpcArgs {
  return {
    p_event_name: 'public_profile_viewed',
    p_event_origin: 'public_web',
    p_organization_id: null,
    p_location_id: null,
    p_barber_id: null,
    p_professional_id: null,
    p_properties: {},
    p_session_id: null,
    p_locale: null,
    p_correlation_id: null,
    ...overrides,
  }
}

describe('the client event contract', () => {
  it('produces exactly the arguments track_analytics_event declares', () => {
    const result = buildAnalyticsCall(
      'public_profile_viewed',
      {
        properties: { profile_type: 'organization' },
        context: { organizationId: '11111111-1111-4111-8111-111111111111' },
      },
      { origin: 'public_web', sessionId: 'abcdefgh1234', locale: 'fr' },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // The exact wire shape. A renamed parameter here is a 100% rejection rate
    // in production and a completely empty report, with no error anywhere a
    // customer or a developer would see.
    expect(Object.keys(result.args).sort()).toEqual([
      'p_barber_id',
      'p_correlation_id',
      'p_event_name',
      'p_event_origin',
      'p_locale',
      'p_location_id',
      'p_organization_id',
      'p_professional_id',
      'p_properties',
      'p_session_id',
    ])
    expect(result.args.p_organization_id).toBe('11111111-1111-4111-8111-111111111111')
    expect(result.args.p_properties).toEqual({ profile_type: 'organization' })
  })

  it('never sends an actor, a timestamp or a plan — the server derives all three', () => {
    const result = buildAnalyticsCall(
      'booking_started',
      { properties: {} },
      { origin: 'customer_web' },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const keys = Object.keys(result.args)
    // Impersonation is prevented by the ABSENCE of these, in both the RPC
    // signature and here. A parameter that does not exist cannot be forged.
    for (const forbidden of ['p_actor_user_id', 'p_actor_type', 'p_occurred_at', 'p_plan_key', 'p_dedupe_key']) {
      expect(keys).not.toContain(forbidden)
    }
  })

  it('refuses an unknown event rather than sending it', () => {
    // @ts-expect-error — the type system stops this at compile time; the check
    // exists because JS callers and future dynamic names would not be stopped.
    const result = buildAnalyticsCall('appointment_completed', { properties: {} }, { origin: 'public_web' })
    expect(result.ok).toBe(false)
  })

  it('refuses malformed properties instead of letting the server reject them', () => {
    const result = buildAnalyticsCall(
      'search_result_viewed',
      // Types cannot express "non-negative", so this compiles and only Zod
      // catches it — which is exactly why the runtime validation exists rather
      // than trusting the type signature at the call site.
      { properties: { position: -1, result_type: 'organization' } },
      { origin: 'public_web' },
    )
    expect(result.ok).toBe(false)
  })

  it('refuses a non-uuid organization id', () => {
    const result = buildAnalyticsCall(
      'public_profile_viewed',
      { properties: { profile_type: 'organization' }, context: { organizationId: 'not-a-uuid' } },
      { origin: 'public_web' },
    )
    expect(result.ok).toBe(false)
  })

  it('carries no property whose name the database privacy gate forbids', () => {
    // The server-side gate in private.assert_analytics_properties_safe matches
    // these as SUBSTRINGS of a key name. Any client schema that used one would
    // have every event of that kind rejected in production and pass every test
    // that only checked the happy path — so the contract is asserted here,
    // against the same list.
    const forbidden = [
      'email', 'phone', 'mobile', 'password', 'token', 'secret', 'credential',
      'authorization', 'note', 'message', 'body', 'address', 'postcode',
      'postal', 'latitude', 'longitude', 'lat_', 'lng', 'coordinate', 'geo_point',
      'ip_', 'user_agent', 'fingerprint', 'birth', 'ssn', 'tax_id',
    ]

    for (const [eventName, schema] of Object.entries(ANALYTICS_CLIENT_EVENTS)) {
      const shape = (schema as unknown as { shape: Record<string, unknown> }).shape
      for (const key of Object.keys(shape)) {
        for (const term of forbidden) {
          expect(
            key.toLowerCase().includes(term),
            `${eventName}.${key} contains the forbidden term "${term}"`,
          ).toBe(false)
        }
      }
    }
  })

  it('does not accept an absolute appointment time anywhere', () => {
    // §12 forbids future appointment details. booking_slot_selected carries a
    // RELATIVE lead time for exactly this reason, and a later edit that
    // "helpfully" added the timestamp back would be caught here.
    const slot = ANALYTICS_CLIENT_EVENTS.booking_slot_selected
    const shape = (slot as unknown as { shape: Record<string, unknown> }).shape
    expect(Object.keys(shape)).toEqual(['lead_time_minutes'])
  })
})

describe('every client event exists in the database taxonomy', () => {
  it('matches the wired client definitions in the R3 taxonomy migration', () => {
    // Reads the migration rather than trusting a duplicated list. If the two
    // disagree the events are rejected at ingestion, which produces empty
    // reports and no visible error — the exact failure mode that survives a
    // release.
    const here = dirname(fileURLToPath(import.meta.url))
    const migration = readFileSync(
      join(here, '../../../../../db/migrations/20260827120100_analytics_event_taxonomy.sql'),
      'utf8',
    )

    for (const name of Object.keys(ANALYTICS_CLIENT_EVENTS)) {
      const row = new RegExp(`\\('${name}',\\s*\\d+,\\s*'[a-z_]+',\\s*'client',\\s*'wired'`)
      expect(row.test(migration), `${name} is not a WIRED CLIENT event in the taxonomy`).toBe(true)
    }
  })
})

describe('analytics can never break the product', () => {
  const noop = () => {}

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns void — there is nothing a component can await', () => {
    const client = createAnalyticsClient({
      transport: async () => {},
      origin: 'public_web',
    })

    expect(client.track('booking_started', { properties: {} })).toBeUndefined()
  })

  it('swallows a transport that rejects', async () => {
    const onError = vi.fn()
    const client = createAnalyticsClient({
      transport: () => Promise.reject(new Error('network is down')),
      origin: 'public_web',
      onError,
    })

    expect(() => client.track('booking_started', { properties: {} })).not.toThrow()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onError).toHaveBeenCalled()
  })

  it('swallows a transport that throws synchronously', () => {
    const onError = vi.fn()
    const client = createAnalyticsClient({
      transport: () => {
        throw new Error('client not configured')
      },
      origin: 'public_web',
      onError,
    })

    expect(() => client.track('booking_started', { properties: {} })).not.toThrow()
  })

  it('swallows an onError that itself throws', () => {
    const client = createAnalyticsClient({
      transport: async () => {},
      origin: 'public_web',
      onError: () => {
        throw new Error('the reporter is broken too')
      },
    })

    // Reaches onError via the validation path, which is synchronous.
    expect(() =>
      // @ts-expect-error — deliberately invalid, to force the error path
      client.track('nope_not_an_event', { properties: {} }),
    ).not.toThrow()
  })

  it('reports invalid events without sending them', async () => {
    const transport = vi.fn(async () => {})
    const client = createAnalyticsClient({ transport, origin: 'public_web', onError: noop })

    // @ts-expect-error — deliberately invalid
    client.track('appointment_completed', { properties: {} })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(transport).not.toHaveBeenCalled()
  })
})

describe('view inflation', () => {
  /**
   * `track()` dispatches on a microtask — it is fire-and-forget by design, so
   * a component never blocks on it. Tests must therefore flush before
   * asserting on the transport; asserting synchronously would pass only by
   * accident and would break the moment the dispatch stayed asynchronous.
   */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('sends one event when the same view is reported repeatedly', async () => {
    const transport = vi.fn(async () => {})
    let clock = 1_000
    const client = createAnalyticsClient({
      transport,
      origin: 'public_web',
      now: () => clock,
      throttleMs: 30_000,
    })

    const view = {
      properties: { profile_type: 'organization' as const },
      context: { organizationId: '11111111-1111-4111-8111-111111111111' },
    }

    client.track('public_profile_viewed', view)
    clock += 100 // a re-render
    client.track('public_profile_viewed', view)
    clock += 5_000 // a back-navigation restoring the page
    client.track('public_profile_viewed', view)

    await flush()
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('sends again once the window has passed — a genuine second visit', async () => {
    const transport = vi.fn(async () => {})
    let clock = 1_000
    const client = createAnalyticsClient({
      transport,
      origin: 'public_web',
      now: () => clock,
      throttleMs: 30_000,
    })

    const view = {
      properties: { profile_type: 'organization' as const },
      context: { organizationId: '11111111-1111-4111-8111-111111111111' },
    }

    client.track('public_profile_viewed', view)
    clock += 30_001
    client.track('public_profile_viewed', view)

    await flush()
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('never collapses views of DIFFERENT shops', async () => {
    const transport = vi.fn(async () => {})
    const client = createAnalyticsClient({ transport, origin: 'public_web', now: () => 1_000 })

    client.track('public_profile_viewed', {
      properties: { profile_type: 'organization' },
      context: { organizationId: '11111111-1111-4111-8111-111111111111' },
    })
    client.track('public_profile_viewed', {
      properties: { profile_type: 'organization' },
      context: { organizationId: '22222222-2222-4222-8222-222222222222' },
    })

    await flush()
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('never collapses two genuinely different searches', () => {
    // §6: repeated searches are legitimately separate events and must not be
    // deduplicated. Only an IDENTICAL search inside the window is a re-render.
    const a = analyticsThrottleKey(
      argsFor({ p_event_name: 'search_performed', p_properties: { result_count: 3, has_filters: false, query_length: 4 } }),
    )
    const b = analyticsThrottleKey(
      argsFor({ p_event_name: 'search_performed', p_properties: { result_count: 9, has_filters: false, query_length: 4 } }),
    )
    expect(a).not.toBe(b)
  })
})
